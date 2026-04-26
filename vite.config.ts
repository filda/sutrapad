import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { FontaineTransform } from "fontaine";

import { buildPwaManifest } from "./src/lib/pwa-manifest";

/**
 * Strip legacy `.woff` fallback entries from `@fontsource*` CSS at transform
 * time, so Vite never sees the URL and never copies the binary into
 * `dist/assets/`. The packages declare each face as
 *
 *     src: url(./files/...woff2) format('woff2'),
 *          url(./files/...woff)  format('woff');
 *
 * which `format()` lets every browser we target (per AGENTS.md / package.json
 * — modern-only, ES2023) resolve to the woff2 entry. The `.woff` half is
 * structurally dead code: no client ever requests it, but Vite still emits
 * it because the URL appears in the CSS source. The regex drops the trailing
 * `, url(...woff) format('woff')` segment, leaving a single-source `src:`.
 *
 * Scoped to `node_modules/@fontsource` ids so we never accidentally rewrite
 * project-authored CSS, and skipped outside `command === 'build'` because
 * the dev server doesn't preemptively bundle assets — there's nothing to
 * trim and the regex would just burn time on every CSS module load.
 */
function stripFontsourceWoffFallbacks(): Plugin {
  const WOFF_FALLBACK = /,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g;
  return {
    name: "sutrapad:strip-fontsource-woff-fallbacks",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/@fontsource") || !id.endsWith(".css")) return null;
      if (!WOFF_FALLBACK.test(code)) return null;
      // `RegExp` with the `g` flag carries `lastIndex` across calls, so reset
      // before doing the replacement on the same instance.
      WOFF_FALLBACK.lastIndex = 0;
      return { code: code.replace(WOFF_FALLBACK, ""), map: null };
    },
  };
}

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
      // Run the woff-fallback strip first so Fontaine and the rest of the
      // pipeline see the trimmed `src:` declarations.
      stripFontsourceWoffFallbacks(),
      // Fontaine generates metric-matched fallback @font-face declarations for
      // each web font we ship via @fontsource (see `src/fonts.ts`). Until the
      // .woff2 arrives the user's browser renders text in the local fallback
      // (Georgia / Arial / Menlo) — Fontaine adjusts the fallback's
      // size-adjust / ascent-override / descent-override so its line metrics
      // match the loaded face. The result: the swap is pixel-identical and
      // layout never reflows when fonts come in. Per-family fallback choice
      // matters: each fallback should exist on most systems and have
      // proportions reasonably close to the target so the override values
      // stay subtle.
      FontaineTransform.vite({
        fallbacks: {
          // Newsreader is a literary serif — Georgia is universally available
          // and its proportions are the closest stock serif we can lean on.
          Newsreader: ["Georgia", "Cambria", "serif"],
          // Inter Tight uses a vendored variable font; Fontaine needs to
          // resolve the .woff2 to read the actual metrics, so we list both
          // the variable family alias and the static fallback name.
          "Inter Tight Variable": [
            "Arial",
            "Helvetica",
            "system-ui",
            "sans-serif",
          ],
          "Inter Tight": [
            "Arial",
            "Helvetica",
            "system-ui",
            "sans-serif",
          ],
          // JetBrains Mono → Menlo on macOS / Consolas-like on Windows is
          // the best proportion match; Courier New is the universal floor.
          "JetBrains Mono": [
            "Menlo",
            "Consolas",
            "Courier New",
            "monospace",
          ],
          // Caveat is a script handwriting face; no system font has
          // remotely similar proportions, so Fontaine's metric override
          // would do more harm than good. We deliberately skip it (see
          // skipFontFaceGeneration below) and let it swap with the natural
          // cursive fallback — Caveat is only used by notebook-persona's
          // handwritten tier so the rare swap is acceptable.
        },
        // The @font-face rules from @fontsource use relative `./files/...`
        // src URLs that Vite resolves to node_modules paths — Fontaine needs
        // those resolved to absolute file:// URLs so it can open the .woff2
        // and read the font metrics during build.
        resolvePath: (id) => {
          if (id.startsWith("/") || id.startsWith("file:")) {
            return id.startsWith("file:") ? new URL(id) : pathToFileURL(id);
          }
          return pathToFileURL(resolve(process.cwd(), "node_modules", id));
        },
        skipFontFaceGeneration: (fallbackName) =>
          fallbackName.startsWith("Caveat fallback"),
      }),
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        devOptions: {
          enabled: false,
        },
        manifest: buildPwaManifest(base),
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
