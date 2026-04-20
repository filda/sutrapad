import { createApp } from "./app";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import {
  createBrowserUpdateEnvironment,
  createUpdateCoordinator,
} from "./app/session/sw-update";
import { createUpdateNotification } from "./app/view/update-notification";
import { applyThemeChoice, resolveInitialThemeChoice } from "./app/logic/theme";

// Apply the stored theme before any markup renders. Doing it after createApp()
// leaves a visible flash on cold loads where the default Sand palette paints
// first and is then replaced — this runs synchronously against
// <html> so the correct palette is used from the first paint.
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
