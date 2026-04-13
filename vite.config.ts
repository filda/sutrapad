import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/sutrapad/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      devOptions: {
        enabled: false,
      },
      manifest: {
        name: "SutraPad",
        short_name: "SutraPad",
        description: "PWA note-taking app synchronized with Google Drive.",
        start_url: "/sutrapad/",
        display: "standalone",
        background_color: "#f5f0e8",
        theme_color: "#e7dfcf",
        lang: "en",
        icons: [
          {
            src: "./icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: "/sutrapad/index.html",
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
