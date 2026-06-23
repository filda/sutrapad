// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { buildMicrophoneConsentCard } from "../src/app/view/shared/microphone-consent-card";
import { tick } from "./tick";

function statusText(card: HTMLElement): string {
  return card.querySelector(".settings-card-microphone-status")?.textContent ?? "";
}

function enableButton(card: HTMLElement): HTMLButtonElement | null {
  return card.querySelector<HTMLButtonElement>(".settings-card-microphone-enable");
}

describe("buildMicrophoneConsentCard", () => {
  it("shows the Enable button while the permission is still promptable", async () => {
    const card = buildMicrophoneConsentCard({
      query: () => Promise.resolve("prompt"),
      request: () => Promise.resolve("granted"),
    });
    await tick();
    expect(card.dataset.microphonePermission).toBe("prompt");
    expect(enableButton(card)?.hidden).toBe(false);
    expect(statusText(card)).toBe('Off. Turn this on to let new notes record an approximate ambient noise level. SutraPad never stores audio — only a single loudness number.');
    // Pin the static labels so a copy regression is caught.
    expect(card.querySelector(".settings-card-subheading")?.textContent).toBe(
      "Noise sensing on new notes",
    );
    expect(enableButton(card)?.textContent).toBe("Enable microphone access");
    expect(card.classList.contains("settings-card-microphone")).toBe(true);
    expect(enableButton(card)?.type).toBe("button");
  });

  it("hides the button and confirms when already granted on mount", async () => {
    const card = buildMicrophoneConsentCard({
      query: () => Promise.resolve("granted"),
      request: () => Promise.resolve("granted"),
    });
    await tick();
    expect(card.dataset.microphonePermission).toBe("granted");
    expect(enableButton(card)?.hidden).toBe(true);
    expect(statusText(card)).toBe('Microphone access is on. New notes can record an approximate ambient noise level. SutraPad never stores audio — only a single loudness number.');
  });

  it("requests access on click and reflects the granted result", async () => {
    const request = vi.fn().mockResolvedValue("granted");
    const card = buildMicrophoneConsentCard({
      query: () => Promise.resolve("prompt"),
      request,
    });
    await tick();
    const button = enableButton(card);
    if (!button) throw new Error("expected enable button");

    button.click();
    await tick();

    expect(request).toHaveBeenCalledTimes(1);
    expect(card.dataset.microphonePermission).toBe("granted");
    expect(button.hidden).toBe(true);
    expect(button.disabled).toBe(false);
  });

  it("surfaces browser-settings guidance when the request is denied", async () => {
    const card = buildMicrophoneConsentCard({
      query: () => Promise.resolve("prompt"),
      request: () => Promise.resolve("denied"),
    });
    await tick();
    enableButton(card)?.click();
    await tick();
    expect(card.dataset.microphonePermission).toBe("denied");
    expect(enableButton(card)?.hidden).toBe(true);
    expect(statusText(card)).toBe("Your browser is blocking the microphone for this site. Open your browser's site settings to allow it, then reload SutraPad.");
  });

  it("hides the button when the browser doesn't support mic access", async () => {
    const card = buildMicrophoneConsentCard({
      query: () => Promise.resolve("unsupported"),
      request: () => Promise.resolve("unsupported"),
    });
    await tick();
    expect(card.dataset.microphonePermission).toBe("unsupported");
    expect(enableButton(card)?.hidden).toBe(true);
    expect(statusText(card)).toBe("This browser can't expose microphone access to SutraPad.");
  });

  it("re-disables the button only during the in-flight request", async () => {
    let resolveRequest!: (value: "granted") => void;
    const request = vi.fn(
      () => new Promise<"granted">((resolve) => { resolveRequest = resolve; }),
    );
    const card = buildMicrophoneConsentCard({ query: () => Promise.resolve("prompt"), request });
    await tick();
    const button = enableButton(card);
    if (!button) throw new Error("expected enable button");

    button.click();
    // Synchronously after click, before the request resolves, the button is
    // disabled to prevent a double prompt.
    expect(button.disabled).toBe(true);
    resolveRequest("granted");
    await tick();
    expect(button.disabled).toBe(false);
  });
});
