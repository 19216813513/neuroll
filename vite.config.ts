import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

export default defineConfig({
  // The project lives inside a Dropbox folder. Dropbox holds handles open on
  // files it is syncing, which makes Vite's atomic rename of its dependency
  // cache fail with EBUSY and leaves the dep graph unresolvable. Putting the
  // cache outside the synced tree avoids the race entirely.
  cacheDir: join(tmpdir(), "neuroll-vite-cache"),

  // Stamped into every Run so a scoring change can be traced to a release.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "neuroll",
        short_name: "neuroll",
        description: "Brain training with honest measurement.",
        theme_color: "#0b0e14",
        background_color: "#0b0e14",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,mp3,wav}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    // Timing accuracy depends on not shipping surprise work at runtime;
    // keep the bundle observable so the perf budget in PLAN.md §3.3 is checkable.
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
