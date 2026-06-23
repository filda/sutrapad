/**
 * Microphone permission helpers for the Settings opt-in card.
 *
 * Noise sensing (`captureContext.sensors.noiseLevelDb`) is deliberately
 * silent at capture time — `resolveNoiseLevelDb` only reads the mic when the
 * permission is *already* `granted` and never raises a prompt itself. That
 * leaves a chicken-and-egg gap: a user who wants noise sensing has no in-app
 * way to grant it. These helpers are the one place that intentionally *does*
 * surface the native prompt, driven by an explicit click in Settings.
 *
 * Both functions take an injectable navigator so they stay node-testable, and
 * default to the real `navigator`. They never throw: every failure path
 * collapses to a `MicrophonePermissionState` the UI can render.
 */

/**
 * `"granted"` / `"denied"` / `"prompt"` mirror the Permissions API states;
 * `"unsupported"` covers browsers without the Permissions or mediaDevices
 * APIs (or a non-secure context where they're absent).
 */
export type MicrophonePermissionState = "granted" | "denied" | "prompt" | "unsupported";

interface PermissionStatusLike {
  state?: string;
}

interface MediaStreamTrackLike {
  stop: () => void;
}

interface MediaStreamLike {
  getTracks: () => MediaStreamTrackLike[];
}

interface NavigatorLike {
  permissions?: {
    query?: (descriptor: { name: PermissionName }) => Promise<PermissionStatusLike>;
  };
  mediaDevices?: {
    getUserMedia?: (constraints: { audio: boolean }) => Promise<MediaStreamLike>;
  };
}

/** Narrows the raw Permissions API string to our closed state set. */
function toState(state: string | undefined): MicrophonePermissionState {
  if (state === "granted" || state === "denied" || state === "prompt") return state;
  return "unsupported";
}

/**
 * Reads the current microphone permission without prompting. Returns
 * `"unsupported"` when the Permissions API is unavailable or the query throws
 * (some engines reject `{ name: "microphone" }`).
 */
export async function queryMicrophonePermission(
  navigatorLike: NavigatorLike = navigator,
): Promise<MicrophonePermissionState> {
  const query = navigatorLike.permissions?.query?.bind(navigatorLike.permissions);
  if (typeof query !== "function") return "unsupported";
  try {
    const status = await query({ name: "microphone" });
    return toState(status.state);
  } catch {
    return "unsupported";
  }
}

/**
 * Surfaces the native microphone prompt via `getUserMedia`. On grant, the
 * stream is immediately stopped (we only wanted the permission, not a live
 * recording) and `"granted"` is returned. On rejection — denied, dismissed,
 * or no device — we re-query for the accurate state, falling back to
 * `"denied"` when the Permissions API can't say.
 */
export async function requestMicrophoneAccess(
  navigatorLike: NavigatorLike = navigator,
): Promise<MicrophonePermissionState> {
  const getUserMedia = navigatorLike.mediaDevices?.getUserMedia?.bind(
    navigatorLike.mediaDevices,
  );
  if (typeof getUserMedia !== "function") return "unsupported";
  try {
    const stream = await getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return "granted";
  } catch {
    const state = await queryMicrophonePermission(navigatorLike);
    return state === "unsupported" ? "denied" : state;
  }
}
