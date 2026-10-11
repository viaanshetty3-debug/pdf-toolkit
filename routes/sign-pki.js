import { Router } from 'express';
import multer from 'multer';
import { PDFDocument, PDFName, PDFHexString, PDFNumber, PDFArray, PDFString } from 'pdf-lib';
import crypto from 'node:crypto';
import { loadPdf, sendPdf, httpError } from '../lib/pdf-utils.js';
import { buildCmsSignature, getSigner, signerFromUserMaterial } from '../lib/pki.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024, files: 3 },
});

const router = Router();

const SIG_PLACEHOLDER_SIZE = 16384;  // bytes reserved for the CMS blob (hex-encoded)

/**
 * POST /api/sign-pki — produce a cryptographically signed PDF.
 *   file      the PDF
 *   name      signer common name shown in the signature appearance (default: "PDF Toolkit Signer")
 *   reason    optional reason string
 *   location  optional location string
 *
 * The signature is self-signed. Adobe Reader will show the signature as
 * cryptographically valid but with an untrusted certificate chain — the user
 * can import the generated certificate into their trust store to see it as
 * fully trusted. (GET /api/sign-pki/cert exports the certificate.)
 */
router.post('/', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'cert', maxCount: 1 },
  { name: 'key',  maxCount: 1 },
]), async (req, res, next) => {
  try {
    const pdfFile = req.files?.file?.[0];
    if (!pdfFile) throw httpError(400, 'No file uploaded');
    const name = String(req.body.name || 'PDF Toolkit Signer').slice(0, 128);
    const reason = String(req.body.reason || '').slice(0, 128);
    const location = String(req.body.location || '').slice(0, 128);

    // Optional user-supplied identity.
    let customSigner = null;
    const certFile = req.files?.cert?.[0];
    const keyFile  = req.files?.key?.[0];
    if (certFile && keyFile) {
      try {
        customSigner = signerFromUserMaterial({
          keyPem: keyFile.buffer.toString('utf8'),
          keyPassphrase: req.body.keyPassphrase || undefined,
          certBytes: certFile.buffer,
        });
      } catch (e) {
        throw httpError(400, `Could not load custom identity: ${e.message}`);
      }
    } else if (certFile || keyFile) {
      throw httpError(400, 'Provide both cert AND key, or neither');
    }

    const doc = await loadPdf(pdfFile.buffer);

    // Build the signature dictionary. /Contents is a placeholder we overwrite
    // after saving (so we can measure byte offsets).
    const sigDict = doc.context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'adbe.pkcs7.detached',
      // Use 10-digit placeholders so there's enough slot space for the real
      // byte offsets after serialization. Final values are padded to fit.
      ByteRange: [PDFNumber.of(0), PDFNumber.of(9999999999), PDFNumber.of(9999999999), PDFNumber.of(9999999999)],
      Contents: PDFHexString.of('0'.repeat(SIG_PLACEHOLDER_SIZE)),
      M: PDFString.fromDate(new Date()),
      Name: PDFString.of(name),
      ...(reason   ? { Reason:   PDFString.of(reason) }   : {}),
      ...(location ? { Location: PDFString.of(location) } : {}),
    });
    const sigRef = doc.context.register(sigDict);

    // Signature annotation on page 1 (invisible — Rect [0,0,0,0]).
    const sigAnnot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      Rect: [0, 0, 0, 0],
      V: sigRef,
      T: PDFString.of(`Signature-${Date.now()}`),
      F: 132,  // Print + Locked
      P: doc.getPage(0).ref,
    });
    const annotRef = doc.context.register(sigAnnot);

    // Append the annotation to page 1's /Annots.
    const page = doc.getPage(0);
    const existingAnnots = page.node.Annots();
    if (existingAnnots) {
      existingAnnots.push(annotRef);
    } else {
      page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]));
    }

    // Attach the signature field to the AcroForm.
    const acroForm = doc.context.obj({
      Fields: [annotRef],
      SigFlags: 3,  // SignaturesExist + AppendOnly
    });
    const acroFormRef = doc.context.register(acroForm);
    doc.catalog.set(PDFName.of('AcroForm'), acroFormRef);

    // Save placeholder-sized ByteRange hint.
    // Use the custom signer (if provided) throughout CMS signing.
    const activeSigner = customSigner;
    const buf = Buffer.from(await doc.save({ useObjectStreams: false }));

    // Locate the placeholder in the serialized bytes.
    const placeholder = Buffer.from('<' + '0'.repeat(SIG_PLACEHOLDER_SIZE) + '>', 'ascii');
    const sigStart = buf.indexOf(placeholder);
    if (sigStart < 0) throw httpError(500, 'Internal: signature placeholder not found');
    const sigEnd = sigStart + placeholder.length;

    // Build the final /ByteRange — covers everything except the hex blob inside <>.
    const r1Start = 0;
    const r1End   = sigStart + 1;                       // include '<', exclude hex
    const r2Start = sigEnd - 1;                         // starts at '>'
    const r2End   = buf.length;                         // through EOF
    const r1Len = r1End - r1Start;
    const r2Len = r2End - r2Start;
    const byteRangeText = `[ ${r1Start} ${r1Len} ${r2Start} ${r2Len} ]`;

    // The placeholder /ByteRange was written as "[ 0 0 0 0 ]" with 10 pt
    // spacing. We need to replace it with values that fit in the same slot.
    // Easiest: emit a padded replacement up to the original length.
    const brMarker = Buffer.from('/ByteRange', 'ascii');
    const brPos = buf.indexOf(brMarker);
    if (brPos < 0) throw httpError(500, 'Internal: /ByteRange not found');
    // Find the opening '[' and closing ']' after it.
    const brOpen = buf.indexOf('[', brPos);
    const brClose = buf.indexOf(']', brOpen);
    const brLen = brClose - brOpen + 1;
    const padded = Buffer.alloc(brLen, 0x20);
    const brReplacement = Buffer.from(byteRangeText, 'ascii');
    if (brReplacement.length > brLen) throw httpError(500, 'Internal: ByteRange text too long');
    brReplacement.copy(padded, 0);
    padded.copy(buf, brOpen);

    // Hash the bytes outside the placeholder.
    const hash = crypto.createHash('sha256');
    hash.update(buf.slice(r1Start, r1Start + r1Len));
    hash.update(buf.slice(r2Start, r2Start + r2Len));
    const digest = hash.digest();

    // Build the CMS SignedData.
    const cms = await buildCmsSignature(digest, activeSigner);
    const hex = cms.toString('hex').toUpperCase();
    if (hex.length > SIG_PLACEHOLDER_SIZE) {
      throw httpError(500, `Signature too large (${hex.length} > ${SIG_PLACEHOLDER_SIZE})`);
    }
    // Overwrite placeholder zeros with the real CMS hex, pad trailing with zeros.
    const sigHexSlot = sigStart + 1;  // skip '<'
    const sigHexEnd = sigEnd - 1;     // just before '>'
    const slotLen = sigHexEnd - sigHexSlot;
    buf.fill(0x30, sigHexSlot, sigHexEnd);  // zeros = '0' char
    Buffer.from(hex, 'ascii').copy(buf, sigHexSlot);

    sendPdf(res, buf, 'signed.pdf');
  } catch (e) { next(e); }
});

/**
 * GET /api/sign-pki/cert — download the local signer's self-signed certificate
 * so the user can import it into Adobe's trust store (then Adobe will show
 * subsequent signatures as fully trusted).
 */
router.get('/cert', async (req, res, next) => {
  try {
    const signer = await getSigner();
    res.setHeader('Content-Type', 'application/pkix-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="pdf-toolkit-signer.cer"');
    res.end(signer.certDer);
  } catch (e) { next(e); }
});

export default router;
