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
 *   2. Loads the Google Identity Services SDK and attempts a silent
 *      token refresh against the long-lived `accounts.google.com`
 *      session cookie.
 *   3. **Happy path** (silent refresh succeeds — typically Chrome /
 *      Firefox without strict ITP): appends the new note to Drive
 *      and closes the tab.
 *   4. **Buffer path** (silent refresh fails — typical on iOS Safari
 *      with strict ITP): stashes the capture URL into sessionStorage
 *      under a known key, renders an "Authorize & save" button, and
 *      on click runs an interactive sign-in. Once the user has
 *      authorised, the buffer is drained, the note is saved, and the
 *      tab closes — all without losing the capture even though the
 *      silent attempt failed.
 *
 * Return value tells `main.ts` whether the runner handled the flow
 * itself ("closed") or wants the regular UI mounted instead so the
 * user can finish manually ("needs-fallback").
 */

import { createNote, extractUrlsFromText } from "../lib/notebook";
import { readUrlCapture } from "../lib/url-capture";
import { GoogleAuthService } from "../services/google-auth";
import { GoogleDriveStore } from "../services/drive-store";
import {
  buildSilentCaptureBody,
  extractSelectionFromUrl,
} from "./logic/silent-capture";

/**
 * sessionStorage key used to hold the original capture URL across an
 * interactive sign-in round-trip. sessionStorage (not localStorage)
 * because the buffer is strictly tab-local — the bookmarklet always
 * opens a fresh tab, and any other open SutraPad tabs have their own
 * captures in flight that must not collide. Cleared on successful
 * save and on explicit user-driven fallback.
 */
const PENDING_SAVE_KEY = "sutrapad-pending-save";

/**
 * Outcome of the runner. `closed` means we successfully saved the
 * note and called `window.close()` (the call may not actually close
 * the tab if the browser rejects it — but we did our part). The
 * other variants tell `main.ts` "this didn't work, mount the
 * regular UI and let the user finish manually."
 *
 * Note: there's no `no-auth` reason any more — silent-refresh
 * failure is now handled in-place via the buffer flow rather than
 * falling back to the main UI. The only paths that still surface a
 * needs-fallback are: no capture payload in the URL, save failure
 * after a successful sign-in, or the user explicitly clicking the
 * "Open SutraPad instead" escape hatch in the auth-required state.
 */
export type SilentCaptureResult =
  | { kind: "closed" }
  | { kind: "needs-fallback"; reason: SilentCaptureFallbackReason };

export type SilentCaptureFallbackReason =
  | "no-capture"
  | "save-failed"
  | "user-fallback";

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
   * Swaps the splash into the "authorisation required" state: a
   * primary "Authorize & save" button (resolves the returned promise
   * when clicked) and a secondary "Open SutraPad instead" link (which
   * resolves to `null` so the runner can fall through to the regular
   * UI). Used when silent refresh fails and we need an interactive
   * gesture before continuing.
   */
  showAuthRequired: () => Promise<"authorize" | "fallback">;
  /**
   * Renders an error message with a retry button. Resolves when the
   * user clicks retry. Used after `signIn` fails (popup closed,
   * scope refused, network) so the user can try again without
   * losing the buffered capture.
   */
  showError: (message: string) => Promise<void>;
  /**
   * Removes the splash. Called on the user-fallback path so the
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
 * Builds a button DOM element styled either as a primary action
 * (filled pill) or a secondary one (text link). Module-scoped because
 * it doesn't close over anything from the splash state — the lint
 * rule `consistent-function-scoping` flags inner functions that don't
 * capture outer variables. The `data-splash-action` attribute is the
 * hook `clearActionButtons` uses to find and remove all action
 * elements when transitioning between splash states.
 */
function makeSplashButton(label: string, primary: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.setAttribute("data-splash-action", primary ? "primary" : "secondary");
  btn.style.cssText = primary
    ? [
        "appearance:none",
        "border:1px solid #c7d2fe",
        "background:#eef2ff",
        "color:#1e3a8a",
        "padding:10px 20px",
        "border-radius:999px",
        "font:inherit",
        "font-weight:500",
        "cursor:pointer",
      ].join(";")
    : [
        "appearance:none",
        "border:none",
        "background:transparent",
        "color:#6b7280",
        "padding:6px 12px",
        "font:inherit",
        "font-size:13px",
        "cursor:pointer",
        "text-decoration:underline",
      ].join(";");
  return btn;
}

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
  headline.textContent = "Saving to SutraPad…";
  overlay.appendChild(headline);

  const status = document.createElement("p");
  status.style.cssText = "margin:0;font-size:13px;color:#6b7280";
  // Empty by default — runner narrates as it goes.
  overlay.appendChild(status);

  /**
   * Replaces the spinner element with a static badge — checkmark
   * tile, lock glyph for auth-required, etc. Called by the state
   * transitions below when the splash leaves the in-flight state.
   */
  function swapSpinnerForBadge(content: string, palette: { bg: string; fg: string }): void {
    spinner.style.cssText = [
      "width:36px",
      "height:36px",
      "border-radius:50%",
      `background:${palette.bg}`,
      `color:${palette.fg}`,
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-size:20px",
      "font-weight:700",
    ].join(";");
    spinner.textContent = content;
  }

  /**
   * Removes any action buttons rendered by a previous state so the
   * splash can transition cleanly between auth-required → error →
   * back to in-flight without stacking buttons.
   */
  function clearActionButtons(): void {
    const actions = overlay.querySelectorAll("[data-splash-action]");
    actions.forEach((node) => node.remove());
  }

  document.body.appendChild(overlay);

  return {
    setStatus: (text) => {
      status.textContent = text;
    },
    showSaved: () => {
      clearActionButtons();
      swapSpinnerForBadge("✓", { bg: "#dcfce7", fg: "#16a34a" });
      headline.textContent = "Saved to SutraPad";
      headline.style.color = "#1f2937";
      status.textContent = "";

      const close = makeSplashButton("Close tab", true);
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
    showAuthRequired: () => {
      clearActionButtons();
      // Lock-glyph badge so the user gets the same visual structure
      // (badge + headline + line of context + button) as the
      // in-flight and saved states; it just signals "your input
      // needed" instead of progress.
      swapSpinnerForBadge("\u{1F512}", { bg: "#eef2ff", fg: "#1e3a8a" });
      headline.textContent = "One quick tap to save";
      headline.style.color = "#1f2937";
      status.textContent =
        "Your browser needs a fresh sign-in nod — tap below and we'll save right after.";

      return new Promise<"authorize" | "fallback">((resolve) => {
        const authorize = makeSplashButton("Authorize & save", true);
        authorize.addEventListener("click", () => resolve("authorize"));
        const fallback = makeSplashButton("Open SutraPad instead", false);
        fallback.addEventListener("click", () => resolve("fallback"));
        overlay.appendChild(authorize);
        overlay.appendChild(fallback);
      });
    },
    showError: (message) => {
      clearActionButtons();
      swapSpinnerForBadge("!", { bg: "#fee2e2", fg: "#b91c1c" });
      headline.textContent = "Couldn't sign in";
      headline.style.color = "#1f2937";
      status.textContent = message;

      return new Promise<void>((resolve) => {
        const retry = makeSplashButton("Try again", true);
        retry.addEventListener("click", () => resolve());
        overlay.appendChild(retry);
      });
    },
    remove: () => overlay.remove(),
  };
}

/**
 * Stashes the full capture URL into sessionStorage so an interactive
 * sign-in round-trip can drain it on the way back. Tab-local by
 * design (sessionStorage scope) — peer SutraPad tabs have their own
 * pending saves and must not collide. Wrapped in try/catch because
 * sessionStorage can throw in private-mode contexts; failure is
 * non-fatal because the URL is already in `window.location.href`
 * and we keep using that as the source of truth — the buffer is just
 * defence against the page reloading mid-flow.
 */
function stashPendingSave(captureUrl: string): void {
  try {
    window.sessionStorage.setItem(PENDING_SAVE_KEY, captureUrl);
  } catch (error) {
    console.warn("Failed to stash pending capture:", error);
  }
}

function clearPendingSave(): void {
  try {
    window.sessionStorage.removeItem(PENDING_SAVE_KEY);
  } catch {
    // Ignore — clearing failed is not user-visible.
  }
}

/**
 * Append-to-Drive helper extracted out of the runner for clarity.
 * Same shape as the original happy-path body but reusable from the
 * buffer-drain branch after interactive sign-in.
 */
async function saveCaptureToDrive(
  token: string,
  captureUrl: string,
): Promise<void> {
  const payload = readUrlCapture(captureUrl);
  if (!payload) {
    throw new Error("Capture payload missing from URL.");
  }
  const selection = extractSelectionFromUrl(captureUrl);
  const store = new GoogleDriveStore(token);
  const body = buildSilentCaptureBody(selection, payload.url);
  const note = createNote(
    payload.title ?? payload.url,
    undefined,
    undefined,
    payload.captureContext
      ? { ...payload.captureContext, source: "url-capture" }
      : { source: "url-capture" },
  );
  note.body = body;
  note.urls = extractUrlsFromText(body);
  await store.appendNoteToWorkspace(note);
}

/**
 * Runs the full silent-capture pipeline. Returns once the outcome is
 * known. Never throws — failure is communicated via the returned
 * `SilentCaptureResult`.
 */
// eslint-disable-next-line max-lines-per-function
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

  // Stage 2 — try to obtain a token silently. Unlike the previous
  // localStorage-backed fast path, we now MUST load the GIS script
  // and attempt a real silent refresh against `accounts.google.com`'s
  // session cookie. That's a network round-trip — typically a second
  // or so — but it's the only way to authenticate now that we no
  // longer persist tokens to disk. On Chrome / Firefox the silent
  // refresh usually succeeds (Google session is fresh, no ITP
  // blocking). On iOS Safari with strict ITP it usually fails — and
  // we hand off to the buffer flow below instead of dropping the
  // capture.
  splash.setStatus("Signing in…");
  const auth = new GoogleAuthService();
  let token: string | null = null;
  try {
    await auth.initialize();
    const profile = await auth.bootstrap();
    if (profile) {
      token = auth.getAccessToken();
    }
  } catch (error) {
    // GIS script load failed (network, CSP regression, etc.). Treat
    // as a silent-refresh failure and fall through to the buffer
    // flow — the user can retry the interactive sign-in, which will
    // re-attempt the script load.
    console.warn("Silent capture: GIS bootstrap failed:", error);
  }

  // Stage 3a — happy path. Silent refresh produced a token; save and
  // close.
  if (token) {
    return finishSave(splash, token, currentUrl);
  }

  // Stage 3b — buffer path. Stash the capture URL into sessionStorage
  // (so a hostile page reload mid-flow doesn't lose it) and ask the
  // user for a fresh interactive gesture. The "Open SutraPad instead"
  // escape hatch lets the user opt out into the main UI if they'd
  // rather sign in there.
  stashPendingSave(currentUrl);
  return runBufferFlow(auth, splash, currentUrl);
}

async function finishSave(
  splash: SavingSplashHandle,
  token: string,
  captureUrl: string,
): Promise<SilentCaptureResult> {
  try {
    splash.setStatus("Saving note…");
    await saveCaptureToDrive(token, captureUrl);
  } catch (error) {
    // Drive failures here split between three families: a 401 (token
    // somehow already stale post-bootstrap — unusual but possible if
    // the user signed out from another device between bootstrap and
    // save), a 5xx (Drive outage), and rare client-side issues like
    // Drive-quota errors. The user gets the "fallback to main app"
    // UX either way; logging the underlying error keeps the silent
    // failure debuggable in devtools so we know which class is
    // hitting users.
    console.warn("Silent capture save failed:", error);
    clearPendingSave();
    splash.remove();
    return { kind: "needs-fallback", reason: "save-failed" };
  }

  clearPendingSave();
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

/**
 * Drives the auth-required → interactive sign-in → save loop after
 * silent refresh failed. Stays in the runner UI rather than falling
 * back to the main app; the only exit to main is the user clicking
 * "Open SutraPad instead". Loops on retry so a popup-closed mishap
 * doesn't drop the buffered capture.
 *
 * Each `await` in the body has a `// eslint-disable-next-line
 * no-await-in-loop` because the iterations are inherently sequential
 * UI steps (await user click → await sign-in → on failure await
 * error tap → repeat). There's nothing to parallelise — Promise.all
 * would be wrong here.
 */
async function runBufferFlow(
  auth: GoogleAuthService,
  splash: SavingSplashHandle,
  captureUrl: string,
): Promise<SilentCaptureResult> {
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const choice = await splash.showAuthRequired();
    if (choice === "fallback") {
      // User opted out — leave the buffer in sessionStorage so the
      // main UI's bootstrap path can pick it up if we ever wire that
      // restore. Today the capture params are still in the URL so
      // `captureIncomingWorkspaceFromUrl` will process them anyway.
      splash.remove();
      return { kind: "needs-fallback", reason: "user-fallback" };
    }

    splash.setStatus("Opening Google sign-in…");
    let signInError: string | null = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      await auth.signIn();
    } catch (error) {
      signInError = error instanceof Error
        ? error.message
        : "Sign-in failed.";
    }

    if (signInError !== null) {
      // Surface the failure in the splash and wait for the user to
      // tap "Try again" — looping back to the top of the while
      // re-renders the auth-required state.
      // eslint-disable-next-line no-await-in-loop
      await splash.showError(signInError);
      continue;
    }

    const token = auth.getAccessToken();
    if (!token) {
      // signIn resolved without throwing but we still don't have a
      // token. Treat the same as a sign-in error — most likely a
      // race where the user closed the popup right as the callback
      // fired.
      // eslint-disable-next-line no-await-in-loop
      await splash.showError("Sign-in completed without a token. Please try again.");
      continue;
    }

    return finishSave(splash, token, captureUrl);
  }
}
