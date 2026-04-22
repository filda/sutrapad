import { describe, expect, it } from "vitest";
import {
  TAG_CLASSES,
  TAG_CLASS_IDS,
  classifyAutoTag,
  classifyTag,
  classifyTagEntry,
  groupTagsByClass,
  metaForClass,
  parseTagName,
  type TagClassId,
} from "../src/app/logic/tag-class";

describe("TAG_CLASSES", () => {
  it("matches the handoff taxonomy verbatim (label + symbol + role)", () => {
    // Drift-guard: the view layer styles pills by class hue and renders the
    // symbol inline, so a silent rename/recolour here would be a visual bug.
    // The exact values come from `docs/design_handoff_sutrapad2/src/data.jsx`.
    expect(TAG_CLASSES).toEqual({
      topic: {
        label: "Topic",
        symbol: "#",
        hue: 18,
        role: "user",
        desc: "Concepts, projects, ideas — what it's about.",
      },
      place: {
        label: "Place",
        symbol: "@",
        hue: 140,
        role: "auto",
        desc: "Location — from GPS or reverse geocode.",
      },
      when: {
        label: "When",
        symbol: "~",
        hue: 260,
        role: "auto",
        desc: "Time of day, day of week, season.",
      },
      source: {
        label: "Source",
        symbol: "!",
        hue: 45,
        role: "auto",
        desc: "How the note was captured.",
      },
      device: {
        label: "Device",
        symbol: "%",
        hue: 200,
        role: "auto",
        desc: "Which device wrote it.",
      },
      weather: {
        label: "Weather",
        symbol: "^",
        hue: 190,
        role: "auto",
        desc: "Conditions at capture time.",
      },
      people: {
        label: "People",
        symbol: "*",
        hue: 330,
        role: "auto",
        desc: "Mentioned in the body.",
      },
    });
  });

  it("marks only topic as user-authored", () => {
    const userClasses = TAG_CLASS_IDS.filter(
      (id) => TAG_CLASSES[id].role === "user",
    );
    expect(userClasses).toEqual(["topic"]);
  });

  it("has unique symbols so parser heuristics never collide", () => {
    const symbols = TAG_CLASS_IDS.map((id) => TAG_CLASSES[id].symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("has unique hues so pill colours don't alias across classes", () => {
    const hues = TAG_CLASS_IDS.map((id) => TAG_CLASSES[id].hue);
    expect(new Set(hues).size).toBe(hues.length);
  });
});

describe("TAG_CLASS_IDS", () => {
  it("iterates every class exactly once", () => {
    expect([...TAG_CLASS_IDS].toSorted()).toEqual(
      Object.keys(TAG_CLASSES).toSorted(),
    );
  });

  it("leads with topic (user-authored) per handoff visual order", () => {
    // The Tags page renders sections in this order; topic coming first is
    // load-bearing — user-authored content should sit above derived facets.
    expect(TAG_CLASS_IDS[0]).toBe("topic");
  });
});

describe("parseTagName", () => {
  it("splits namespaced auto-tags on the first colon", () => {
    expect(parseTagName("date:today")).toEqual({
      facet: "date",
      value: "today",
    });
    expect(parseTagName("location:prague")).toEqual({
      facet: "location",
      value: "prague",
    });
  });

  it("returns no facet for plain user tags", () => {
    expect(parseTagName("coffee")).toEqual({ facet: null, value: "coffee" });
    expect(parseTagName("writing")).toEqual({
      facet: null,
      value: "writing",
    });
  });

  it("preserves colons inside the value (month:2026-03)", () => {
    // `month:` auto-tags and hypothetical future `iso:2026-03-05T12:30` tags
    // rely on the "first colon only" split — splitting on every colon would
    // corrupt the value.
    expect(parseTagName("month:2026-03")).toEqual({
      facet: "month",
      value: "2026-03",
    });
    expect(parseTagName("custom:a:b:c")).toEqual({
      facet: "custom",
      value: "a:b:c",
    });
  });

  it("treats a leading colon as 'no facet' (empty facet is not a namespace)", () => {
    // Guards against misclassifying a user tag that happens to start with `:`.
    expect(parseTagName(":stranded")).toEqual({
      facet: null,
      value: ":stranded",
    });
  });

  it("treats bare facet (no value) as a facet with empty value", () => {
    // Shouldn't come out of deriveAutoTags, but `classifyTag` should still
    // handle it without crashing.
    expect(parseTagName("date:")).toEqual({ facet: "date", value: "" });
  });
});

describe("classifyTag", () => {
  it("maps user tags to topic regardless of string shape", () => {
    expect(classifyTag("coffee", "user")).toBe<TagClassId>("topic");
    expect(classifyTag("writing", "user")).toBe<TagClassId>("topic");
    // Even if a user somehow enters a colon-shaped string, classifying by
    // kind wins — authorship trumps lexical shape.
    expect(classifyTag("location:prague", "user")).toBe<TagClassId>("topic");
  });

  it("treats missing kind as user (legacy compatibility)", () => {
    // Pre-auto-tag persisted indexes come back with `kind: undefined`;
    // `buildCombinedTagIndex` treats those as user, so this lookup must
    // behave consistently.
    expect(classifyTag("coffee", undefined)).toBe<TagClassId>("topic");
  });

  it.each<[string, TagClassId]>([
    // when
    ["date:today", "when"],
    ["date:yesterday", "when"],
    ["date:this-week", "when"],
    ["date:this-month", "when"],
    ["year:2026", "when"],
    ["month:2026-03", "when"],
    // place
    ["location:prague", "place"],
    // source (capture + workflow + reading)
    ["source:web", "source"],
    ["source:shortcut", "source"],
    ["edit:fresh", "source"],
    ["edit:revised", "source"],
    ["lang:cs", "source"],
    ["scroll:top", "source"],
    ["scroll:middle", "source"],
    ["scroll:bottom", "source"],
    ["engagement:skimmed", "source"],
    ["engagement:read", "source"],
    ["engagement:deep-dive", "source"],
    ["tasks:open", "source"],
    ["tasks:done", "source"],
    ["tasks:none", "source"],
    // device
    ["device:mobile", "device"],
    ["device:desktop", "device"],
    ["device:tablet", "device"],
    ["os:macos", "device"],
    ["browser:firefox", "device"],
    ["orientation:portrait", "device"],
    ["orientation:landscape", "device"],
    ["network:online", "device"],
    ["network:offline", "device"],
    ["network:4g", "device"],
    ["network:save-data", "device"],
    ["battery:charging", "device"],
    ["battery:low", "device"],
    // weather
    ["weather:warm", "weather"],
    ["weather:cool", "weather"],
    ["weather:cold", "weather"],
    ["weather:day", "weather"],
    ["weather:night", "weather"],
    ["weather:rain", "weather"],
    ["weather:snow", "weather"],
    // people
    ["author:jan-novak", "people"],
  ])("classifies auto-tag %s as %s", (tag, expected) => {
    expect(classifyTag(tag, "auto")).toBe(expected);
  });

  it("falls back to source for unknown auto-tag facets", () => {
    // Defensive default: if someone adds a new auto-tag facet in
    // `deriveAutoTags` without updating the class map, it renders as a
    // source pill rather than crashing the index build.
    expect(classifyTag("somethingnew:value", "auto")).toBe<TagClassId>(
      "source",
    );
  });

  it("falls back to source for a non-namespaced auto-tag", () => {
    // Auto-tags without a colon aren't produced today, but if one slipped
    // through (e.g. a hand-rolled migration) we still need a class.
    expect(classifyTag("rogue", "auto")).toBe<TagClassId>("source");
  });
});

describe("classifyAutoTag", () => {
  it("is a thin alias for classifyTag(_, 'auto')", () => {
    // Sanity-check the convenience wrapper against its underlying contract
    // — mainly to catch accidental decoupling during a future refactor.
    expect(classifyAutoTag("date:today")).toBe(classifyTag("date:today", "auto"));
    expect(classifyAutoTag("location:prague")).toBe(
      classifyTag("location:prague", "auto"),
    );
    expect(classifyAutoTag("unknown:facet")).toBe(
      classifyTag("unknown:facet", "auto"),
    );
  });
});

describe("metaForClass", () => {
  it("returns the full meta record for every class id", () => {
    for (const id of TAG_CLASS_IDS) {
      expect(metaForClass(id)).toBe(TAG_CLASSES[id]);
    }
  });
});

describe("classifyTagEntry", () => {
  it("reads tag + kind off the entry and delegates to classifyTag", () => {
    expect(classifyTagEntry({ tag: "coffee", kind: "user" })).toBe<TagClassId>(
      "topic",
    );
    expect(
      classifyTagEntry({ tag: "location:prague", kind: "auto" }),
    ).toBe<TagClassId>("place");
    expect(
      classifyTagEntry({ tag: "date:today", kind: "auto" }),
    ).toBe<TagClassId>("when");
  });

  it("honours the legacy missing-kind convention (→ topic)", () => {
    expect(classifyTagEntry({ tag: "legacy" })).toBe<TagClassId>("topic");
  });

  it("ignores extra fields on the entry (structural typing)", () => {
    // Real SutraPadTagEntry has count/noteIds too; helper must not care.
    const entry = {
      tag: "weather:rain",
      kind: "auto" as const,
      count: 3,
      noteIds: ["a", "b", "c"],
    };
    expect(classifyTagEntry(entry)).toBe<TagClassId>("weather");
  });
});

describe("groupTagsByClass", () => {
  it("buckets entries into every class key, empty arrays included", () => {
    // Every class must be present in the result even when empty, so callers
    // can iterate TAG_CLASS_IDS without defensively checking existence.
    const groups = groupTagsByClass([]);
    for (const id of TAG_CLASS_IDS) {
      expect(groups[id]).toEqual([]);
    }
  });

  it("classifies and preserves input order within each class", () => {
    const entries = [
      { tag: "coffee", kind: "user" as const },
      { tag: "writing", kind: "user" as const },
      { tag: "location:prague", kind: "auto" as const },
      { tag: "date:today", kind: "auto" as const },
      { tag: "weather:rain", kind: "auto" as const },
      { tag: "date:yesterday", kind: "auto" as const },
      { tag: "location:berlin", kind: "auto" as const },
      { tag: "author:jan-novak", kind: "auto" as const },
    ];
    const groups = groupTagsByClass(entries);

    expect(groups.topic.map((e) => e.tag)).toEqual(["coffee", "writing"]);
    expect(groups.when.map((e) => e.tag)).toEqual([
      "date:today",
      "date:yesterday",
    ]);
    expect(groups.place.map((e) => e.tag)).toEqual([
      "location:prague",
      "location:berlin",
    ]);
    expect(groups.weather.map((e) => e.tag)).toEqual(["weather:rain"]);
    expect(groups.people.map((e) => e.tag)).toEqual(["author:jan-novak"]);
    expect(groups.source).toEqual([]);
    expect(groups.device).toEqual([]);
  });

  it("routes unknown auto-facets into source per classifyTag fallback", () => {
    const groups = groupTagsByClass([
      { tag: "mystery:value", kind: "auto" as const },
      { tag: "rogue", kind: "auto" as const },
    ]);
    expect(groups.source.map((e) => e.tag)).toEqual([
      "mystery:value",
      "rogue",
    ]);
  });

  it("retains reference identity — entries are the original objects, not copies", () => {
    // The palette + Tags page use `===` to compare entries across renders;
    // cloning would silently break selection state.
    const entry = { tag: "coffee", kind: "user" as const };
    const groups = groupTagsByClass([entry]);
    expect(groups.topic[0]).toBe(entry);
  });
});
