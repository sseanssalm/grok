import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Keel ships as a bundled WebView. The ledger is on-device (localStorage),
 * so the native app does not point `server.url` at a hosted origin.
 */
const config: CapacitorConfig = {
  appId: "com.sseanssalm.keel",
  appName: "Keel",
  webDir: "dist/android",
  android: {
    backgroundColor: "#0c0d0f",
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    SystemBars: {
      // Light icons on Keel's dark canvas.
      style: "DARK",
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
