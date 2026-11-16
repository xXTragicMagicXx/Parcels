import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// public/data holds the pipeline output (~100 MB+). Dev serves it from there;
// production serves it from R2 (see functions/data), so drop it from dist.
const dropLocalData: Plugin = {
  name: "drop-local-data",
  apply: "build",
  closeBundle() {
    rmSync(resolve(__dirname, "dist/data"), { recursive: true, force: true });
  },
};

export default defineConfig({
  server: { host: true },
  // MapLibre 6 starts its worker from a file next to its own module; pre-bundling
  // moves the module and breaks that path, so serve it as-is.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  plugins: [
    dropLocalData,
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.svg", "icons/*.png"],
      manifest: {
        name: "Idaho Parcels",
        short_name: "Parcels",
        description: "Personal Idaho parcel map with owners, GPS and notes.",
        theme_color: "#14532d",
        background_color: "#14532d",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,png}"],
        globIgnores: ["data/**"],
        navigateFallbackDenylist: [/^\/data\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // County list and search indexes: use cached copy, refresh in background.
            urlPattern: ({ url }) => /\/data\/(counties\.json|search\/)/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "parcel-meta" },
          },
        ],
      },
    }),
  ],
});
