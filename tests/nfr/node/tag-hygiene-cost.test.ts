/**
 * Tag-hygiene cost at tag-space scale. `suggestTagAliases` runs inside the
 * render pass — the Settings hygiene card and the home hint banner both ask
 * for it — so its cost is render cost, and it scales with the number of
 * distinct user tags, not with the note count the rest of `tests/nfr`
 * models.
 *
 * The all-pairs loop this replaced measured 3.8 s at 1 900 tags and 11 s at
 * 3 500 (2026-09-14) and was the whole of the 20.1 s of `settings` DOM build
 * in the reported Diagnostics card. Counted, not timed — comparisons made
 * and derivations avoided, per `docs/nfr-testing-plan.md` principle 2.
 */
import { describe, expect, it } from "vitest";
import {
  candidatePairs,
  suggestTagAliases,
  suggestTagAliasesForWorkspace,
} from "../../../src/app/logic/tag-aliases";
import {
  TAG_HYGIENE_MAX_PAIRS_PER_TAG,
  TAG_HYGIENE_REFERENCE_TAGS,
} from "../../../src/lib/budgets";
import type {
  SutraPadDocument,
  SutraPadTagEntry,
  SutraPadTagIndex,
  SutraPadWorkspace,
} from "../../../src/types";

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/**
 * A tag space with the shape that makes this expensive: short tags drawn
 * from a small syllable pool, so near-duplicates are everywhere and the
 * fuzzy matcher has real work to do rather than rejecting on length.
 */
function tagSpace(count: number, seed = 5): string[] {
  const random = seededRandom(seed);
  const syllables = ["ka", "ri", "mo", "ta", "ne", "lu", "sa", "vi", "po", "de"];
  const tags = new Set<string>();
  while (tags.size < count) {
    const length = 2 + Math.floor(random() * 3);
    let tag = "";
    for (let i = 0; i < length; i += 1) {
      tag += syllables[Math.floor(random() * syllables.length)];
    }
    tags.add(tags.size % 3 === 0 ? tag : `${tag}${tags.size}`);
  }
  return [...tags];
}

function entriesOf(tags: readonly string[]): SutraPadTagEntry[] {
  return tags.map((tag, i) => ({
    tag,
    noteIds: [`n${i}`, `m${i}`],
    count: 2,
    kind: "user" as const,
  }));
}

function indexOf(tags: readonly string[]): SutraPadTagIndex {
  return {
    version: 1,
    savedAt: "2026-09-14T00:00:00.000Z",
    tags: entriesOf(tags),
  };
}

describe("tag hygiene at tag-space scale", () => {
  it(`compares O(tags) pairs, not O(tags²), at ${TAG_HYGIENE_REFERENCE_TAGS} tags`, () => {
    const entries = entriesOf(tagSpace(TAG_HYGIENE_REFERENCE_TAGS));

    const compared = [...candidatePairs(entries, 2, 0.34)].length;

    const perTag = compared / entries.length;
    const allPairsPerTag = (entries.length - 1) / 2;
    // Guards the direction as well as the number: all-pairs would be ~2 000
    // comparisons per tag here, and a generator that yielded nothing would
    // pass a ceiling on its own.
    expect(perTag, `${perTag.toFixed(1)} pairs per tag`).toBeLessThanOrEqual(
      TAG_HYGIENE_MAX_PAIRS_PER_TAG,
    );
    expect(allPairsPerTag).toBeGreaterThan(TAG_HYGIENE_MAX_PAIRS_PER_TAG);
    expect(compared).toBeGreaterThan(0);
  });

  it("still finds suggestions once the pairs are narrowed", () => {
    // The ceiling above is only meaningful next to this: narrowing that
    // dropped real matches would satisfy it perfectly.
    const suggestions = suggestTagAliases(
      indexOf(tagSpace(TAG_HYGIENE_REFERENCE_TAGS)),
      { dismissed: new Set() },
    );

    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("derives once per workspace, not once per render", () => {
    // Settings re-derives on every render, and a tag chip click, a keystroke
    // in the editor and a Drive status change are all renders. Identity is
    // the assertion: the same array back means no second derivation.
    // Two notes per tag so every tag clears the `count >= 2` gate.
    const notes: SutraPadDocument[] = [];
    for (const [index, tag] of tagSpace(200).entries()) {
      for (const copy of [0, 1]) {
        notes.push({
          id: `n${index}-${copy}`,
          title: "",
          body: "",
          urls: [],
          tags: [tag],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }
    }
    const workspace: SutraPadWorkspace = { notes, activeNoteId: notes[0].id };
    const dismissed = new Set<string>();

    const first = suggestTagAliasesForWorkspace(workspace, dismissed);
    for (let render = 0; render < 20; render += 1) {
      expect(suggestTagAliasesForWorkspace(workspace, dismissed)).toBe(first);
    }

    expect(first.length).toBeGreaterThan(0);
  });
});
