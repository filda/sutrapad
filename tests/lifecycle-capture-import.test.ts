// @vitest-environment happy-dom
//
// First focused test for `src/app/lifecycle/capture-import.ts` — the fallback
// path for a bookmarklet capture. The fast path is `silent-capture-runner`;
// this runs when that one did not, so it is the code that decides what the
// user's note actually looks like when the capture flow degrades. It was
// "only covered via the smoke test", which never arrives with capture params.
//
// Four decisions live here and nowhere else:
//
//   - **`?note=` is checked before `?url=`.** A bookmarklet that sends both
//     is a text capture, not a link capture, and the two produce visibly
//     different notes (a text body vs a URL body with `urls` extracted).
//   - **the three-step title chain** for a URL capture: the bookmarklet's own
//     `?title=`, then a fetch of the page's `<title>`, then a slug derived
//     from the URL itself. Each step only runs when the one before it came
//     back empty, and `??` (not `||`) is what lets an intentionally empty
//     title fall through rather than a whitespace one.
//   - **the selection branch.** `?selection=` alongside `?url=` reuses
//     `buildSilentCaptureBody`, deliberately, so a note reads identically
//     whether the silent runner or this fallback produced it. The module
//     comment says the selection would otherwise be *silently dropped* —
//     that is a data-loss bug with a test attached to it now.
//   - **the injected coordinates resolver.** `app.ts` swaps in
//     `async () => null` unless the location preference is exactly `"on"`,
//     so `"unanswered"` and `"off"` users never see a geolocation prompt
//     inside a capture iframe. The default must be the real resolver and the
//     injected one must actually be used.
//
// The URL parsers and the notebook creators are real — they are pure and
// observable. Mocked: `collectCaptureContext` (it fetches live weather) and
// the two network calls in `url-capture`, both of which have their own suites.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as UrlCapture from "../src/lib/url-capture";
import type { SutraPadWorkspace } from "../src/types";

const mocks = vi.hoisted(() => ({
  collectCaptureContext: vi.fn(),
  resolveTitleFromUrl: vi.fn(),
  reverseGeocodeCoordinates: vi.fn(),
  resolveCurrentCoordinates: vi.fn(),
}));

vi.mock("../src/lib/capture-context", () => ({
  collectCaptureContext: mocks.collectCaptureContext,
}));

vi.mock("../src/lib/url-capture", async (importOriginal) => ({
  ...(await importOriginal<typeof UrlCapture>()),
  resolveTitleFromUrl: mocks.resolveTitleFromUrl,
  reverseGeocodeCoordinates: mocks.reverseGeocodeCoordinates,
  resolveCurrentCoordinates: mocks.resolveCurrentCoordinates,
}));

const { captureIncomingWorkspaceFromUrl } = await import(
  "../src/app/lifecycle/capture-import"
);

const EMPTY: SutraPadWorkspace = { notes: [], activeNoteId: null };

/** Points `window.location` at a capture URL. */
function at(query: string): void {
  window.location.href = `https://notes.example.com/${query}`;
}

/** The single note a capture produced. */
function captured(workspace: SutraPadWorkspace) {
  expect(workspace.notes).toHaveLength(1);
  return workspace.notes[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collectCaptureContext.mockImplementation((options: { source: string }) =>
    Promise.resolve({ source: options.source, locale: "cs-CZ" }),
  );
  mocks.resolveTitleFromUrl.mockResolvedValue(null);
  mocks.reverseGeocodeCoordinates.mockResolvedValue(null);
  mocks.resolveCurrentCoordinates.mockResolvedValue(null);
  window.location.href = "https://notes.example.com/";
});

describe("captureIncomingWorkspaceFromUrl with no capture params", () => {
  it("hands the workspace straight back", async () => {
    at("");

    const result = await captureIncomingWorkspaceFromUrl(EMPTY);

    // Identity, not a copy: this runs on every cold start, and a fresh
    // object would make every bootstrap look like a change to persist.
    expect(result).toBe(EMPTY);
    expect(mocks.collectCaptureContext).not.toHaveBeenCalled();
  });

  it("ignores a capture URL that failed the scheme gate", async () => {
    // `readUrlCapture` drops `javascript:` payloads entirely rather than
    // sanitising them, so this module sees "no capture".
    at("?url=javascript:alert(1)");

    expect(await captureIncomingWorkspaceFromUrl(EMPTY)).toBe(EMPTY);
  });

  it("ignores a blank note param", async () => {
    at("?note=%20%20");

    expect(await captureIncomingWorkspaceFromUrl(EMPTY)).toBe(EMPTY);
  });
});

describe("captureIncomingWorkspaceFromUrl text capture", () => {
  it("turns ?note= into a text note tagged as a text capture", async () => {
    at("?note=Poznámka%20z%20telefonu");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.body).toBe("Poznámka z telefonu");
    // The source is what the Tags page reads to say "captured from outside".
    expect(note?.captureContext?.source).toBe("text-capture");
    expect(mocks.collectCaptureContext).toHaveBeenCalledOnce();
  });

  it("takes ?note= even when a ?url= is present too", async () => {
    // Order of the two reads is the whole decision. As a link capture this
    // note's body would be the URL and `urls` would be populated.
    at("?note=Tohle%20je%20text&url=https%3A%2F%2Fexample.com%2Fclanek");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.body).toBe("Tohle je text");
    expect(note?.urls).toEqual([]);
    expect(note?.captureContext?.source).toBe("text-capture");
  });

  it("stamps the note with the resolved place", async () => {
    mocks.resolveCurrentCoordinates.mockResolvedValue({ latitude: 50.08, longitude: 14.42 });
    mocks.reverseGeocodeCoordinates.mockResolvedValue("Praha");
    at("?note=Ahoj");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.location).toBe("Praha");
    expect(note?.coordinates).toEqual({ latitude: 50.08, longitude: 14.42 });
    // The title comes from the same details bundle — it is the prettified
    // daypart line, so it has to mention the place.
    expect(note?.title).toContain("Praha");
  });

  it("keeps the note when there is no location to attach", async () => {
    at("?note=Ahoj");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.location).toBeUndefined();
    expect(note?.coordinates).toBeUndefined();
    expect(note?.title).not.toBe("");
  });

  it("prepends the capture to an existing notebook", async () => {
    const existing: SutraPadWorkspace = {
      notes: [
        {
          id: "n-old",
          title: "Stará",
          body: "text",
          urls: [],
          createdAt: "2026-01-01T08:00:00.000Z",
          updatedAt: "2026-01-01T08:00:00.000Z",
          tags: [],
        },
      ],
      activeNoteId: "n-old",
    };
    at("?note=Nová");

    const result = await captureIncomingWorkspaceFromUrl(existing);

    expect(result.notes).toHaveLength(2);
    // The capture becomes the active note — the app opens it on arrival.
    expect(result.activeNoteId).not.toBe("n-old");
    expect(result.notes.find((note) => note.id === result.activeNoteId)?.body).toBe("Nová");
  });
});

describe("captureIncomingWorkspaceFromUrl link capture", () => {
  it("saves the URL as the note body and extracts it as a link", async () => {
    at("?url=https%3A%2F%2Fexample.com%2Fclanek&title=Titulek");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.title).toBe("Titulek");
    expect(note?.body).toBe("https://example.com/clanek");
    expect(note?.urls).toEqual(["https://example.com/clanek"]);
    expect(note?.captureContext?.source).toBe("url-capture");
  });

  it("prefers the bookmarklet's own title and skips the fetch", async () => {
    // The bookmarklet read the live `document.title` on the source page;
    // re-fetching would be slower and can be blocked by CORS.
    at("?url=https%3A%2F%2Fexample.com%2Fa&title=Z%20bookmarkletu");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.title).toBe("Z bookmarkletu");
    expect(mocks.resolveTitleFromUrl).not.toHaveBeenCalled();
  });

  it("falls back to the page's own <title>", async () => {
    mocks.resolveTitleFromUrl.mockResolvedValue("Titulek ze stránky");
    at("?url=https%3A%2F%2Fexample.com%2Fclanek");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(mocks.resolveTitleFromUrl).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/clanek",
    );
    expect(note?.title).toBe("Titulek ze stránky");
  });

  it("derives a title from the URL when the fetch comes back empty", async () => {
    // Third and last step: no bookmarklet title, no reachable page.
    at("?url=https%3A%2F%2Fexample.com%2Fmuj-dlouhy-clanek.html");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    // Slug plus host, so a bare `/index.html` on two sites is still
    // distinguishable in the list.
    expect(note?.title).toBe("muj dlouhy clanek · example.com");
  });

  it("passes the bookmarklet's context snapshot through to the builder", async () => {
    // `?capture=` carries what the source page knew (referrer, page
    // metadata). Dropping it loses everything the capture was for.
    const snapshot = JSON.stringify({ referrer: "https://news.example.com/" });
    at(`?url=https%3A%2F%2Fexample.com%2Fa&capture=${encodeURIComponent(snapshot)}`);

    await captureIncomingWorkspaceFromUrl(EMPTY);

    expect(mocks.collectCaptureContext).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        source: "url-capture",
        sourceSnapshot: expect.objectContaining({ referrer: "https://news.example.com/" }),
      }),
    );
  });
});

describe("captureIncomingWorkspaceFromUrl selection", () => {
  it("keeps the selected text as the note body with the source below it", async () => {
    // Without this branch the selection is silently dropped and the user
    // gets a bare link back for a quote they deliberately highlighted.
    at("?url=https%3A%2F%2Fexample.com%2Fa&selection=Cituju%20tuhle%20v%C4%9Btu.");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.body).toBe("Cituju tuhle větu.\n\nhttps://example.com/a");
  });

  it("formats the body exactly like the silent runner would", async () => {
    // Same builder on both paths, so a note does not read differently
    // depending on which one ran.
    const { buildSilentCaptureBody } = await import("../src/app/logic/silent-capture");
    at("?url=https%3A%2F%2Fexample.com%2Fa&selection=Kus%20textu");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.body).toBe(buildSilentCaptureBody("Kus textu", "https://example.com/a"));
  });

  it("still titles the note from the capture", async () => {
    at("?url=https%3A%2F%2Fexample.com%2Fa&selection=Kus&title=Zdroj");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.title).toBe("Zdroj");
    expect(note?.captureContext?.source).toBe("url-capture");
  });

  it("takes the link branch for a blank selection", async () => {
    // `extractSelectionFromUrl` returns null for whitespace, so this is the
    // plain link capture — body is the URL and `urls` is populated.
    at("?url=https%3A%2F%2Fexample.com%2Fa&selection=%20%20");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.body).toBe("https://example.com/a");
    expect(note?.urls).toEqual(["https://example.com/a"]);
  });

  it("takes the link branch when there is no selection param at all", async () => {
    at("?url=https%3A%2F%2Fexample.com%2Fa");

    const note = captured(await captureIncomingWorkspaceFromUrl(EMPTY));

    expect(note?.urls).toEqual(["https://example.com/a"]);
  });
});

describe("captureIncomingWorkspaceFromUrl coordinates resolver", () => {
  it("defaults to the real resolver", async () => {
    // The default is what runs when the location preference is `"on"`.
    at("?note=Ahoj");

    await captureIncomingWorkspaceFromUrl(EMPTY);

    expect(mocks.resolveCurrentCoordinates).toHaveBeenCalledOnce();
  });

  it("uses the caller's resolver instead when one is given", async () => {
    // `app.ts` injects `async () => null` for `"off"` / `"unanswered"` so
    // no geolocation prompt ever pops inside a capture iframe.
    const resolveCoordinates = vi.fn(() => Promise.resolve(null));
    at("?note=Ahoj");

    await captureIncomingWorkspaceFromUrl(EMPTY, { resolveCoordinates });

    expect(resolveCoordinates).toHaveBeenCalledOnce();
    expect(mocks.resolveCurrentCoordinates).not.toHaveBeenCalled();
  });

  it("threads the caller's resolver through the link path too", async () => {
    // Both branches take the same injected resolver; wiring it only into
    // the note branch would still prompt on every bookmarklet link save.
    const resolveCoordinates = vi.fn(() => Promise.resolve(null));
    at("?url=https%3A%2F%2Fexample.com%2Fa");

    await captureIncomingWorkspaceFromUrl(EMPTY, { resolveCoordinates });

    expect(resolveCoordinates).toHaveBeenCalledOnce();
    expect(mocks.resolveCurrentCoordinates).not.toHaveBeenCalled();
  });

  it("treats an empty options bag as no override", async () => {
    at("?note=Ahoj");

    await captureIncomingWorkspaceFromUrl(EMPTY, {});

    expect(mocks.resolveCurrentCoordinates).toHaveBeenCalledOnce();
  });
});
