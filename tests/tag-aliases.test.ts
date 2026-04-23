import { describe, expect, it } from "vitest";
import {
  addDismissedTagAlias,
  dismissedPairKey,
  levenshtein,
  loadDismissedTagAliases,
  mergeTagInWorkspace,
  normalizeTag,
  persistDismissedTagAliases,
  resolveInitialDismissedTagAliases,
  suggestTagAliases,
} from "../src/app/logic/tag-aliases";
import type {
  SutraPadDocument,
  SutraPadTagEntry,
  SutraPadTagIndex,
  SutraPadWorkspace,
} from "../src/types";

const STORAGE_KEY = "sutrapad-dismissed-tag-aliases";

function createStorage(
  initial: Record<string, string> = {},
): Pick<Storage, "getItem" | "setItem"> {
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

function entry(
  tag: string,
  noteIds: string[],
  kind: "user" | "auto" | undefined = "user",
): SutraPadTagEntry {
  return { tag, noteIds, count: noteIds.length, kind };
}

function index(tags: SutraPadTagEntry[]): SutraPadTagIndex {
  return { version: 1, savedAt: "2026-04-23T12:00:00.000Z", tags };
}

function note(
  partial: Partial<SutraPadDocument> &
    Pick<SutraPadDocument, "id" | "tags">,
): SutraPadDocument {
  return {
    title: "n",
    body: "",
    urls: [],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    ...partial,
  };
}

describe("normalizeTag", () => {
  it("lowercases, trims, and strips diacritics", () => {
    expect(normalizeTag("  Café  ")).toBe("cafe");
    expect(normalizeTag("CAFÉ")).toBe("cafe");
    expect(normalizeTag("café")).toBe("cafe");
  });

  it("leaves already-canonical forms unchanged", () => {
    expect(normalizeTag("coffee")).toBe("coffee");
    expect(normalizeTag("writing")).toBe("writing");
  });

  it("preserves internal non-diacritical characters", () => {
    expect(normalizeTag("rock'n'roll")).toBe("rock'n'roll");
    expect(normalizeTag("a-b")).toBe("a-b");
  });
});

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("coffee", "coffee")).toBe(0);
  });

  it("equals length when one side is empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("counts single-character edits", () => {
    expect(levenshtein("cat", "cut")).toBe(1); // substitution
    expect(levenshtein("cat", "cats")).toBe(1); // insertion
    expect(levenshtein("cats", "cat")).toBe(1); // deletion
  });

  it("handles canonical textbook examples", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("saturday", "sunday")).toBe(3);
    // coffee → cafe: delete 'o', sub 'f'→'a'… wait, best path is three
    // edits via classic DP. Pinned so drift in the algorithm is loud.
    expect(levenshtein("coffee", "cafe")).toBe(3);
  });
});

describe("dismissedPairKey", () => {
  it("is order-independent", () => {
    expect(dismissedPairKey("coffee", "cafe")).toBe(
      dismissedPairKey("cafe", "coffee"),
    );
  });

  it("places the lexicographically smaller tag first", () => {
    expect(dismissedPairKey("coffee", "cafe")).toBe("cafe|coffee");
    expect(dismissedPairKey("a", "a")).toBe("a|a");
  });
});

describe("suggestTagAliases", () => {
  it("surfaces normalized-only pairs (diacritics + case)", () => {
    const suggestions = suggestTagAliases(
      index([entry("café", ["n1", "n2"]), entry("Cafe", ["n3", "n4"])]),
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].canonical).toBe("Cafe");
    expect(suggestions[0].aliases).toEqual(["café"]);
    expect(suggestions[0].reason).toMatch(/case and diacritics/i);
  });

  it("surfaces edit-distance pairs", () => {
    const suggestions = suggestTagAliases(
      index([
        entry("writing", ["n1", "n2", "n3"]),
        entry("writting", ["n4", "n5"]),
      ]),
    );
    expect(suggestions).toHaveLength(1);
    // Higher count wins as canonical.
    expect(suggestions[0].canonical).toBe("writing");
    expect(suggestions[0].aliases).toEqual(["writting"]);
    expect(suggestions[0].reason).toMatch(/near-identical spelling/i);
  });

  it("refuses far pairs even under the absolute distance cap", () => {
    // "cat" vs "dog": distance 3, longer length 3 → relative 1.0, rejected.
    // Keeping absolute threshold permissive at 3 ensures the relative cap
    // is the safeguard against merging unrelated short tags.
    const suggestions = suggestTagAliases(
      index([
        entry("cat", ["n1", "n2"]),
        entry("dog", ["n3", "n4"]),
      ]),
      { maxEditDistance: 3, maxRelativeDistance: 0.34 },
    );
    expect(suggestions).toEqual([]);
  });

  it("ignores singletons (count < 2)", () => {
    const suggestions = suggestTagAliases(
      index([entry("coffee", ["n1"]), entry("café", ["n2"])]),
    );
    expect(suggestions).toEqual([]);
  });

  it("ignores auto-kind entries", () => {
    const suggestions = suggestTagAliases(
      index([
        entry("date:today", ["n1", "n2"], "auto"),
        entry("date:todaz", ["n3", "n4"], "auto"),
      ]),
    );
    expect(suggestions).toEqual([]);
  });

  it("treats missing kind as user (back-compat with old data)", () => {
    const suggestions = suggestTagAliases(
      index([
        entry("writing", ["n1", "n2"], undefined),
        entry("writting", ["n3", "n4"], undefined),
      ]),
    );
    expect(suggestions).toHaveLength(1);
  });

  it("breaks ties on count alphabetically for canonical", () => {
    const suggestions = suggestTagAliases(
      index([entry("café", ["n1", "n2"]), entry("cafe", ["n3", "n4"])]),
    );
    expect(suggestions[0].canonical).toBe("cafe"); // alphabetic tiebreak
    expect(suggestions[0].aliases).toEqual(["café"]);
  });

  it("clusters transitively across three similar tags", () => {
    // "cafe" ~ "café" (normalized-equal), "café" ~ "caffe" (1 edit),
    // so all three collapse via union-find. The highest-count tag wins
    // as canonical; the other two surface as aliases.
    const suggestions = suggestTagAliases(
      index([
        entry("cafe", ["n1", "n2", "n3"]),
        entry("café", ["n4", "n5"]),
        entry("caffe", ["n6", "n7"]),
      ]),
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].canonical).toBe("cafe");
    // Default sort puts "caffe" before "café" — 'f' (0x66) < 'é' (0xE9)
    // in UTF-16 code-point order. Just check membership so the test
    // doesn't couple to the internal ordering algorithm.
    expect(new Set(suggestions[0].aliases)).toEqual(
      new Set(["café", "caffe"]),
    );
  });

  it("boosts the reason when cluster tags co-occur on a note", () => {
    // Same note carries both tags → reason mentions co-occurrence.
    const suggestions = suggestTagAliases(
      index([
        entry("writing", ["n1", "n2"]),
        entry("writting", ["n1", "n3"]),
      ]),
    );
    expect(suggestions[0].reason).toMatch(/used together/i);
  });

  it("omits co-occurrence note when the pair never co-occurs", () => {
    const suggestions = suggestTagAliases(
      index([
        entry("writing", ["n1", "n2"]),
        entry("writting", ["n3", "n4"]),
      ]),
    );
    expect(suggestions[0].reason).not.toMatch(/used together/i);
  });

  it("skips pairs the user dismissed", () => {
    const dismissed = new Set([dismissedPairKey("cafe", "café")]);
    const suggestions = suggestTagAliases(
      index([entry("cafe", ["n1", "n2"]), entry("café", ["n3", "n4"])]),
      { dismissed },
    );
    expect(suggestions).toEqual([]);
  });

  it("drops a dismissed alias from a transitively-formed cluster", () => {
    // cafe ~ café (normalized), cafe ~ caffe (1 edit), but the user
    // dismissed the cafe↔café pair. The cluster still forms via caffe,
    // but café is filtered off the aliases list — the remaining
    // suggestion is cafe ← caffe.
    const dismissed = new Set([dismissedPairKey("cafe", "café")]);
    const suggestions = suggestTagAliases(
      index([
        entry("cafe", ["n1", "n2", "n3"]),
        entry("café", ["n4", "n5"]),
        entry("caffe", ["n6", "n7"]),
      ]),
      { dismissed },
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].canonical).toBe("cafe");
    expect(suggestions[0].aliases).toEqual(["caffe"]);
  });

  it("sorts output clusters by canonical tag name", () => {
    const suggestions = suggestTagAliases(
      index([
        entry("zulu", ["n1", "n2"]),
        entry("zulú", ["n3", "n4"]),
        entry("alpha", ["n5", "n6"]),
        entry("alphá", ["n7", "n8"]),
      ]),
    );
    expect(suggestions.map((s) => s.canonical)).toEqual(["alpha", "zulu"]);
  });

  it("returns [] when fewer than two candidate tags exist", () => {
    expect(suggestTagAliases(index([]))).toEqual([]);
    expect(suggestTagAliases(index([entry("coffee", ["n1", "n2"])]))).toEqual(
      [],
    );
  });

  it("honours custom thresholds", () => {
    // maxEditDistance 1: "writing"/"writting" (insertion, d=1) qualifies,
    // "writing"/"writingxy" (two insertions, d=2) does not.
    const suggestions = suggestTagAliases(
      index([
        entry("writing", ["n1", "n2", "n3"]),
        entry("writting", ["n4", "n5"]),
        entry("writingxy", ["n6", "n7"]),
      ]),
      { maxEditDistance: 1, maxRelativeDistance: 0.5 },
    );
    // The tighter absolute cap drops writingxy but keeps writting.
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].aliases).toEqual(["writting"]);
  });
});

describe("loadDismissedTagAliases", () => {
  it("returns an empty set when nothing is stored", () => {
    expect(loadDismissedTagAliases(createStorage()).size).toBe(0);
  });

  it("returns an empty set when the stored value is empty", () => {
    expect(
      loadDismissedTagAliases(createStorage({ [STORAGE_KEY]: "" })).size,
    ).toBe(0);
  });

  it("parses a CSV of pair keys", () => {
    const set = loadDismissedTagAliases(
      createStorage({ [STORAGE_KEY]: "a|b,cafe|café" }),
    );
    expect(set).toEqual(new Set(["a|b", "cafe|café"]));
  });

  it("drops entries without a | separator (corrupt)", () => {
    const set = loadDismissedTagAliases(
      createStorage({ [STORAGE_KEY]: "a|b,garbage,,x|y" }),
    );
    expect(set).toEqual(new Set(["a|b", "x|y"]));
  });

  it("trims whitespace around keys", () => {
    const set = loadDismissedTagAliases(
      createStorage({ [STORAGE_KEY]: "  a|b , cafe|café " }),
    );
    expect(set).toEqual(new Set(["a|b", "cafe|café"]));
  });
});

describe("persistDismissedTagAliases", () => {
  it("writes an empty string for an empty set", () => {
    const writes: Record<string, string> = {};
    persistDismissedTagAliases(new Set(), {
      setItem(key, value) {
        writes[key] = value;
      },
    });
    expect(writes[STORAGE_KEY]).toBe("");
  });

  it("writes keys in sorted order for stability across toggles", () => {
    const writes: Record<string, string> = {};
    persistDismissedTagAliases(new Set(["zulu|zulú", "a|b", "cafe|café"]), {
      setItem(key, value) {
        writes[key] = value;
      },
    });
    expect(writes[STORAGE_KEY]).toBe("a|b,cafe|café,zulu|zulú");
  });

  it("round-trips with loadDismissedTagAliases", () => {
    const storage = createStorage();
    const set = new Set(["cafe|café", "writing|writting"]);
    persistDismissedTagAliases(set, storage);
    expect(loadDismissedTagAliases(storage)).toEqual(set);
  });
});

describe("resolveInitialDismissedTagAliases", () => {
  it("mirrors loadDismissedTagAliases", () => {
    expect(
      resolveInitialDismissedTagAliases(
        createStorage({ [STORAGE_KEY]: "a|b" }),
      ),
    ).toEqual(new Set(["a|b"]));
  });
});

describe("addDismissedTagAlias", () => {
  it("adds a new pair without mutating the input", () => {
    const current = new Set<string>(["a|b"]);
    const next = addDismissedTagAlias(current, "cafe", "café");
    expect(next).toEqual(new Set(["a|b", "cafe|café"]));
    expect(current).toEqual(new Set(["a|b"]));
  });

  it("normalizes the pair key regardless of argument order", () => {
    const a = addDismissedTagAlias(new Set(), "coffee", "cafe");
    const b = addDismissedTagAlias(new Set(), "cafe", "coffee");
    expect(a).toEqual(b);
  });

  it("is idempotent when the pair is already dismissed", () => {
    const current = new Set<string>(["cafe|coffee"]);
    const next = addDismissedTagAlias(current, "coffee", "cafe");
    expect(next).toEqual(current);
    // Still a fresh Set so the setter's identity check fires a re-render.
    expect(next).not.toBe(current);
  });
});

describe("mergeTagInWorkspace", () => {
  const NOW = new Date("2026-04-23T12:00:00.000Z");

  it("replaces `from` with `to` across every carrying note", () => {
    const ws: SutraPadWorkspace = {
      activeNoteId: "a",
      notes: [
        note({ id: "a", tags: ["writing", "writting"] }),
        note({ id: "b", tags: ["writting"] }),
        note({ id: "c", tags: ["coffee"] }),
      ],
    };
    const next = mergeTagInWorkspace(ws, "writting", "writing", NOW);
    expect(next.notes[0].tags).toEqual(["writing"]);
    expect(next.notes[1].tags).toEqual(["writing"]);
    // Non-carrier stays untouched by reference.
    expect(next.notes[2]).toBe(ws.notes[2]);
  });

  it("bumps updatedAt for touched notes only", () => {
    const ws: SutraPadWorkspace = {
      activeNoteId: "a",
      notes: [
        note({
          id: "a",
          tags: ["writting"],
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        note({
          id: "b",
          tags: ["coffee"],
          updatedAt: "2026-02-02T00:00:00.000Z",
        }),
      ],
    };
    const next = mergeTagInWorkspace(ws, "writting", "writing", NOW);
    expect(next.notes[0].updatedAt).toBe(NOW.toISOString());
    expect(next.notes[1].updatedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("dedupes when the note already carries both `from` and `to`", () => {
    const ws: SutraPadWorkspace = {
      activeNoteId: "a",
      notes: [
        note({ id: "a", tags: ["writing", "notes", "writting"] }),
      ],
    };
    const next = mergeTagInWorkspace(ws, "writting", "writing", NOW);
    // First occurrence of `writing` stays in place; `writting` collapses
    // into the already-present `writing`.
    expect(next.notes[0].tags).toEqual(["writing", "notes"]);
  });

  it("is a no-op when `from` === `to`", () => {
    const ws: SutraPadWorkspace = {
      activeNoteId: "a",
      notes: [note({ id: "a", tags: ["writing"] })],
    };
    expect(mergeTagInWorkspace(ws, "writing", "writing", NOW)).toBe(ws);
  });

  it("returns the original workspace when no note carries `from`", () => {
    const ws: SutraPadWorkspace = {
      activeNoteId: "a",
      notes: [note({ id: "a", tags: ["coffee"] })],
    };
    expect(mergeTagInWorkspace(ws, "writting", "writing", NOW)).toBe(ws);
  });

  it("produces a workspace that stops surfacing the merged suggestion", () => {
    // Round-trip sanity: after the merge, suggestTagAliases no longer
    // emits the pair because one side has been fully replaced.
    const ws: SutraPadWorkspace = {
      activeNoteId: "a",
      notes: [
        note({ id: "a", tags: ["writing"] }),
        note({ id: "b", tags: ["writing"] }),
        note({ id: "c", tags: ["writting"] }),
        note({ id: "d", tags: ["writting"] }),
      ],
    };
    const merged = mergeTagInWorkspace(ws, "writting", "writing", NOW);
    // Build a fresh index over the merged workspace.
    const tagMap = new Map<string, string[]>();
    for (const n of merged.notes) {
      for (const tag of n.tags) {
        tagMap.set(tag, [...(tagMap.get(tag) ?? []), n.id]);
      }
    }
    const entries: SutraPadTagEntry[] = [...tagMap.entries()].map(
      ([tag, ids]) => entry(tag, ids),
    );
    expect(suggestTagAliases(index(entries))).toEqual([]);
  });
});
