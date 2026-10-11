import { Router } from 'express';

const router = Router();

/**
 * GET /api/cloud-config — expose only the public IDs needed by the browser
 * pickers (never any secret). If a provider's env vars are unset, that
 * provider is simply omitted from the response.
 */
router.get('/', (req, res) => {
  const google = (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_API_KEY)
    ? { clientId: process.env.GOOGLE_CLIENT_ID, apiKey: process.env.GOOGLE_API_KEY }
    : null;
  const dropbox = process.env.DROPBOX_APP_KEY
    ? { appKey: process.env.DROPBOX_APP_KEY }
    : null;
  res.json({ google, dropbox });
});

export default router;
