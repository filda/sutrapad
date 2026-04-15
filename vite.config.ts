import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command, mode }) => {
  const isBuild = command === "build";
  const base = isBuild ? "/sutrapad/" : "/";
  const env = loadEnv(mode, process.cwd(), "");
  const httpsKeyPath = env.VITE_DEV_HTTPS_KEY_PATH?.trim();
  const httpsCertPath = env.VITE_DEV_HTTPS_CERT_PATH?.trim();
  const httpsEnabled = Boolean(httpsKeyPath && httpsCertPath);

  const https =
    httpsEnabled && httpsKeyPath && httpsCertPath
      ? {
          key: readFileSync(resolve(process.cwd(), httpsKeyPath)),
          cert: readFileSync(resolve(process.cwd(), httpsCertPath)),
        }
      : undefined;

  if (httpsEnabled) {
    const missingFiles = [httpsKeyPath, httpsCertPath]
      .map((filePath) => resolve(process.cwd(), filePath))
      .filter((filePath) => !existsSync(filePath));

    if (missingFiles.length > 0) {
      throw new Error(
        `Missing HTTPS certificate files for Vite dev server: ${missingFiles.join(", ")}`,
      );
    }
  }

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
      host: "0.0.0.0",
      port: 5173,
      https,
    },
  };
});
