// @vitest-environment happy-dom
//
// First focused test for `src/app/silent-capture-runner.ts` — the bookmarklet's
// silent-capture bootstrap. `main.ts` loads it instead of `createApp` whenever
// the URL carries `?silent=1`, so nothing in the normal app ever executes it
// and the smoke test never reaches it. 552 lines, entirely unmeasured.
//
// It is worth the effort because of what it is: the path where the user has
// already clicked, the tab is already open, and the only two outcomes are
// "the note is on Drive" or "the capture is gone". Everything here exists to
// make the second one impossible:
//
//   - **the buffer flow is the whole point.** Silent refresh fails routinely
//     on iOS Safari (strict ITP). Rather than dropping the capture, the runner
//     stashes the URL in sessionStorage, asks for one interactive tap, and
//     saves. A mutant that turns the failed-refresh branch into a fallback
//     loses the note on every Safari capture.
//   - **the retry loop must loop.** A closed popup, a refused scope, a
//     sign-in that resolves without a token — each shows an error and returns
//     to the auth prompt. `continue` instead of a return is what keeps the
//     buffered capture alive across a mishap.
//   - **`window.close()` fires before `showSaved()`, and the button exists
//     anyway.** After a long await chain the tab's user-gesture activation
//     has expired and Chrome declines the scripted close; the rendered
//     "Close tab" button is a fresh gesture that always works. Losing either
//     half strands the user on a spinner.
//   - **`clearPendingSave` runs on both exits from `finishSave`.** A buffer
//     left behind after a failed save is a capture that can be replayed.
//
// `GoogleAuthService` and `GoogleDriveStore` are mocked — they are network
// round-trips with their own suites. The URL parsers, `buildSilentCaptureBody`
// and `createNote` are real, exactly as in `lifecycle-capture-import`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SutraPadDocument } from "../src/types";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  bootstrap: vi.fn(),
  getAccessToken: vi.fn(),
  signIn: vi.fn(),
  appendNoteToWorkspace: vi.fn(),
  storeTokens: [] as string[],
}));

vi.mock("../src/services/google-auth", () => ({
  GoogleAuthService: class {
    initialize = mocks.initialize;
    bootstrap = mocks.bootstrap;
    getAccessToken = mocks.getAccessToken;
    signIn = mocks.signIn;
  },
}));

vi.mock("../src/services/drive-store", () => ({
  GoogleDriveStore: class {
    appendNoteToWorkspace = mocks.appendNoteToWorkspace;
    constructor(token: string) {
      mocks.storeTokens.push(token);
    }
  },
}));

const { runSilentCapture } = await import("../src/app/silent-capture-runner");

const PENDING_SAVE_KEY = "sutrapad-pending-save";
const CAPTURE =
  "https://notes.example.com/?silent=1&url=https%3A%2F%2Fexample.com%2Fclanek&title=Titulek";

const splash = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("#sutrapad-silent-splash");

const line = (selector: string): string | null | undefined =>
  splash()?.querySelectorAll("p")[selector === "headline" ? 0 : 1]?.textContent;

/** Every action button currently rendered in the splash, by label. */
const actions = (): string[] =>
  [...(splash()?.querySelectorAll("[data-splash-action]") ?? [])].map(
    (node) => node.textContent ?? "",
  );

/** Waits for a splash button with this label, then clicks it. */
async function tap(label: string): Promise<void> {
  const button = await vi.waitFor(() => {
    const found = [...(splash()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (node) => node.textContent === label,
    );
    if (!found) throw new Error(`no "${label}" button yet`);
    return found;
  });
  button.click();
}

/** The spinner, or the badge that replaced it — first child of the overlay. */
const badge = (): HTMLElement | null =>
  (splash()?.firstElementChild as HTMLElement | null) ?? null;

/**
 * Reads a fixed list of style properties off an element. Asserting the whole
 * `cssText` string would be shorter but pins happy-dom's shorthand
 * serialisation (`border: none none`, an expanded `font:`), which changes on
 * an engine upgrade for no behavioural reason.
 */
const styleOf = (element: Element | null, properties: readonly string[]): string[] =>
  properties.map((property) => {
    const value = (element as HTMLElement | null)?.style.getPropertyValue(property) ?? "";
    return `${property}: ${value}`;
  });

/** The note handed to Drive by the most recent save. */
const savedNote = (): SutraPadDocument =>
  mocks.appendNoteToWorkspace.mock.calls.at(-1)?.[0] as SutraPadDocument;

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  window.sessionStorage.clear();
  vi.clearAllMocks();
  mocks.storeTokens.length = 0;
  mocks.initialize.mockResolvedValue(undefined);
  mocks.bootstrap.mockResolvedValue({ name: "Filip", email: "f@example.com", picture: "" });
  mocks.getAccessToken.mockReturnValue("tok-123");
  mocks.signIn.mockResolvedValue({ name: "Filip", email: "f@example.com", picture: "" });
  mocks.appendNoteToWorkspace.mockResolvedValue(undefined);
  vi.spyOn(window, "close").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSilentCapture splash", () => {
  it("renders a polite live region over everything before any work starts", async () => {
    await runSilentCapture({ currentUrl: CAPTURE });

    const overlay = splash();
    expect(overlay?.getAttribute("role")).toBe("status");
    expect(overlay?.getAttribute("aria-live")).toBe("polite");
    // Above every app layer: this tab shows nothing else.
    expect(overlay?.style.zIndex).toBe("2147483647");
    expect(overlay?.style.position).toBe("fixed");
  });

  it("injects the spinner keyframes rather than relying on the stylesheet", async () => {
    // The silent path may skip `styles.css` entirely, so a CSS-file
    // animation would leave a motionless ring.
    await runSilentCapture({ currentUrl: CAPTURE });

    const style = document.querySelector("#sutrapad-silent-splash-styles");
    expect(style?.textContent).toContain("@keyframes sutrapad-spin");
  });

  it("injects the keyframes only once across runs", async () => {
    await runSilentCapture({ currentUrl: CAPTURE });
    document.body.innerHTML = "";
    await runSilentCapture({ currentUrl: CAPTURE });

    expect(document.querySelectorAll("#sutrapad-silent-splash-styles")).toHaveLength(1);
  });

  it("narrates each stage in the status line", async () => {
    const seen: string[] = [];
    mocks.initialize.mockImplementation(() => {
      seen.push(line("status") ?? "");
      return Promise.resolve();
    });
    mocks.appendNoteToWorkspace.mockImplementation(() => {
      seen.push(line("status") ?? "");
      return Promise.resolve();
    });

    await runSilentCapture({ currentUrl: CAPTURE });

    expect(seen).toEqual(["Signing in…", "Saving note…"]);
  });
});

describe("runSilentCapture splash presentation", () => {
  // The splash is the only UI this whole flow has, and it is styled entirely
  // inline (no stylesheet is guaranteed to have loaded). That makes the style
  // strings behaviour, not decoration: without `position: fixed` + `inset: 0`
  // the overlay does not cover the page, without the flex trio it is not
  // centred, and the spinner's `animation` is the only thing that says work
  // is happening. Asserted as one array per element, the way a copy table is.

  it("covers and centres the page", async () => {
    await runSilentCapture({ currentUrl: CAPTURE });

    expect(
      styleOf(splash(), [
        "position",
        "inset",
        "z-index",
        "display",
        "flex-direction",
        "align-items",
        "justify-content",
        "gap",
        "background",
        "color",
        "padding",
        "text-align",
        "font",
      ]),
    ).toEqual([
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "display: flex",
      "flex-direction: column",
      "align-items: center",
      "justify-content: center",
      "gap: 14px",
      "background: #fafaf7",
      "color: #374151",
      "padding: 24px",
      "text-align: center",
      // A system stack, not the app font: `styles.css` may not have loaded.
      'font: 16px / 1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
    ]);
  });

  it("spins the ring off the injected keyframes", async () => {
    // A borderless ring with no `animation` is a static grey circle — the
    // user reads that as "frozen".
    const running = runSilentCapture({ currentUrl: CAPTURE });

    expect(
      styleOf(badge(), [
        "width",
        "height",
        "border-radius",
        "border-width",
        "border-style",
        // Not the `border` shorthand: `border-top-color` overrides part of
        // it, so the shorthand serialises empty.
        "border-right-color",
        "border-top-color",
        "animation",
      ]),
    ).toEqual([
      "width: 32px",
      "height: 32px",
      "border-radius: 50%",
      // The faint full ring is what the darker top segment rotates against;
      // without it there is nothing to see turning.
      "border-width: 3px",
      "border-style: solid",
      "border-right-color: rgba(99, 102, 241, 0.18)",
      "border-top-color: #6366f1",
      "animation: sutrapad-spin 0.85s linear infinite",
    ]);
    await running;
  });

  it("opens on the in-flight headline", async () => {
    // The status line under it is left empty by the splash itself — the
    // runner has already narrated "Signing in…" into it by the time control
    // returns here, which is exactly the point: no placeholder flashes first.
    const running = runSilentCapture({ currentUrl: CAPTURE });

    expect(line("headline")).toBe("Saving to SutraPad…");
    expect(line("status")).toBe("Signing in…");
    await running;
  });

  it("sizes the headline above the status line", async () => {
    const running = runSilentCapture({ currentUrl: CAPTURE });
    const paragraphs = [...(splash()?.querySelectorAll("p") ?? [])];

    expect(styleOf(paragraphs[0] ?? null, ["margin", "font-size", "font-weight"])).toEqual([
      "margin: 0px",
      "font-size: 16px",
      "font-weight: 500",
    ]);
    expect(styleOf(paragraphs[1] ?? null, ["margin", "font-size", "color"])).toEqual([
      "margin: 0px",
      "font-size: 13px",
      "color: #6b7280",
    ]);
    await running;
  });

  it("swaps the ring for a green tick when the save lands", async () => {
    await runSilentCapture({ currentUrl: CAPTURE });

    expect(badge()?.textContent).toBe("✓");
    expect(
      styleOf(badge(), [
        "width",
        "height",
        "border-radius",
        "background",
        "color",
        "display",
        "align-items",
        "justify-content",
        "font-size",
        "font-weight",
      ]),
    ).toEqual([
      "width: 36px",
      "height: 36px",
      // A round tile with the glyph optically centred — the flex trio is the
      // only thing centring it, since the badge has no line-height set.
      "border-radius: 50%",
      "background: #dcfce7",
      "color: #16a34a",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "font-size: 20px",
      "font-weight: 700",
    ]);
    // The badge stops spinning: the animation must be gone, not just hidden.
    expect(badge()?.style.getPropertyValue("animation")).toBe("");
    expect(line("status")).toBe("");
  });

  it("swaps in a lock badge and its own copy when a tap is needed", async () => {
    mocks.bootstrap.mockResolvedValue(null);
    const running = runSilentCapture({ currentUrl: CAPTURE });
    await vi.waitFor(() => expect(actions()).toHaveLength(2));

    expect(badge()?.textContent).toBe("\u{1F512}");
    expect(styleOf(badge(), ["background", "color"])).toEqual([
      "background: #eef2ff",
      "color: #1e3a8a",
    ]);
    expect(splash()?.querySelectorAll<HTMLElement>("p")[0]?.style.color).toBe("#1f2937");
    expect(line("status")).toBe(
      "Your browser needs a fresh sign-in nod — tap below and we'll save right after.",
    );

    await tap("Open SutraPad instead");
    await running;
  });

  it("swaps in a red badge when the sign-in fails", async () => {
    mocks.bootstrap.mockResolvedValue(null);
    mocks.signIn.mockRejectedValueOnce(new Error("Popup closed by user."));
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await vi.waitFor(() => expect(actions()).toEqual(["Try again"]));

    expect(badge()?.textContent).toBe("!");
    expect(styleOf(badge(), ["background", "color"])).toEqual([
      "background: #fee2e2",
      "color: #b91c1c",
    ]);
    expect(splash()?.querySelectorAll<HTMLElement>("p")[0]?.style.color).toBe("#1f2937");
    await tap("Try again");
    await tap("Open SutraPad instead");
    await running;
  });

  it("darkens the headline out of the in-flight state", async () => {
    // The resting headline inherits the overlay's softer `#374151`; every
    // resolved state promotes it.
    const running = runSilentCapture({ currentUrl: CAPTURE });
    expect(splash()?.querySelectorAll<HTMLElement>("p")[0]?.style.color).toBe("");

    await running;

    expect(splash()?.querySelectorAll<HTMLElement>("p")[0]?.style.color).toBe("#1f2937");
  });

  it("styles the primary action as a filled pill and the secondary as a link", async () => {
    // The two variants are one boolean at each call site, so the styling is
    // the only thing that says which action the user is meant to take.
    mocks.bootstrap.mockResolvedValue(null);
    const running = runSilentCapture({ currentUrl: CAPTURE });
    await vi.waitFor(() => expect(actions()).toHaveLength(2));
    const buttons = [...(splash()?.querySelectorAll<HTMLButtonElement>("button") ?? [])];

    expect(buttons.map((button) => button.dataset.splashAction)).toEqual([
      "primary",
      "secondary",
    ]);
    expect(
      styleOf(buttons[0] ?? null, [
        "appearance",
        "border",
        "background",
        "color",
        "padding",
        "border-radius",
        "font-family",
        "font-weight",
        "cursor",
      ]),
    ).toEqual([
      // `appearance: none` strips the platform button chrome; without it the
      // pill renders as a grey OS button on Safari.
      "appearance: none",
      "border: 1px solid #c7d2fe",
      "background: #eef2ff",
      "color: #1e3a8a",
      "padding: 10px 20px",
      "border-radius: 999px",
      // `font: inherit` — the splash sets the family on the overlay.
      "font-family: inherit",
      "font-weight: 500",
      "cursor: pointer",
    ]);
    expect(
      styleOf(buttons[1] ?? null, [
        "appearance",
        "border",
        "background",
        "color",
        "padding",
        "font-family",
        "font-size",
        "text-decoration",
        "cursor",
      ]),
    ).toEqual([
      "appearance: none",
      "border: none none",
      "background: transparent",
      "color: #6b7280",
      "padding: 6px 12px",
      "font-family: inherit",
      "font-size: 13px",
      "text-decoration: underline",
      "cursor: pointer",
    ]);
    expect(buttons.every((button) => button.type === "button")).toBe(true);

    await tap("Open SutraPad instead");
    await running;
  });

  it("renders the saved and retry actions as primary", async () => {
    await runSilentCapture({ currentUrl: CAPTURE });

    expect(
      splash()?.querySelector<HTMLElement>("button")?.dataset.splashAction,
    ).toBe("primary");
  });

  it("marks the retry button primary too", async () => {
    mocks.bootstrap.mockResolvedValue(null);
    mocks.signIn.mockRejectedValueOnce(new Error("Popup closed by user."));
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await vi.waitFor(() => expect(actions()).toEqual(["Try again"]));

    expect(
      splash()?.querySelector<HTMLElement>("button")?.dataset.splashAction,
    ).toBe("primary");
    await tap("Try again");
    await tap("Open SutraPad instead");
    await running;
  });
});

describe("runSilentCapture with no payload", () => {
  it("tears the splash down and asks for the regular UI", async () => {
    const result = await runSilentCapture({
      currentUrl: "https://notes.example.com/?silent=1",
    });

    expect(result).toEqual({ kind: "needs-fallback", reason: "no-capture" });
    // The main app is about to mount; a leftover fixed overlay would cover it.
    expect(splash()).toBeNull();
  });

  it("does not reach for auth or Drive", async () => {
    await runSilentCapture({ currentUrl: "https://notes.example.com/?silent=1" });

    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.appendNoteToWorkspace).not.toHaveBeenCalled();
  });

  it("treats a rejected capture URL as no payload", async () => {
    // `readUrlCapture` drops `javascript:` outright rather than sanitising.
    const result = await runSilentCapture({
      currentUrl: "https://notes.example.com/?silent=1&url=javascript:alert(1)",
    });

    expect(result).toEqual({ kind: "needs-fallback", reason: "no-capture" });
  });

  it("reads window.location when the caller passes no URL", async () => {
    // Production callers pass nothing; the override exists for tests.
    window.location.href = "https://notes.example.com/?silent=1";

    expect(await runSilentCapture()).toEqual({
      kind: "needs-fallback",
      reason: "no-capture",
    });
  });
});

describe("runSilentCapture happy path", () => {
  it("saves the note and reports the tab closed", async () => {
    const result = await runSilentCapture({ currentUrl: CAPTURE });

    expect(result).toEqual({ kind: "closed" });
    expect(mocks.appendNoteToWorkspace).toHaveBeenCalledOnce();
    expect(mocks.storeTokens).toEqual(["tok-123"]);
  });

  it("builds the note from the capture params", async () => {
    await runSilentCapture({ currentUrl: CAPTURE });

    expect(savedNote()).toMatchObject({
      title: "Titulek",
      body: "https://example.com/clanek",
      urls: ["https://example.com/clanek"],
      captureContext: { source: "url-capture" },
    });
  });

  it("falls back to the URL as the title", async () => {
    await runSilentCapture({
      currentUrl: "https://notes.example.com/?silent=1&url=https%3A%2F%2Fexample.com%2Fa",
    });

    expect(savedNote().title).toBe("https://example.com/a");
  });

  it("keeps the selection above the source link", async () => {
    await runSilentCapture({
      currentUrl: `${CAPTURE}&selection=Cituju%20tohle`,
    });

    expect(savedNote().body).toBe("Cituju tohle\n\nhttps://example.com/clanek");
    expect(savedNote().urls).toEqual(["https://example.com/clanek"]);
  });

  it("stamps url-capture over whatever the bookmarklet claimed", async () => {
    // `?capture=` is attacker-controllable — a page could claim the note was
    // typed in-app, which would hide it from the "captured externally" hint.
    const snapshot = JSON.stringify({ source: "new-note", referrer: "https://news.example.com/" });
    await runSilentCapture({
      currentUrl: `${CAPTURE}&capture=${encodeURIComponent(snapshot)}`,
    });

    expect(savedNote().captureContext).toMatchObject({
      source: "url-capture",
      referrer: "https://news.example.com/",
    });
  });

  it("tries the scripted close and still renders the button", async () => {
    // Both halves: the close may be declined after a long await chain, and
    // the button is the fresh user gesture that always works.
    await runSilentCapture({ currentUrl: CAPTURE });

    expect(window.close).toHaveBeenCalledOnce();
    expect(line("headline")).toBe("Saved to SutraPad");
    expect(actions()).toEqual(["Close tab"]);
  });

  it("closes the tab when the button is clicked", async () => {
    await runSilentCapture({ currentUrl: CAPTURE });
    vi.mocked(window.close).mockClear();

    await tap("Close tab");

    expect(window.close).toHaveBeenCalledOnce();
  });

  it("leaves nothing buffered behind", async () => {
    await runSilentCapture({ currentUrl: CAPTURE });

    expect(window.sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  });
});

describe("runSilentCapture save-path invariant", () => {
  it("only ever saves a URL that already parsed", async () => {
    // `saveCaptureToDrive` re-parses the capture URL and throws "Capture
    // payload missing from URL." if it comes back empty. That throw is
    // unreachable: every path into it goes through `finishSave`, which is
    // only called with the same `currentUrl` that `runSilentCapture` already
    // parsed at the top — and a URL that failed there returns `no-capture`
    // long before any save. Asserting the invariant rather than the throw
    // means the guard wakes up if a future caller ever hands `finishSave` a
    // different URL.
    const { readUrlCapture } = await import("../src/lib/url-capture");

    await runSilentCapture({ currentUrl: CAPTURE });

    expect(mocks.appendNoteToWorkspace).toHaveBeenCalledOnce();
    expect(readUrlCapture(CAPTURE)).not.toBeNull();
    // And the failing shape never reaches Drive at all.
    mocks.appendNoteToWorkspace.mockClear();
    await runSilentCapture({ currentUrl: "https://notes.example.com/?silent=1" });
    expect(mocks.appendNoteToWorkspace).not.toHaveBeenCalled();
  });
});

describe("runSilentCapture save failure", () => {
  it("falls back to the regular UI and clears the buffer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("Drive 503");
    mocks.appendNoteToWorkspace.mockRejectedValue(failure);

    const result = await runSilentCapture({ currentUrl: CAPTURE });

    expect(result).toEqual({ kind: "needs-fallback", reason: "save-failed" });
    // A buffer left behind is a capture that can be replayed later.
    expect(window.sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
    expect(splash()).toBeNull();
    expect(warn).toHaveBeenCalledWith("Silent capture save failed:", failure);
    expect(window.close).not.toHaveBeenCalled();
  });
});

describe("runSilentCapture buffer flow", () => {
  it("asks for one tap when the silent refresh returns no session", async () => {
    // The iOS Safari / strict-ITP case. Falling back to the main UI here
    // instead would drop the capture on every Safari save.
    mocks.bootstrap.mockResolvedValue(null);
    const running = runSilentCapture({ currentUrl: CAPTURE });
    await vi.waitFor(() => expect(actions()).toHaveLength(2));

    expect(line("headline")).toBe("One quick tap to save");
    expect(actions()).toEqual(["Authorize & save", "Open SutraPad instead"]);
    // The capture survives a mid-flow reload.
    expect(window.sessionStorage.getItem(PENDING_SAVE_KEY)).toBe(CAPTURE);

    await tap("Open SutraPad instead");
    await running;
  });

  it("takes the same path when the GIS bootstrap throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("script blocked");
    mocks.bootstrap.mockRejectedValue(failure);
    const running = runSilentCapture({ currentUrl: CAPTURE });
    await vi.waitFor(() => expect(actions()).toHaveLength(2));

    expect(warn).toHaveBeenCalledWith("Silent capture: GIS bootstrap failed:", failure);
    await tap("Open SutraPad instead");
    await running;
  });

  it("buffers even when the profile came back but the token did not", async () => {
    mocks.getAccessToken.mockReturnValue(null);
    const running = runSilentCapture({ currentUrl: CAPTURE });
    await vi.waitFor(() => expect(actions()).toHaveLength(2));

    expect(mocks.appendNoteToWorkspace).not.toHaveBeenCalled();
    await tap("Open SutraPad instead");
    await running;
  });

  it("narrates the interactive sign-in step", async () => {
    let during: string | null | undefined;
    mocks.bootstrap.mockResolvedValue(null);
    mocks.signIn.mockImplementation(() => {
      during = line("status");
      return Promise.resolve({ name: "Filip", email: "f@example.com", picture: "" });
    });
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await running;

    // The Google popup can take a moment; the splash has to say why.
    expect(during).toBe("Opening Google sign-in…");
  });

  it("saves after the interactive sign-in", async () => {
    mocks.bootstrap.mockResolvedValue(null);
    mocks.getAccessToken.mockReturnValue("tok-after-signin");
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");

    expect(await running).toEqual({ kind: "closed" });
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(mocks.storeTokens).toEqual(["tok-after-signin"]);
    expect(window.sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  });

  it("saves the buffered capture, not a re-read of the URL", async () => {
    mocks.bootstrap.mockResolvedValue(null);
    mocks.getAccessToken.mockReturnValue("tok-2");
    window.location.href = "https://notes.example.com/somewhere-else";
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await running;

    expect(savedNote().body).toBe("https://example.com/clanek");
  });

  it("lets the user opt out into the regular UI", async () => {
    mocks.bootstrap.mockResolvedValue(null);
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Open SutraPad instead");

    expect(await running).toEqual({ kind: "needs-fallback", reason: "user-fallback" });
    expect(splash()).toBeNull();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("keeps the buffer on the opt-out path", async () => {
    // The capture params are still in the URL, so the main app's bootstrap
    // picks them up — but the buffer is the belt to that pair of braces.
    mocks.bootstrap.mockResolvedValue(null);
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Open SutraPad instead");
    await running;

    expect(window.sessionStorage.getItem(PENDING_SAVE_KEY)).toBe(CAPTURE);
  });

  it("survives a sessionStorage that refuses to write", async () => {
    // Private-mode Safari throws on `setItem`. Non-fatal: the URL is still
    // the source of truth.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("QuotaExceeded");
    // Spied on the instance, not `Storage.prototype` — happy-dom's storage
    // object does not route through the shared prototype.
    const setItem = vi
      .spyOn(window.sessionStorage, "setItem")
      .mockImplementation(() => {
        throw failure;
      });
    mocks.bootstrap.mockResolvedValue(null);
    mocks.getAccessToken.mockReturnValue("tok-3");
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");

    expect(await running).toEqual({ kind: "closed" });
    expect(warn).toHaveBeenCalledWith("Failed to stash pending capture:", failure);
    setItem.mockRestore();
  });
});

describe("runSilentCapture retry loop", () => {
  it("shows the sign-in error and comes back to the prompt", async () => {
    // A closed popup must not cost the capture.
    mocks.bootstrap.mockResolvedValue(null);
    mocks.getAccessToken.mockReturnValue("tok-4");
    mocks.signIn.mockRejectedValueOnce(new Error("Popup closed by user."));
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await vi.waitFor(() => expect(line("headline")).toBe("Couldn't sign in"));
    expect(line("status")).toBe("Popup closed by user.");
    expect(actions()).toEqual(["Try again"]);

    await tap("Try again");
    await tap("Authorize & save");

    expect(await running).toEqual({ kind: "closed" });
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
  });

  it("names a non-Error rejection generically", async () => {
    mocks.bootstrap.mockResolvedValue(null);
    mocks.signIn.mockRejectedValueOnce("nope");
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await vi.waitFor(() => expect(line("status")).toBe("Sign-in failed."));

    await tap("Try again");
    await tap("Open SutraPad instead");
    await running;
  });

  it("retries when the sign-in resolved without a token", async () => {
    // The popup-closed-as-the-callback-fired race: no throw, no token.
    mocks.bootstrap.mockResolvedValue(null);
    mocks.getAccessToken.mockReturnValue(null);
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await vi.waitFor(() =>
      expect(line("status")).toBe("Sign-in completed without a token. Please try again."),
    );

    expect(mocks.appendNoteToWorkspace).not.toHaveBeenCalled();
    await tap("Try again");
    await tap("Open SutraPad instead");
    await running;
  });

  it("does not stack buttons across state changes", async () => {
    // auth-required → error → auth-required. Without `clearActionButtons`
    // the splash grows a new pair of buttons on every pass.
    mocks.bootstrap.mockResolvedValue(null);
    mocks.signIn.mockRejectedValueOnce(new Error("Popup closed by user."));
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await vi.waitFor(() => expect(actions()).toEqual(["Try again"]));
    await tap("Try again");
    await vi.waitFor(() =>
      expect(actions()).toEqual(["Authorize & save", "Open SutraPad instead"]),
    );

    await tap("Open SutraPad instead");
    await running;
  });

  it("keeps the buffer across the whole retry loop", async () => {
    mocks.bootstrap.mockResolvedValue(null);
    mocks.signIn.mockRejectedValueOnce(new Error("Popup closed by user."));
    const running = runSilentCapture({ currentUrl: CAPTURE });

    await tap("Authorize & save");
    await vi.waitFor(() => expect(actions()).toEqual(["Try again"]));

    expect(window.sessionStorage.getItem(PENDING_SAVE_KEY)).toBe(CAPTURE);
    await tap("Try again");
    await tap("Open SutraPad instead");
    await running;
  });
});
