import { describe, expect, it } from "vitest";
import type { SutraPadTagEntry } from "../src/types";
import {
  RECENT_TAG_FILTERS_MAX,
  RECENT_TAG_FILTERS_STORAGE_KEY,
  loadRecentTagFilters,
  persistRecentTagFilters,
  pushRecentTagFilter,
  rankTagFilterSuggestions,
  resolveTabCompletion,
} from "../src/app/logic/tag-filter-typeahead";

/**
 * In-memory Storage stand-in. Only the two methods the module actually calls
 * are implemented, matching the pattern used by `visible-tag-classes.test.ts`.
 */
function createStorage(initial: Record<string, string> = {}): Pick<
  Storage,
  "getItem" | "setItem"
> {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

function tagEntry(
  tag: string,
  count: number,
  overrides: Partial<SutraPadTagEntry> = {},
): SutraPadTagEntry {
  return {
    tag,
    noteIds: [],
    count,
    kind: "user",
    ...overrides,
  };
}

describe("RECENT_TAG_FILTERS_MAX", () => {
  it("caps recent tags at 8 entries per handoff spec (tagfilter.jsx)", () => {
    expect(RECENT_TAG_FILTERS_MAX).toBe(8);
  });
});

describe("RECENT_TAG_FILTERS_STORAGE_KEY", () => {
  it("uses the exact slot name from the handoff prototype", () => {
    // Pinning the literal matters: if the key silently changes, users who
    // upgraded from a handoff build will lose their recent-tag history.
    expect(RECENT_TAG_FILTERS_STORAGE_KEY).toBe("sp_recent_tags");
  });
});

describe("loadRecentTagFilters", () => {
  it("returns an empty array when the slot is empty", () => {
    expect(loadRecentTagFilters(createStorage())).toEqual([]);
  });

  it("parses a JSON array of tag strings", () => {
    const storage = createStorage({
      [RECENT_TAG_FILTERS_STORAGE_KEY]: JSON.stringify(["work", "reading"]),
    });
    expect(loadRecentTagFilters(storage)).toEqual(["work", "reading"]);
  });

  it("returns an empty array on malformed JSON (never throws)", () => {
    // Unparseable JSON should not crash the app on first render — this is a
    // nice-to-have surface so we degrade to "no recent tags" rather than a
    // blank screen.
    const storage = createStorage({
      [RECENT_TAG_FILTERS_STORAGE_KEY]: "{not json",
    });
    expect(loadRecentTagFilters(storage)).toEqual([]);
  });

  it("returns an empty array when stored value is not an array", () => {
    const storage = createStorage({
      [RECENT_TAG_FILTERS_STORAGE_KEY]: JSON.stringify({ foo: "bar" }),
    });
    expect(loadRecentTagFilters(storage)).toEqual([]);
  });

  it("drops non-string entries defensively", () => {
    const storage = createStorage({
      [RECENT_TAG_FILTERS_STORAGE_KEY]: JSON.stringify([
        "work",
        42,
        null,
        "reading",
      ]),
    });
    expect(loadRecentTagFilters(storage)).toEqual(["work", "reading"]);
  });

  it("caps at RECENT_TAG_FILTERS_MAX even if storage somehow contains more", () => {
    // Defensive: if a future code path ever writes more than 8, the loader
    // must not leak them into the UI.
    const tooMany = Array.from({ length: 12 }, (_, i) => `tag${i}`);
    const storage = createStorage({
      [RECENT_TAG_FILTERS_STORAGE_KEY]: JSON.stringify(tooMany),
    });
    expect(loadRecentTagFilters(storage)).toHaveLength(RECENT_TAG_FILTERS_MAX);
  });
});

describe("persistRecentTagFilters", () => {
  it("writes as a JSON array under the handoff-spec key", () => {
    const writes: Record<string, string> = {};
    persistRecentTagFilters(["work", "reading"], {
      setItem(key, value) {
        writes[key] = value;
      },
    });
    expect(writes[RECENT_TAG_FILTERS_STORAGE_KEY]).toBe(
      JSON.stringify(["work", "reading"]),
    );
  });

  it("round-trips with loadRecentTagFilters", () => {
    const storage = createStorage();
    persistRecentTagFilters(["a", "b", "c"], storage);
    expect(loadRecentTagFilters(storage)).toEqual(["a", "b", "c"]);
  });

  it("writes an empty array as '[]' (not as an empty string)", () => {
    // An empty-but-present slot signals "user has been here", which is
    // different from a missing slot. JSON-stringify keeps both paths
    // machine-readable.
    const writes: Record<string, string> = {};
    persistRecentTagFilters([], {
      setItem(key, value) {
        writes[key] = value;
      },
    });
    expect(writes[RECENT_TAG_FILTERS_STORAGE_KEY]).toBe("[]");
  });
});

describe("pushRecentTagFilter", () => {
  it("prepends a brand-new tag at the newest-first position", () => {
    expect(pushRecentTagFilter(["work", "reading"], "idea")).toEqual([
      "idea",
      "work",
      "reading",
    ]);
  });

  it("moves an existing tag to the front rather than duplicating it", () => {
    expect(pushRecentTagFilter(["work", "reading", "idea"], "reading")).toEqual(
      ["reading", "work", "idea"],
    );
  });

  it("caps the resulting list at RECENT_TAG_FILTERS_MAX", () => {
    const full = [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ];
    expect(pushRecentTagFilter(full, "i")).toEqual([
      "i",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
  });

  it("does not mutate the input array", () => {
    const original = ["work", "reading"];
    const snapshot = [...original];
    pushRecentTagFilter(original, "idea");
    expect(original).toEqual(snapshot);
  });

  it("ignores a blank/whitespace-only tag", () => {
    // The caller should never pass this, but defensive: a stray commit with
    // an empty string must not prepend a phantom row to the recent list.
    expect(pushRecentTagFilter(["work"], "")).toEqual(["work"]);
    expect(pushRecentTagFilter(["work"], "   ")).toEqual(["work"]);
  });
});

describe("rankTagFilterSuggestions", () => {
  // Inputs here mimic the shape `buildTagIndex` produces: already sorted
  // count-desc by the caller, so the ranker's job is just to filter and
  // re-tier (starts-with above contains). Within a tier the original input
  // order is preserved.
  const entries: SutraPadTagEntry[] = [
    tagEntry("reading", 10),
    tagEntry("work", 8),
    tagEntry("idea", 5),
    tagEntry("research", 3),
    tagEntry("rereading", 2),
  ];

  it("preserves the input order when the query is empty", () => {
    // Blank query is essentially "show popular" — the caller has already
    // sorted the index count-desc, so the ranker just passes that ordering
    // through without reshuffling.
    const ranked = rankTagFilterSuggestions(entries, "", []);
    expect(ranked.map((e) => e.tag)).toEqual([
      "reading",
      "work",
      "idea",
      "research",
      "rereading",
    ]);
  });

  it("ranks starts-with matches above contains-only matches", () => {
    // "re" starts "reading", "research", "rereading" — all starts-with — and
    // does not appear in "work" or "idea". The three starts-with hits should
    // be ordered by count desc among themselves.
    const ranked = rankTagFilterSuggestions(entries, "re", []);
    expect(ranked.map((e) => e.tag)).toEqual([
      "reading",
      "research",
      "rereading",
    ]);
  });

  it("elevates starts-with above a higher-count contains-only match", () => {
    // Add a high-count tag that only *contains* "re" (not starts with).
    // The starts-with hits still come first even though the contains hit
    // has more notes.
    const withContains = [
      ...entries,
      tagEntry("refresher", 99),
      tagEntry("pre-release", 50),
    ];
    const ranked = rankTagFilterSuggestions(withContains, "re", []);
    // First three slots must be starts-with hits (any order by count among
    // themselves). The contains hit "pre-release" must come after them.
    const startsWith = new Set(["reading", "research", "rereading", "refresher"]);
    const firstFourKinds = ranked
      .slice(0, 4)
      .map((e) => (startsWith.has(e.tag) ? "starts" : "contains"));
    expect(firstFourKinds).toEqual(["starts", "starts", "starts", "starts"]);
    const preReleaseIndex = ranked.findIndex((e) => e.tag === "pre-release");
    const refresherIndex = ranked.findIndex((e) => e.tag === "refresher");
    expect(refresherIndex).toBeLessThan(preReleaseIndex);
  });

  it("places starts-with above contains even when contains appears first in input", () => {
    // Regression pin for the starts-with-wins invariant: if the ranker
    // accidentally skipped the starts-with tier (e.g. a `startsWith(…)` call
    // was replaced with a no-op or the wrong predicate), the naïve output
    // would simply preserve input order and the contains hit "pre-release"
    // would land in front of the starts-with hit "reading". Kills the
    // `startsWith → false` and `startsWith → endsWith` mutants.
    const contrived = [
      tagEntry("pre-release", 99), // contains "re" but does NOT start with "re"
      tagEntry("reading", 1),      // starts with "re" even though count is tiny
    ];
    const ranked = rankTagFilterSuggestions(contrived, "re", []);
    expect(ranked.map((e) => e.tag)).toEqual(["reading", "pre-release"]);
  });

  it("is case-insensitive", () => {
    const ranked = rankTagFilterSuggestions(entries, "RE", []);
    expect(ranked.map((e) => e.tag)).toEqual([
      "reading",
      "research",
      "rereading",
    ]);
  });

  it("excludes tags already in the active filter set", () => {
    // "reading" is already filtering; the dropdown must not offer it a
    // second time (commit would be a no-op and confusing).
    const ranked = rankTagFilterSuggestions(entries, "re", ["reading"]);
    expect(ranked.map((e) => e.tag)).toEqual(["research", "rereading"]);
  });

  it("caps at the supplied limit", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      tagEntry(`tag${i}`, 20 - i),
    );
    expect(rankTagFilterSuggestions(many, "", [], 5)).toHaveLength(5);
  });

  it("defaults the limit to 8 when omitted", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      tagEntry(`tag${i}`, 20 - i),
    );
    expect(rankTagFilterSuggestions(many, "", [])).toHaveLength(8);
  });

  it("returns an empty list when no tag contains the query", () => {
    expect(
      rankTagFilterSuggestions(entries, "zzz-never-matches", []).length,
    ).toBe(0);
  });

  it("trims surrounding whitespace in the query", () => {
    const ranked = rankTagFilterSuggestions(entries, "  re  ", []);
    expect(ranked.map((e) => e.tag)).toEqual([
      "reading",
      "research",
      "rereading",
    ]);
  });
});

describe("resolveTabCompletion", () => {
  const entry = (tag: string): SutraPadTagEntry => tagEntry(tag, 1);

  it("returns { kind: 'none' } with no suggestions", () => {
    expect(resolveTabCompletion("wo", [])).toEqual({ kind: "none" });
  });

  it("returns { kind: 'none' } when the query is blank (no preview target)", () => {
    // Tab on an empty query must not commit a random tag — the handoff
    // requires a typed query before Tab becomes meaningful.
    expect(resolveTabCompletion("", [entry("work")])).toEqual({ kind: "none" });
    expect(resolveTabCompletion("   ", [entry("work")])).toEqual({ kind: "none" });
  });

  it("returns { kind: 'preview', tag } when query is a strict prefix of the first suggestion", () => {
    expect(resolveTabCompletion("wo", [entry("work"), entry("world")])).toEqual({
      kind: "preview",
      tag: "work",
    });
  });

  it("returns { kind: 'commit', tag } when query already matches the first suggestion exactly (case-insensitive)", () => {
    // Second Tab scenario: the input has already been auto-completed to the
    // full name, so Tab at that point commits.
    expect(resolveTabCompletion("work", [entry("work")])).toEqual({
      kind: "commit",
      tag: "work",
    });
    expect(resolveTabCompletion("WORK", [entry("work")])).toEqual({
      kind: "commit",
      tag: "work",
    });
  });

  it("treats leading/trailing whitespace as an exact match", () => {
    // The input element's raw value may carry stray space; we match against
    // the trimmed query so "  work " still commits the exact-match suggestion.
    expect(resolveTabCompletion("  work ", [entry("work")])).toEqual({
      kind: "commit",
      tag: "work",
    });
  });

  it("uses the first suggestion as the Tab target (matches the prototype's highlighted row)", () => {
    // tagfilter.jsx uses `suggestions[activeIdx] || suggestions[0]` — we
    // simplify to "first" since the caller already reorders the list so the
    // active row is at index 0 for the Tab decision.
    expect(
      resolveTabCompletion("re", [entry("reading"), entry("research")]),
    ).toEqual({ kind: "preview", tag: "reading" });
  });
});
