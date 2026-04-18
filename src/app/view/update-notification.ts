/**
 * Builds the "Update available!" banner that appears when `vite-plugin-pwa`
 * detects a newly waiting service worker.
 *
 * The element is self-contained: it manages its own visibility and click
 * handlers, and can be shown or dismissed through the returned controller.
 * This keeps the DOM wiring outside `app.ts`, so the controller can be
 * swapped or stubbed in tests if needed.
 */

export interface UpdateNotificationController {
  readonly element: HTMLElement;
  show: () => void;
  hide: () => void;
  /** Puts the button into a pending state while the reload is in flight. */
  setBusy: (busy: boolean) => void;
}

export interface UpdateNotificationOptions {
  /**
   * Invoked when the user clicks the "Reload" button. The implementation
   * should call `updateSW(true)`, which skips the waiting worker and reloads
   * the page once the new service worker takes control.
   */
  onReload: () => void;
  /** Invoked when the user dismisses the banner without reloading. */
  onDismiss?: () => void;
}

export function createUpdateNotification(
  options: UpdateNotificationOptions,
): UpdateNotificationController {
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.hidden = true;

  const message = document.createElement("div");
  message.className = "update-banner-message";

  const title = document.createElement("strong");
  title.textContent = "Update available!";

  const description = document.createElement("span");
  description.textContent = "A newer version of SutraPad is ready.";

  message.append(title, description);

  const actions = document.createElement("div");
  actions.className = "update-banner-actions";

  const reloadButton = document.createElement("button");
  reloadButton.type = "button";
  reloadButton.className = "button button-primary update-banner-reload";
  reloadButton.textContent = "Reload";
  reloadButton.onclick = () => {
    options.onReload();
  };

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "button button-ghost update-banner-dismiss";
  dismissButton.setAttribute("aria-label", "Dismiss update notification");
  dismissButton.textContent = "Later";
  dismissButton.onclick = () => {
    banner.hidden = true;
    options.onDismiss?.();
  };

  actions.append(reloadButton, dismissButton);
  banner.append(message, actions);

  return {
    element: banner,
    show: () => {
      banner.hidden = false;
    },
    hide: () => {
      banner.hidden = true;
    },
    setBusy: (busy) => {
      reloadButton.disabled = busy;
      dismissButton.disabled = busy;
      reloadButton.textContent = busy ? "Reloading…" : "Reload";
    },
  };
}
