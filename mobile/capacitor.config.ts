import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.PDFTK_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.pdftoolkit.app',
  appName: 'PDF Toolkit',
  webDir: 'www',
  bundledWebRuntime: false,
  // When PDFTK_SERVER_URL is provided, run as a WebView over the live
  // server. Otherwise ship the bundled copy from `www/` (built from the
  // parent `public/` directory via `npm run sync`).
  server: serverUrl
    ? { url: serverUrl, cleartext: /^http:\/\//i.test(serverUrl) }
    : { androidScheme: 'https' },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
