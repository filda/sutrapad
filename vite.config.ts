import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command, mode }) => {
  const isBuild = command === "build";
  const base = isBuild ? "/sutrapad/" : "/";
  const env = loadEnv(mode, process.cwd(), "");
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as { version?: string };
  const httpsKeyPath = env.VITE_DEV_HTTPS_KEY_PATH?.trim();
  const httpsCertPath = env.VITE_DEV_HTTPS_CERT_PATH?.trim();
  const httpsEnabled = Boolean(httpsKeyPath && httpsCertPath);
  const buildTime = new Date().toISOString();
  const commitHash = resolveGitCommitHash();

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
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version ?? "0.0.0"),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
      __APP_COMMIT_HASH__: JSON.stringify(commitHash),
    },
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
          description: "Store and manage your Gerümpel on Google Drive — powered entirely by browser magic, questionable decisions, and multiple JSON files.",
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

function resolveGitCommitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}
