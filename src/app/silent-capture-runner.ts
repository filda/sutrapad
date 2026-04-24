/**
 * Bootstrap runner for the bookmarklet's silent-capture flow.
 *
 * Loaded by `main.ts` (instead of the normal `createApp` UI bootstrap)
 * whenever the URL carries `?silent=1`. The user got here because they
 * clicked the bookmarklet on a third-party page; the bookmarklet
 * called `window.open(...)` which opened SutraPad in a new tab with
 * the capture params in the URL.
 *
 * The runner:
 *
 *   1. Renders a minimal "Saving to SutraPad…" splash so the tab
 *      isn't blank for the second or two it takes.
 *   2. Restores the persisted Google session.
 *   3. Loads the latest workspace from Drive (we don't reach for
 *      localStorage — this tab is fresh and might not share storage
 *      with the user's main session).
 *   4. Appends the new note (URL + selection text + scraped page
 *      metadata) and pushes it back to Drive.
 *   5. Calls `window.close()`.
 *
 * Return value tells `main.ts` whether the close happened or whether
 * we should fall through to the normal `createApp` UI so the user
 * can sign in / inspect / retry.
 */

import {
  createTextNoteWorkspace,
  stripEmptyDraftNotes,
} from "../lib/notebook";
import { readUrlCapture } from "../lib/url-capture";
import { GoogleAuthService } from "../services/google-auth";
import { GoogleDriveStore } from "../services/drive-store";
import {
  buildSilentCaptureBody,
  extractSelectionFromUrl,
} from "./logic/silent-capture";

/**
 * Outcome of the runner. `closed` means we successfully saved the
 * note and called `window.close()` (the call may not actually close
 * the tab if the browser rejects it — but we did our part). The
 * other variants tell `main.ts` "this didn't work, mount the
 * regular UI and let the user finish manually."
 */
export type SilentCaptureResult =
  | { kind: "closed" }
  | { kind: "needs-fallback"; reason: SilentCaptureFallbackReason };

export type SilentCaptureFallbackReason =
  | "no-auth"
  | "no-capture"
  | "save-failed";

export interface RunSilentCaptureOptions {
  /**
   * Override for `window.location.href`. Tests inject a fixture URL;
   * production callers leave it absent.
   */
  readonly currentUrl?: string;
}

interface SavingSplashHandle {
  /**
   * Updates the secondary status line under the spinner — used to
   * narrate progress ("Loading library…", "Saving note…") so the
   * user sees that work is actually happening across the multiple
   * Drive round-trips.
   */
  setStatus: (text: string) => void;
  /**
   * Swaps the splash from the in-flight state to the resolved
   * success state — a checkmark message plus an explicit "Close
   * tab" button. We render the button rather than relying on
   * `window.close()` alone because modern Chrome restricts scripted
   * close after `await` chains: by the time the save lands, the
   * user-gesture activation that originally allowed the close has
   * expired, and close() silently no-ops. A click on the button IS
   * a fresh user gesture and always succeeds.
   */
  showSaved: () => void;
  /**
   * Removes the splash. Called only on the fallback path so the
   * regular UI can mount cleanly.
   */
  remove: () => void;
}

/**
 * Splash spinner — borderless ring rotating via CSS keyframes. The
 * `@keyframes` rule is injected once at splash-render time so we
 * don't depend on `styles.css` having loaded.
 */
const SPINNER_KEYFRAMES_RULE =
  "@keyframes sutrapad-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}";

/**
 * Renders a centred splash with a spinning ring + headline + a
 * status line that the runner narrates step-by-step. Built directly
 * with DOM APIs (no React, no styles import) so it shows up before
 * anything heavier loads.
 */
function showSavingSplash(): SavingSplashHandle {
  // Inject keyframes once. We can't rely on `styles.css` being
  // loaded yet — it may be the lighter silent path skipping it
  // entirely.
  if (!document.getElementById("sutrapad-silent-splash-styles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "sutrapad-silent-splash-styles";
    styleEl.textContent = SPINNER_KEYFRAMES_RULE;
    document.head.appendChild(styleEl);
  }

  const overlay = document.createElement("div");
  overlay.id = "sutrapad-silent-splash";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:14px",
    "background:#fafaf7",
    "color:#374151",
    "font:16px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif",
    "padding:24px",
    "text-align:center",
  ].join(";");

  const spinner = document.createElement("div");
  spinner.style.cssText = [
    "width:32px",
    "height:32px",
    "border:3px solid rgba(99,102,241,0.18)",
    "border-top-color:#6366f1",
    "border-radius:50%",
    "animation:sutrapad-spin 0.85s linear infinite",
  ].join(";");
  overlay.appendChild(spinner);

  const headline = document.createElement("p");
  headline.style.cssText = "margin:0;font-size:16px;font-weight:500";
  headline.textContent = "Saving to SutraPad\u2026";
  overlay.appendChild(headline);

  const status = document.createElement("p");
  status.style.cssText = "margin:0;font-size:13px;color:#6b7280";
  // Empty by default — runner narrates as it goes.
  overlay.appendChild(status);

  document.body.appendChild(overlay);

  return {
    setStatus: (text) => {
      status.textContent = text;
    },
    showSaved: () => {
      // Replace spinner with a checkmark "tile" so the resolved
      // state is visually distinct from the in-flight one.
      spinner.style.cssText = [
        "width:36px",
        "height:36px",
        "border-radius:50%",
        "background:#dcfce7",
        "color:#16a34a",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "font-size:20px",
        "font-weight:700",
      ].join(";");
      spinner.textContent = "\u2713";

      headline.textContent = "Saved to SutraPad";
      headline.style.color = "#1f2937";
      status.textContent = "";

      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Close tab";
      close.style.cssText = [
        "appearance:none",
        "border:1px solid #c7d2fe",
        "background:#eef2ff",
        "color:#1e3a8a",
        "padding:10px 20px",
        "border-radius:999px",
        "font:inherit",
        "font-weight:500",
        "cursor:pointer",
      ].join(";");
      close.addEventListener("click", () => {
        // Click-driven close has fresh user-gesture activation, so
        // Chrome accepts it even after long await chains. If the
        // browser still refuses (Safari + standalone PWAs are the
        // typical holdouts), the user can close the tab themselves
        // — at least the success state is visible.
        window.close();
      });
      overlay.appendChild(close);
    },
    remove: () => overlay.remove(),
  };
}

/**
 * Runs the full silent-capture pipeline. Returns once the outcome is
 * known. Never throws — failure is communicated via the returned
 * `SilentCaptureResult`.
 */
export async function runSilentCapture(
  options: RunSilentCaptureOptions = {},
): Promise<SilentCaptureResult> {
  const currentUrl = options.currentUrl ?? window.location.href;
  const splash = showSavingSplash();

  // Stage 1 — parse the capture from URL params. If there's no `url`
  // param, the bookmarklet built the URL wrong and there's nothing to
  // save. Surface as a fallback so the regular app loads in case the
  // user lands on `/?silent=1` with no payload (a stale shortcut
  // perhaps).
  const payload = readUrlCapture(currentUrl);
  if (!payload) {
    splash.remove();
    return { kind: "needs-fallback", reason: "no-capture" };
  }
  const selection = extractSelectionFromUrl(currentUrl);

  // Stage 2 — restore auth. Crucially we DO NOT call
  // `auth.initialize()` here: that loads the Google Identity
  // Services script (a network round-trip) which is only needed
  // for sign-in / token refresh flows. `restorePersistedSession`
  // is purely a localStorage read + access-token assignment — no
  // network. Skipping initialize() shaves the cold GIS load off
  // the critical path, which is the most user-visible chunk of
  // the "Saving…" wait.
  //
  // If the persisted session is missing or expired, we surface
  // `no-auth` and let `main.ts` mount the regular UI so the user
  // can sign in there. We don't try to refresh in the silent path
  // because refresh requires GIS + a popup that defeats the whole
  // "no UI" promise.
  splash.setStatus("Signing in\u2026");
  const auth = new GoogleAuthService();
  const profile = await auth.restorePersistedSession();
  const token = auth.getAccessToken();
  if (!profile || !token) {
    splash.remove();
    return { kind: "needs-fallback", reason: "no-auth" };
  }

  // Stages 3-5 — load remote, append note, push back. We deliberately
  // don't merge with localStorage here: this tab is fresh, its
  // local view is empty, and the source of truth for the duration
  // of this single capture is whatever Drive has right now.
  try {
    const store = new GoogleDriveStore(token);
    splash.setStatus("Loading library\u2026");
    const remote = await store.loadWorkspace();
    const body = buildSilentCaptureBody(selection, payload.url);
    const next = createTextNoteWorkspace(remote, {
      title: payload.title ?? payload.url,
      body,
      captureContext: payload.captureContext
        ? { ...payload.captureContext, source: "url-capture" }
        : { source: "url-capture" },
    });
    // Mirror the main app's empty-draft hygiene before push so a
    // stale Untitled stub from a different session doesn't ride
    // along with the silent capture.
    const cleaned = stripEmptyDraftNotes(next);
    splash.setStatus("Saving note\u2026");
    await store.saveWorkspace(cleaned);
  } catch {
    splash.remove();
    return { kind: "needs-fallback", reason: "save-failed" };
  }

  // Best-effort auto-close. `window.close()` from a script after a
  // long `await` chain hits two browser-level guardrails:
  //
  //   - The user-gesture activation that opened the tab has
  //     expired by the time we get here (multiple network round
  //     trips), so Chrome may decline the close.
  //   - On iOS Safari, scripted close on tabs is essentially a
  //     no-op regardless of opener state.
  //
  // We try anyway — for browsers that still allow it (recent
  // Firefox, some Chrome contexts) the tab vanishes and the
  // `showSaved` call below is a no-op against a destroyed
  // document. For everywhere else, the splash flips to a "Saved
  // ✓ [Close tab]" state with an explicit button; the click is
  // a fresh user gesture, which `window.close()` accepts.
  window.close();
  splash.showSaved();
  return { kind: "closed" };
}
