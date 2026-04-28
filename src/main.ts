import { createApp } from "./app";
import "./fonts";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import {
  createBrowserUpdateEnvironment,
  createUpdateCoordinator,
} from "./app/session/sw-update";
import { createUpdateNotification } from "./app/view/update-notification";
import { applyThemeChoice, resolveInitialThemeChoice } from "./app/logic/theme";
import { isSilentCapture } from "./app/logic/silent-capture";
import { runSilentCapture } from "./app/silent-capture-runner";

// The bookmarklet opens SutraPad in a new tab with `?silent=1` so we
// can save the captured URL without a redirect on the source page.
// The runner saves to Drive and then calls `window.close()` — the
// user's source page keeps focus when the tab closes. Cases that
// can't be resolved inside the runner (no payload, save failure
// after sign-in, user opting into the main UI) return
// `needs-fallback`, and we mount the regular UI instead so the user
// can inspect / retry.
//
// Note: silent-refresh failure no longer falls back here — it is
// handled in-place by the runner's buffer flow ("Authorize & save"
// button + sessionStorage hand-off across the interactive sign-in).
if (isSilentCapture(window.location.href)) {
  void runSilentCapture().then((result) => {
    if (result.kind === "needs-fallback") {
      // The silent path failed somewhere — emit a console marker so
      // devtools shows what class of failure we're on. The runner
      // already logs the underlying error for the `save-failed`
      // branch; this top-level marker tags the user-visible
      // transition (silent → main UI fallback) with the reason
      // (`no-capture` / `save-failed` / `user-fallback`) so a single
      // grep on "Silent capture" surfaces both halves of the story.
      console.warn(
        `Silent capture fell back to the main app (${result.reason}). The capture params will be processed by captureIncomingWorkspaceFromUrl on bootstrap.`,
      );
      // Strip `silent` from the URL before bootstrap — otherwise a
      // refresh would trap the user in the silent-loop fallback again.
      // The other capture params (`url`, `title`, `capture`,
      // `selection`) stay so the regular app can still process them.
      const stripped = new URL(window.location.href);
      stripped.searchParams.delete("silent");
      window.history.replaceState({}, "", stripped.toString());
      bootstrapMainApp();
    }
  });
} else {
  bootstrapMainApp();
}

function bootstrapMainApp(): void {
  // Apply the stored theme before any markup renders. Doing it after
  // createApp() leaves a visible flash on cold loads where the default
  // Sand palette paints first and is then replaced — this runs
  // synchronously against <html> so the correct palette is used from
  // the first paint.
  applyThemeChoice(resolveInitialThemeChoice());

  const root = document.querySelector<HTMLDivElement>("#app");

  if (!root) {
    throw new Error("App root was not found.");
  }

  createApp(root);

  if (import.meta.env.PROD) {
    // Holds the reload callback produced by `registerSW`. Resolved lazily so the
    // notification controller can reference it before `registerSW` returns.
    let reloadApp: ((reloadPage?: boolean) => Promise<void>) | null = null;

    const notification = createUpdateNotification({
      onReload: () => {
        notification.setBusy(true);
        // `updateSW(true)` tells the waiting worker to skipWaiting and then
        // reloads the page once it takes control. If the browser fails to
        // reload for any reason, the button stays in the busy state to avoid
        // repeated clicks; the user can still refresh manually.
        void reloadApp?.(true);
      },
    });
    document.body.append(notification.element);

    reloadApp = registerSW({
      immediate: true,
      onNeedRefresh() {
        notification.show();
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        createUpdateCoordinator({
          checkForUpdate: () => registration.update().then(() => undefined),
          environment: createBrowserUpdateEnvironment(),
        });
      },
    });
  } else if ("serviceWorker" in navigator) {
    // In dev we never register a service worker (see `devOptions.enabled: false`
    // in vite.config.ts). However, a production build served earlier on the
    // same origin may have left a worker installed. That stale worker intercepts
    // dev requests from its cache and silently breaks HMR. Unregister any
    // leftover workers on dev startup so Vite can own the response pipeline.
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        void registration.unregister();
      }
    });
    if ("caches" in window) {
      void caches.keys().then((keys) => {
        for (const key of keys) {
          void caches.delete(key);
        }
      });
    }
  }
}
