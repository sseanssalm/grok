import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Static client bundle for the Capacitor Android app.
 *
 * The website build (`vite.config.ts`) is a TanStack Start / Nitro server for
 * Vercel. A WebView cannot host that server, and the ledger UI does not need
 * it — `BudgetApp` persists in localStorage. This config bundles that same UI
 * without changing the web deploy.
 */
const workspace = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(workspace, "android-shell"),
  base: "./",
  publicDir: resolve(workspace, "android-shell/public"),
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { "@": resolve(workspace, "src") },
  },
  build: {
    outDir: resolve(workspace, "dist/android"),
    emptyOutDir: true,
  },
});
