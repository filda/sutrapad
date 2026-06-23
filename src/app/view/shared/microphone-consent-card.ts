/**
 * Settings opt-in for noise sensing. Noise capture
 * (`captureContext.sensors.noiseLevelDb`) only runs when the microphone
 * permission is already `granted`, and capture never prompts on its own — so
 * this card is the single in-app surface that lets the user deliberately grant
 * it. The "Enable" button calls `getUserMedia` (via `requestMicrophoneAccess`)
 * to raise the native prompt, then reflects the resulting state.
 *
 * The card owns a tiny bit of live state because the source of truth is the
 * browser's permission, not a stored preference: it queries on mount and after
 * each request, swapping the status line + button for the current state. The
 * async calls are injected (defaulting to the real navigator-backed helpers)
 * so the card is node-testable without faking `getUserMedia`.
 */
import {
  queryMicrophonePermission,
  requestMicrophoneAccess,
  type MicrophonePermissionState,
} from "../../logic/microphone-permission";

export interface MicrophoneConsentCardOptions {
  query?: () => Promise<MicrophonePermissionState>;
  request?: () => Promise<MicrophonePermissionState>;
}

export const STATUS_COPY: Record<MicrophonePermissionState, string> = {
  granted:
    "Microphone access is on. New notes can record an approximate ambient noise level. SutraPad never stores audio — only a single loudness number.",
  prompt:
    "Off. Turn this on to let new notes record an approximate ambient noise level. SutraPad never stores audio — only a single loudness number.",
  denied:
    "Your browser is blocking the microphone for this site. Open your browser's site settings to allow it, then reload SutraPad.",
  unsupported: "This browser can't expose microphone access to SutraPad.",
};

export function buildMicrophoneConsentCard({
  query = queryMicrophonePermission,
  request = requestMicrophoneAccess,
}: MicrophoneConsentCardOptions = {}): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "settings-card-privacy-toggle settings-card-microphone";

  const label = document.createElement("p");
  label.className = "settings-card-subheading";
  label.textContent = "Noise sensing on new notes";
  wrapper.append(label);

  const status = document.createElement("p");
  status.className = "settings-card-hint settings-card-microphone-status";
  status.textContent = STATUS_COPY.prompt;
  wrapper.append(status);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-primary settings-card-microphone-enable";
  button.textContent = "Enable microphone access";
  wrapper.append(button);

  function applyState(state: MicrophonePermissionState): void {
    wrapper.dataset.microphonePermission = state;
    status.textContent = STATUS_COPY[state];
    // The Enable button only makes sense while the prompt is still available.
    // Once granted/denied/unsupported, the next step is browser settings, not
    // another prompt, so the button is hidden.
    button.hidden = state !== "prompt";
  }

  button.addEventListener("click", () => {
    button.disabled = true;
    void request()
      .then(applyState)
      .finally(() => {
        button.disabled = false;
      });
  });

  // Reflect the real permission as soon as the card mounts.
  void query().then(applyState);

  return wrapper;
}
