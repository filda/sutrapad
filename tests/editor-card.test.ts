// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { buildEditorCard } from "../src/app/view/shared/editor-card";
import type { SutraPadDocument } from "../src/types";

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

describe("buildEditorCard", () => {
  it("renders the writing surface with title input, body textarea, and metadata footer", () => {
    const note = makeNote({ id: "n1", title: "Hello", body: "world" });
    const card = buildEditorCard({
      note,
      currentNote: note,
      selectedTagFilters: [],
      onTitleInput: () => {},
      onBodyInput: () => {},
    });
    // Sanity baseline — these wire-points haven't moved during the
    // persona pass and the rest of the suite leans on their stability.
    expect(card.className).toBe("editor-card detail-editor");
    const titleInput = card.querySelector<HTMLInputElement>(".editor-title");
    expect(titleInput?.value).toBe("Hello");
    expect(titleInput?.placeholder).toBe("Note title");
    const bodyInput = card.querySelector<HTMLTextAreaElement>(".editor-body");
    expect(bodyInput?.value).toBe("world");
    expect(bodyInput?.placeholder).toBe("Start writing...");
    expect(card.querySelector(".note-metadata")).not.toBeNull();
  });

  it("renders the writing surface when there's no note but no tag filter is active either", () => {
    // The filter-miss branch is gated on BOTH `note === null` AND
    // `selectedTagFilters.length > 0`. With a `null` note and no
    // filters, the editor falls through to the regular writing
    // surface fed by `currentNote` — pinning this guard catches a
    // mutation that flips the `&&` to `||` (which would surface the
    // empty state every time the user opens a fresh draft).
    const draft = makeNote({ id: "draft", title: "", body: "" });
    const card = buildEditorCard({
      note: null,
      currentNote: draft,
      selectedTagFilters: [],
      onTitleInput: () => {},
      onBodyInput: () => {},
    });
    expect(card.querySelector(".empty-editor-state")).toBeNull();
    // Regular inputs render against the fallback `currentNote`.
    expect(card.querySelector<HTMLInputElement>(".editor-title")).not.toBeNull();
    expect(card.querySelector<HTMLTextAreaElement>(".editor-body")).not.toBeNull();
  });

  it("does not show the empty state when a real note is open even if filters are active", () => {
    // Mirror of the previous test — `note` set, filters set → editor
    // is for THIS note, filters belong to the grid we just clicked
    // out of. Pins that the filter-miss branch only fires when both
    // conditions hold.
    const note = makeNote({ id: "n1" });
    const card = buildEditorCard({
      note,
      currentNote: note,
      selectedTagFilters: ["ai"],
      onTitleInput: () => {},
      onBodyInput: () => {},
    });
    expect(card.querySelector(".empty-editor-state")).toBeNull();
  });

  it("calls onTitleInput on every title keystroke", () => {
    const note = makeNote({ id: "n1", title: "before" });
    const onTitleInput = vi.fn();
    const card = buildEditorCard({
      note,
      currentNote: note,
      selectedTagFilters: [],
      onTitleInput,
      onBodyInput: () => {},
    });
    const titleInput = card.querySelector<HTMLInputElement>(".editor-title");
    if (!titleInput) throw new Error("missing title input");
    titleInput.value = "after";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    // The third arg pins the write to the note this card was mounted
    // for — defends against an active-shift between mount and event;
    // see `editor-card.ts` blur handler doc-comment for the race.
    expect(onTitleInput).toHaveBeenCalledWith("after", "n1");
  });

  it("calls onBodyInput with the current caret position on every body keystroke", () => {
    // The caret position is what `mergeHashtagsIntoTags` uses to tell
    // "user is still mid-typing this tag" from "user moved past it".
    // Pinning that the caret is threaded through (not silently
    // dropped) guards against a future "I'll clean up that unused
    // parameter" mutation.
    const note = makeNote({ id: "n1", body: "before" });
    const onBodyInput = vi.fn();
    const card = buildEditorCard({
      note,
      currentNote: note,
      selectedTagFilters: [],
      onTitleInput: () => {},
      onBodyInput,
    });
    const bodyInput = card.querySelector<HTMLTextAreaElement>(".editor-body");
    if (!bodyInput) throw new Error("missing body textarea");
    bodyInput.value = "after #ai";
    bodyInput.setSelectionRange(9, 9);
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
    // The third arg pins the write to the bound note id (see the
    // editor-card body blur doc-comment for the race this defends).
    expect(onBodyInput).toHaveBeenCalledWith("after #ai", 9, "n1");
  });

  it("re-runs onBodyInput with caret=undefined on blur so in-flight hashtags commit", () => {
    // `mergeHashtagsIntoTags` skips the hashtag whose end sits exactly
    // at the caret (still being typed). On blur we want every
    // committed hashtag to land, so the editor re-fires the handler
    // with `undefined` caret = "no caret restriction". A silent
    // mutation that drops the blur handler (or passes the caret
    // through unchanged) would leave half-typed tags in the body
    // forever.
    const note = makeNote({ id: "n1", body: "" });
    const onBodyInput = vi.fn();
    const card = buildEditorCard({
      note,
      currentNote: note,
      selectedTagFilters: [],
      onTitleInput: () => {},
      onBodyInput,
    });
    const bodyInput = card.querySelector<HTMLTextAreaElement>(".editor-body");
    if (!bodyInput) throw new Error("missing body textarea");
    bodyInput.value = "draft #ai";
    bodyInput.dispatchEvent(new Event("blur", { bubbles: true }));
    // Third arg is the bound note id — blur captured it at mount so a
    // mid-blur active-shift can't reroute the write onto a sibling.
    expect(onBodyInput).toHaveBeenCalledWith("draft #ai", undefined, "n1");
  });

  it("fires onInputsChange after every keystroke with the live title + body values", () => {
    // The kind chip lives inside the editor and reads its label off
    // the current inputs. `onInputsChange` is the hook for any *other*
    // future live-derived surface to receive the same snapshot
    // without us wiring a second listener pair. Pinning the wiring
    // catches a refactor that quietly stops calling the callback.
    const note = makeNote({ id: "n1", title: "t0", body: "b0" });
    const onInputsChange = vi.fn();
    const card = buildEditorCard({
      note,
      currentNote: note,
      selectedTagFilters: [],
      onTitleInput: () => {},
      onBodyInput: () => {},
      onInputsChange,
    });
    const titleInput = card.querySelector<HTMLInputElement>(".editor-title");
    const bodyInput = card.querySelector<HTMLTextAreaElement>(".editor-body");
    if (!titleInput || !bodyInput) throw new Error("missing inputs");
    titleInput.value = "t1";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInputsChange).toHaveBeenLastCalledWith("t1", "b0");
    bodyInput.value = "b1";
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInputsChange).toHaveBeenLastCalledWith("t1", "b1");
  });

  it("omits the title input when showTitleInput is false", () => {
    // Detail-route opts out of the editor-card's title input because
    // the editable title moves up into `.note-detail-hero-title`. Pin
    // this so a refactor doesn't accidentally always render the title
    // input (which would re-introduce the duplicate field the dedup
    // pass killed).
    const note = makeNote({ id: "n1", title: "Hello", body: "world" });
    const card = buildEditorCard({
      note,
      currentNote: note,
      selectedTagFilters: [],
      onTitleInput: () => {},
      onBodyInput: () => {},
      showTitleInput: false,
    });
    expect(card.querySelector(".editor-title")).toBeNull();
    // Body still renders — only the title input was opted out.
    expect(card.querySelector(".editor-body")).not.toBeNull();
  });

  it("still wires the body input's onInputsChange using the note's title when no title input is present", () => {
    // When the title input lives elsewhere (hero), the editor-card's
    // body listener still fires `onInputsChange(title, body)` so the
    // detail-topbar kind chip can refresh on body keystrokes. Title
    // here comes from `displayedNote.title` rather than a live input —
    // pin that handoff so kind-detection stays meaningful.
    const note = makeNote({ id: "n1", title: "Trek notebook", body: "" });
    const onInputsChange = vi.fn();
    const card = buildEditorCard({
      note,
      currentNote: note,
      selectedTagFilters: [],
      onTitleInput: () => {},
      onBodyInput: () => {},
      onInputsChange,
      showTitleInput: false,
    });
    const bodyInput = card.querySelector<HTMLTextAreaElement>(".editor-body");
    if (!bodyInput) throw new Error("missing body textarea");
    bodyInput.value = "first note";
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInputsChange).toHaveBeenCalledWith("Trek notebook", "first note");
  });

  it("renders the filter-miss empty state when there is no note and a tag filter is active", () => {
    // The empty-state branch short-circuits before any persona logic
    // runs — pin it so a refactor doesn't accidentally try to derive a
    // persona for `null`.
    const note = makeNote({ id: "n1" });
    const card = buildEditorCard({
      note: null,
      currentNote: note,
      selectedTagFilters: ["ai"],
      onTitleInput: () => {},
      onBodyInput: () => {},
      personaOptions: { allNotes: [note], dark: false },
    });
    expect(card.querySelector(".empty-editor-state")).not.toBeNull();
    expect(card.classList.contains("has-persona")).toBe(false);
    // No inputs in the empty-state branch.
    expect(card.querySelector(".editor-title")).toBeNull();
    expect(card.querySelector(".editor-body")).toBeNull();
  });

  describe("without personaOptions", () => {
    it("does not add the has-persona class or any --nc-* inline custom properties", () => {
      // Default branch when the persona preference is off — the editor
      // wears the flat serif-on-paper baseline. Pinning the *absence*
      // of `has-persona` keeps a future refactor from silently always
      // applying persona styling regardless of preference.
      const note = makeNote({ id: "n1" });
      const card = buildEditorCard({
        note,
        currentNote: note,
        selectedTagFilters: [],
        onTitleInput: () => {},
        onBodyInput: () => {},
      });
      expect(card.classList.contains("has-persona")).toBe(false);
      expect(card.style.getPropertyValue("--nc-bg")).toBe("");
      expect(card.style.getPropertyValue("--nc-ink")).toBe("");
      expect(card.style.getPropertyValue("--nc-title-font")).toBe("");
      expect(card.style.getPropertyValue("--nc-body-font")).toBe("");
    });
  });

  describe("with personaOptions", () => {
    // `pickWhenBucket` reads `getHours()` (LOCAL time), so the exact
    // bucket — and therefore the exact paper hex — varies with the
    // runner's TZ. We assert *that the values land*, that they look
    // like hex colours, and that dark / light variants diverge, rather
    // than pinning specific palette entries here. Palette regression
    // testing belongs in `tests/notebook-persona.test.ts`, which can
    // inject a fixed `now` and pick an exact bucket.
    const note = makeNote({
      id: "n1",
      createdAt: "2026-04-24T18:00:00.000Z",
      updatedAt: "2026-04-24T18:00:00.000Z",
    });

    it("stamps has-persona and exposes paper / ink as inline hex custom properties", () => {
      const card = buildEditorCard({
        note,
        currentNote: note,
        selectedTagFilters: [],
        onTitleInput: () => {},
        onBodyInput: () => {},
        personaOptions: { allNotes: [note], dark: false },
      });
      expect(card.classList.contains("has-persona")).toBe(true);
      // Hex shape — `#` + 6 hex chars. If the persona ever swaps to
      // `oklch()` or HSL we want that to be a deliberate change, not a
      // silent drift, so pin the shape.
      expect(card.style.getPropertyValue("--nc-bg")).toMatch(/^#[0-9a-f]{6}$/iu);
      expect(card.style.getPropertyValue("--nc-ink")).toMatch(/^#[0-9a-f]{6}$/iu);
    });

    it("flips to a different paper variant when dark: true", () => {
      // The persona derivation picks a dark-theme paper when the active
      // theme resolved to dark. Without the flip, evening notes on a
      // dark theme would render cream-on-near-black — eye-burning. The
      // exact dark / light values depend on bucket (which depends on
      // TZ); we assert only that they *differ*.
      const lightCard = buildEditorCard({
        note,
        currentNote: note,
        selectedTagFilters: [],
        onTitleInput: () => {},
        onBodyInput: () => {},
        personaOptions: { allNotes: [note], dark: false },
      });
      const darkCard = buildEditorCard({
        note,
        currentNote: note,
        selectedTagFilters: [],
        onTitleInput: () => {},
        onBodyInput: () => {},
        personaOptions: { allNotes: [note], dark: true },
      });
      expect(lightCard.style.getPropertyValue("--nc-bg")).not.toBe(
        darkCard.style.getPropertyValue("--nc-bg"),
      );
      expect(lightCard.style.getPropertyValue("--nc-ink")).not.toBe(
        darkCard.style.getPropertyValue("--nc-ink"),
      );
    });

    it("propagates the persona's title and body fonts as custom properties", () => {
      const card = buildEditorCard({
        note,
        currentNote: note,
        selectedTagFilters: [],
        onTitleInput: () => {},
        onBodyInput: () => {},
        personaOptions: { allNotes: [note], dark: false },
      });
      // Default font tier (no `source:` auto-tag, no park-ish location)
      // → both title and body land on the serif. The custom properties
      // hold the *CSS variable reference* (`var(--serif)`), not the
      // resolved font stack — the cascade resolves them at paint time.
      expect(card.style.getPropertyValue("--nc-title-font")).toBe("var(--serif)");
      expect(card.style.getPropertyValue("--nc-body-font")).toBe("var(--serif)");
    });

    it("forces rotation to zero so the writing surface stays still", () => {
      // The grid cards already opted out of `--nc-rotation` via CSS
      // (the ±0.8° tilt makes the band bottoms wobble across columns).
      // The editor card opts out via `rotationFactor: 0` at the
      // persona-decor layer — both the inline custom property *and*
      // the CSS rule that reads it are off. Pin that so a refactor
      // doesn't accidentally let a 0.8° tilt slide back in and shimmy
      // the ruled-line background against the textarea content.
      const card = buildEditorCard({
        note,
        currentNote: note,
        selectedTagFilters: [],
        onTitleInput: () => {},
        onBodyInput: () => {},
        personaOptions: { allNotes: [note], dark: false },
      });
      expect(card.style.getPropertyValue("--nc-rotation")).toBe("0deg");
    });

    it("carries the persona font-tier as a data attribute for tier-specific CSS hooks", () => {
      // The `data-font-tier="handwritten"` / `"mono"` selectors in
      // `styles.css` bump title sizing and tracking. The attribute has
      // to survive across to the editor card too, otherwise a bookmarklet
      // capture's title would be in JetBrains Mono on the grid card but
      // in Newsreader on the editor — jarring.
      //
      // `source:url-capture` comes off `captureContext.source` (see
      // `addSourceTag` in `lib/auto-tags.ts`) — putting `"source:..."`
      // in `note.tags` doesn't trigger it because the persona's facet
      // extractor only honours auto-tags. We feed the real shape so the
      // assertion is wired against production behaviour.
      const captureNote = makeNote({
        id: "n2",
        captureContext: { source: "url-capture" },
      });
      const card = buildEditorCard({
        note: captureNote,
        currentNote: captureNote,
        selectedTagFilters: [],
        onTitleInput: () => {},
        onBodyInput: () => {},
        personaOptions: { allNotes: [captureNote], dark: false },
      });
      expect(card.dataset.fontTier).toBe("mono");
    });
  });
});
