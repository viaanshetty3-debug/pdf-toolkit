FROM node:22-slim

# System deps — qpdf for password encryption/repair, ghostscript for PDF/A.
# tesseract is downloaded lazily by tesseract.js at first OCR run.
RUN apt-get update \
 && apt-get install -y --no-install-recommends qpdf ghostscript ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 5174
ENV NODE_ENV=production
CMD ["node", "server.js"]
