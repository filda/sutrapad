/*
 * Self-hosted typeface bundle.
 *
 * Replaces the previous `@import url("https://fonts.googleapis.com/...")` line
 * at the top of `styles.css`. Imports are kept here (a side-effect-only module)
 * so the @font-face rules end up in the main CSS bundle alongside `styles.css`
 * and the parchment / persona theming that depends on them. Importing fonts as
 * an npm dependency means:
 *
 *   - No network call to fonts.googleapis.com / fonts.gstatic.com — first paint
 *     never blocks on a third-party domain, and the strict CSP can keep
 *     `style-src 'self'` without an exception (see `index.html`).
 *   - The .woff2 files are emitted into `dist/assets/` content-hashed, so users
 *     get long-lived HTTP cache hits on every revisit. Cross-site cache sharing
 *     hasn't existed since browsers partitioned caches in 2020, so we're not
 *     losing anything self-hosting that we'd otherwise have via Google Fonts.
 *   - The exact set of weights / styles / subsets we ship is auditable here in
 *     one file rather than encoded in a Google Fonts URL.
 *
 * Subset choice: `latin` + `latin-ext` covers Czech (and the rest of Central
 * European Latin diacritics) without shipping Vietnamese / Greek / Cyrillic
 * woff2 files we don't need. The full @fontsource per-weight CSS files are
 * bigger because they reference every subset; the `latin-*` and `latin-ext-*`
 * variants drop the rest at the @font-face level so Vite never emits the
 * unused .woff2 binaries into `dist`.
 *
 * Anti-skip: Fontaine (configured in `vite.config.ts`) auto-generates
 * metric-matched fallback @font-face rules for these families using the local
 * Georgia / Arial / Menlo metrics. The fallback chain in `--serif` / `--sans`
 * / `--mono` is what the user sees during the brief window before the .woff2
 * arrives, and Fontaine adjusts those fallbacks to match the loaded font's
 * x-height / advance-width / ascent so the swap is pixel-identical and the
 * layout doesn't reflow.
 */

// Inter Tight (sans, UI chrome). The variable wght axis covers 100–900 in a
// single ~30 KB file (per subset), so we don't load three separate weight
// files for 400 / 500 / 600. Family alias is "Inter Tight Variable" (see the
// `--sans` declaration in styles.css). No subset-specific entry exists for
// the variable build, so we accept the wght.css index — unused subsets are
// still gated by `unicode-range` and never download at runtime.
import "@fontsource-variable/inter-tight/wght.css";

// Newsreader (serif, note bodies + parchment headings). 400 + 500 in upright
// and italic — matches the previous Google Fonts URL exactly.
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-ext-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/newsreader/latin-ext-400-italic.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-ext-500.css";
import "@fontsource/newsreader/latin-500-italic.css";
import "@fontsource/newsreader/latin-ext-500-italic.css";

// JetBrains Mono (mono, sync pill / timestamps / inline code). 400 + 500.
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-ext-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-ext-500.css";

// Caveat (handwritten, persona decoration only — used when notebook-persona.ts
// resolves to the `handwritten` font tier). 400 + 600.
import "@fontsource/caveat/latin-400.css";
import "@fontsource/caveat/latin-ext-400.css";
import "@fontsource/caveat/latin-600.css";
import "@fontsource/caveat/latin-ext-600.css";
