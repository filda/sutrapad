// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { SutraPadDocument } from "../src/types";
import { applyDetailStagePersona } from "../src/app/view/shared/detail-stage-persona";
import type { OgImageResolver } from "../src/app/logic/og-image-resolver";
import { hashStringToHue } from "../src/app/logic/link-card";

function makeNote(
  overrides: Partial<SutraPadDocument> & { id: string },
): SutraPadDocument {
  return {
    title: "Test",
    body: "",
    urls: [],
    tags: [],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

// Production resolver triggers an async allorigins fetch on first
// render even with no URL. Stub it as a no-op so the assertions stay
// deterministic and the test never spins up a network round-trip.
const NOOP_RESOLVER: OgImageResolver = {
  resolve: () => Promise.resolve(null),
};

function buildStage(): HTMLElement {
  const stage = document.createElement("div");
  stage.className = "editor-stage";
  return stage;
}

describe("applyDetailStagePersona", () => {

  it("stamps has-persona on the stage and propagates --nc-bg / --nc-ink", () => {
    // The CSS `.editor-stage.has-persona` rule pulls paper + ink off
    // these custom properties; if they don't land the stage rule is
    // inert and the page stays on its neutral baseline.
    const stage = buildStage();
    const note = makeNote({ id: "n1" });
    applyDetailStagePersona(stage, note, {
      allNotes: [note],
      dark: false,
      resolver: NOOP_RESOLVER,
    });
    expect(stage.classList.contains("has-persona")).toBe(true);
    expect(stage.style.getPropertyValue("--nc-bg")).toMatch(/^#[0-9a-f]{6}$/iu);
    expect(stage.style.getPropertyValue("--nc-ink")).toMatch(/^#[0-9a-f]{6}$/iu);
  });

  it("forces rotation to zero on the writing surface", () => {
    // Same reason `editor-card` opts out — the stage carries the
    // ruled-line background + the textarea content; a 0.8° tilt
    // would shimmy the lines against typed prose. Pin the explicit
    // 0deg so a refactor that drops the `rotationFactor: 0` argument
    // gets caught.
    const stage = buildStage();
    const note = makeNote({ id: "n1" });
    applyDetailStagePersona(stage, note, {
      allNotes: [note],
      dark: false,
      resolver: NOOP_RESOLVER,
    });
    expect(stage.style.getPropertyValue("--nc-rotation")).toBe("0deg");
  });

  it("flips to the dark paper variant when dark: true", () => {
    // Defence against `dark` being silently dropped by a future
    // refactor — light vs dark must produce different paper colours
    // on the stage just like they do on the editor card.
    const note = makeNote({ id: "n1" });
    const light = buildStage();
    const dark = buildStage();
    applyDetailStagePersona(light, note, {
      allNotes: [note],
      dark: false,
      resolver: NOOP_RESOLVER,
    });
    applyDetailStagePersona(dark, note, {
      allNotes: [note],
      dark: true,
      resolver: NOOP_RESOLVER,
    });
    expect(light.style.getPropertyValue("--nc-bg")).not.toBe(
      dark.style.getPropertyValue("--nc-bg"),
    );
  });

  it("prepends a banner thumb as the first child of the stage", () => {
    // The banner must land before any other grid item — there's an
    // implicit visual contract that the banner sits at the top of
    // the stage, directly under the page topbar. A later-inserted
    // banner would push everything else down a row but still leave
    // a different first child for one paint.
    const stage = buildStage();
    const placeholder = document.createElement("section");
    placeholder.className = "placeholder";
    stage.append(placeholder);

    const note = makeNote({ id: "n1" });
    const banner = applyDetailStagePersona(stage, note, {
      allNotes: [note],
      dark: false,
      resolver: NOOP_RESOLVER,
    });

    expect(stage.firstElementChild).toBe(banner);
    expect(banner.classList.contains("detail-banner")).toBe(true);
    expect(banner.classList.contains("link-thumb")).toBe(true);
  });

  it("seeds the banner gradient from `pickNoteThumbSeed` — first user tag wins", () => {
    // Pin the seed-priority contract from the banner's side: a note
    // tagged `#trek` produces the same hue on the banner as it does
    // on the grid card. A future refactor that re-derives the seed
    // off `note.id` here (forgetting the helper) would diverge and
    // the grid → detail transition would jarringly change colour.
    const note = makeNote({ id: "n1", tags: ["trek", "gear"] });
    const stage = buildStage();
    const banner = applyDetailStagePersona(stage, note, {
      allNotes: [note],
      dark: false,
      resolver: NOOP_RESOLVER,
    });
    const expectedHue = hashStringToHue("trek");
    expect(banner.style.backgroundImage).toContain(`hsl(${expectedHue} 35% 75%)`);
  });

  it("uses the note's primary URL for the og:image resolver call and forwards the note as a capture-time donor", async () => {
    // The resolver receives the note's primary URL — the canonical
    // URL when bookmarklet-captured, else the first entry on
    // `note.urls`. Pinning this protects against a refactor that
    // passes a hand-typed URL or skips the canonical lookup.
    //
    // The `notes` argument matters too: it's the capture-time
    // og:image donor list that `resolveOgImageForUrl` walks before
    // hitting the cache or the proxy. Forwarding an empty array
    // here would silently lose every Stage 1 hit and force every
    // banner through the network path; pin the subject so a
    // refactor that drops the donor doesn't slip through.
    const note = makeNote({
      id: "n1",
      urls: ["https://www.nytimes.com/article"],
    });
    let receivedUrl: string | null | undefined;
    let receivedNotes: readonly SutraPadDocument[] | undefined;
    const resolver: OgImageResolver = {
      resolve: (url, notes) => {
        receivedUrl = url;
        receivedNotes = notes;
        return Promise.resolve(null);
      },
    };
    const stage = buildStage();
    applyDetailStagePersona(stage, note, {
      allNotes: [note],
      dark: false,
      resolver,
    });
    // The resolver fires asynchronously inside `buildLinkThumb` — let
    // the microtask queue flush so the assertion sees the call.
    await Promise.resolve();
    expect(receivedUrl).toBe("https://www.nytimes.com/article");
    expect(receivedNotes).toEqual([note]);
  });

  it("skips the resolver call entirely for hand-typed notes with no URL", async () => {
    // No primary URL → no og:image lookup. Pinning this avoids a
    // refactor that fires the resolver unconditionally (which would
    // hit allorigins with a null URL and spend a round-trip on
    // nothing).
    const note = makeNote({ id: "n1" });
    let resolverCalls = 0;
    const resolver: OgImageResolver = {
      resolve: () => {
        resolverCalls += 1;
        return Promise.resolve(null);
      },
    };
    const stage = buildStage();
    applyDetailStagePersona(stage, note, {
      allNotes: [note],
      dark: false,
      resolver,
    });
    await Promise.resolve();
    expect(resolverCalls).toBe(0);
  });
});
