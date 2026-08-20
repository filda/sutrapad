// @vitest-environment happy-dom
//
// First focused test for `src/app/view/update-notification.ts` — the
// "Update available!" banner `vite-plugin-pwa` triggers when a new service
// worker is waiting. Small, and never exercised: the smoke test never has a
// waiting worker, so nothing had ever run this file's controller.
//
// What carries weight here is the state machine, not the copy:
//
//   - **it starts hidden.** The banner is appended to the document at boot and
//     only unhides when a worker is actually waiting. A banner that renders
//     visible announces a phantom update on every cold start.
//   - **`hidden` is the single switch** for both the controller and the
//     dismiss button, so `hide()` and "Later" have to converge on the same
//     state — and `show()` after a dismiss has to bring it back, because a
//     second worker can land in the same session.
//   - **`setBusy` is reversible.** The reload can fail (the worker never takes
//     control, the fetch for the new bundle 404s), and the user is then stuck
//     looking at a disabled "Reloading…" button unless `setBusy(false)`
//     restores both buttons *and* the label.
//   - **dismiss hides, reload does not.** Reload keeps the banner up because
//     the page is about to be replaced; hiding it first would flash an empty
//     gap for the last frame before navigation.
//
// `onDismiss` is optional, so the no-callback path gets its own test: the
// banner must still hide.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdateNotification } from "../src/app/view/update-notification";

function mount(onDismiss?: () => void) {
  const onReload = vi.fn();
  const controller = createUpdateNotification(
    onDismiss ? { onReload, onDismiss } : { onReload },
  );
  document.body.append(controller.element);
  const reload = controller.element.querySelector<HTMLButtonElement>(
    ".update-banner-reload",
  );
  const dismiss = controller.element.querySelector<HTMLButtonElement>(
    ".update-banner-dismiss",
  );
  return { controller, onReload, reload, dismiss };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("createUpdateNotification markup", () => {
  it("announces itself politely and starts hidden", () => {
    const { controller } = mount();

    expect(controller.element.className).toBe("update-banner");
    expect(controller.element.getAttribute("role")).toBe("status");
    // Assertive would cut across whatever the user is reading, for an update
    // that can wait.
    expect(controller.element.getAttribute("aria-live")).toBe("polite");
    // Appended at boot, shown only once a worker is really waiting.
    expect(controller.element.hidden).toBe(true);
  });

  it("puts the message before the actions", () => {
    const { controller } = mount();

    expect([...controller.element.children].map((child) => child.className)).toEqual([
      "update-banner-message",
      "update-banner-actions",
    ]);
  });

  it("carries the headline and the explanation", () => {
    const { controller } = mount();
    const message = controller.element.querySelector(".update-banner-message");

    expect(message?.querySelector("strong")?.textContent).toBe("Update available!");
    expect(message?.querySelector("span")?.textContent).toBe(
      "A newer version of SutraPad is ready.",
    );
  });

  it("offers reload as the primary action and Later as the ghost", () => {
    const { reload, dismiss } = mount();

    expect(reload?.type).toBe("button");
    expect(reload?.className).toBe("button button-primary update-banner-reload");
    expect(reload?.textContent).toBe("Reload");

    expect(dismiss?.type).toBe("button");
    expect(dismiss?.className).toBe("button button-ghost update-banner-dismiss");
    expect(dismiss?.textContent).toBe("Later");
    // "Later" alone is ambiguous out of context in a screen-reader button list.
    expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss update notification");
  });

  it("keeps reload ahead of Later in the tab order", () => {
    const { controller } = mount();

    expect(
      [...(controller.element.querySelector(".update-banner-actions")?.children ?? [])].map(
        (child) => child.className,
      ),
    ).toEqual([
      "button button-primary update-banner-reload",
      "button button-ghost update-banner-dismiss",
    ]);
  });
});

describe("createUpdateNotification visibility", () => {
  it("shows and hides through the controller", () => {
    const { controller } = mount();

    controller.show();
    expect(controller.element.hidden).toBe(false);

    controller.hide();
    expect(controller.element.hidden).toBe(true);
  });

  it("can be shown again after being dismissed", () => {
    // A second worker can land in the same session; the dismiss must not be
    // a one-way door.
    const { controller, dismiss } = mount();
    controller.show();
    dismiss?.click();

    controller.show();

    expect(controller.element.hidden).toBe(false);
  });

  it("is idempotent in both directions", () => {
    const { controller } = mount();

    controller.show();
    controller.show();
    expect(controller.element.hidden).toBe(false);

    controller.hide();
    controller.hide();
    expect(controller.element.hidden).toBe(true);
  });
});

describe("createUpdateNotification actions", () => {
  it("reports the reload without hiding the banner", () => {
    // The page is about to be replaced — hiding first would leave an empty
    // gap for the final frame.
    const { controller, onReload, reload } = mount();
    controller.show();

    reload?.click();

    expect(onReload).toHaveBeenCalledOnce();
    expect(controller.element.hidden).toBe(false);
  });

  it("hides the banner and reports the dismissal", () => {
    const onDismiss = vi.fn();
    const { controller, dismiss, onReload } = mount(onDismiss);
    controller.show();

    dismiss?.click();

    expect(controller.element.hidden).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("still hides when no dismiss handler was given", () => {
    // `onDismiss` is optional; the optional call must not swallow the hide.
    const { controller, dismiss } = mount();
    controller.show();

    dismiss?.click();

    expect(controller.element.hidden).toBe(true);
  });

  it("does not fire a handler on either button before it is clicked", () => {
    const onDismiss = vi.fn();
    const { onReload } = mount(onDismiss);

    expect(onReload).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("createUpdateNotification setBusy", () => {
  it("locks both buttons and relabels reload while the reload is in flight", () => {
    const { controller, reload, dismiss } = mount();

    controller.setBusy(true);

    expect(reload?.disabled).toBe(true);
    // Dismissing mid-reload would hide the banner while the page is already
    // being swapped out.
    expect(dismiss?.disabled).toBe(true);
    expect(reload?.textContent).toBe("Reloading…");
  });

  it("restores both buttons and the label when the reload fails", () => {
    // The waiting worker can refuse to take control; leaving the banner
    // disabled would strand the user on the old bundle with no way to retry.
    const { controller, onReload, reload, dismiss } = mount();
    controller.setBusy(true);

    controller.setBusy(false);

    expect(reload?.disabled).toBe(false);
    expect(dismiss?.disabled).toBe(false);
    expect(reload?.textContent).toBe("Reload");

    reload?.click();
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("starts out enabled", () => {
    const { reload, dismiss } = mount();

    expect(reload?.disabled).toBe(false);
    expect(dismiss?.disabled).toBe(false);
  });

  it("leaves visibility alone", () => {
    // Busy is a button state, not a banner state — the two are independent.
    const { controller } = mount();
    controller.show();

    controller.setBusy(true);

    expect(controller.element.hidden).toBe(false);
  });
});
