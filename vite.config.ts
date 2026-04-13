import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command }) => {
  const isBuild = command === "build";
  const base = isBuild ? "/sutrapad/" : "/";

  return {
    base,
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
          start_url: base,
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
          navigateFallback: `${base}index.html`,
        },
      }),
    ],
    server: {
      port: 5173,
    },
  };
});
