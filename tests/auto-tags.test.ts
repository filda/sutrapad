import { describe, expect, it } from "vitest";
import { deriveAutoTags } from "../src/lib/auto-tags";
import type { SutraPadDocument } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "note-1",
    title: "Test",
    body: "",
    urls: [],
    createdAt: "2026-04-21T10:00:00.000Z",
    updatedAt: "2026-04-21T10:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

const NOW = new Date("2026-04-21T12:00:00.000Z");

describe("deriveAutoTags: dates", () => {
  it("tags notes created today", () => {
    const tags = deriveAutoTags(makeNote({ createdAt: "2026-04-21T08:00:00.000Z" }), NOW);

    expect(tags).toContain("date:today");
    expect(tags).toContain("date:this-week");
    expect(tags).toContain("date:this-month");
    expect(tags).toContain("year:2026");
    expect(tags).toContain("month:2026-04");
  });

  it("tags yesterday as yesterday, still this-week and this-month", () => {
    const tags = deriveAutoTags(makeNote({ createdAt: "2026-04-20T23:00:00.000Z" }), NOW);

    expect(tags).toContain("date:yesterday");
    expect(tags).toContain("date:this-week");
    expect(tags).toContain("date:this-month");
    expect(tags).not.toContain("date:today");
  });

  it("drops date:this-week once 7 days have passed", () => {
    const tags = deriveAutoTags(makeNote({ createdAt: "2026-04-13T12:00:00.000Z" }), NOW);

    expect(tags).not.toContain("date:today");
    expect(tags).not.toContain("date:yesterday");
    expect(tags).not.toContain("date:this-week");
    expect(tags).toContain("date:this-month");
  });

  it("drops date:this-month after 30 days", () => {
    const tags = deriveAutoTags(makeNote({ createdAt: "2026-03-01T10:00:00.000Z" }), NOW);

    expect(tags).not.toContain("date:this-month");
    expect(tags).toContain("year:2026");
    expect(tags).toContain("month:2026-03");
  });

  it("excludes date:this-week at the 7-day boundary (< 7, not <= 7)", () => {
    // NOW = 2026-04-21T12Z; createdAt exactly 7 days earlier → dayDelta === 7
    // The this-week window is rolling and exclusive on the upper edge.
    const tags = deriveAutoTags(makeNote({ createdAt: "2026-04-14T12:00:00.000Z" }), NOW);

    expect(tags).not.toContain("date:this-week");
    expect(tags).toContain("date:this-month");
  });

  it("excludes date:this-month at the 30-day boundary (< 30, not <= 30)", () => {
    // 30 days before 2026-04-21 is 2026-03-22. Same-day-of-month 21 + 30 days.
    const tags = deriveAutoTags(makeNote({ createdAt: "2026-03-22T12:00:00.000Z" }), NOW);

    expect(tags).not.toContain("date:this-month");
    expect(tags).toContain("month:2026-03");
  });

  it("pads single-digit months in year-month tag", () => {
    const tags = deriveAutoTags(makeNote({ createdAt: "2026-01-04T10:00:00.000Z" }), NOW);

    expect(tags).toContain("month:2026-01");
  });

  it("skips date tags when createdAt is unparseable", () => {
    const tags = deriveAutoTags(makeNote({ createdAt: "not-a-date" }), NOW);

    expect(tags.some((tag) => tag.startsWith("date:"))).toBe(false);
    expect(tags.some((tag) => tag.startsWith("year:"))).toBe(false);
    expect(tags.some((tag) => tag.startsWith("month:"))).toBe(false);
  });
});

describe("deriveAutoTags: source / device / language", () => {
  it("emits the capture source as source:<kind>", () => {
    const tags = deriveAutoTags(
      makeNote({ captureContext: { source: "url-capture" } }),
      NOW,
    );

    expect(tags).toContain("source:url-capture");
  });

  it("emits device, os, and browser tags", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "new-note",
          deviceType: "mobile",
          os: "iOS 17.4",
          browser: "Safari",
        },
      }),
      NOW,
    );

    expect(tags).toContain("device:mobile");
    expect(tags).toContain("os:ios-17-4");
    expect(tags).toContain("browser:safari");
  });

  it("prefers page language over device language", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "url-capture",
          languages: ["en-US"],
          locale: "en-US",
          page: { lang: "cs" },
        },
      }),
      NOW,
    );

    expect(tags).toContain("lang:cs");
    expect(tags).not.toContain("lang:en");
  });

  it("falls back to device locale when page lang is missing", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "new-note",
          languages: ["pt-BR"],
        },
      }),
      NOW,
    );

    expect(tags).toContain("lang:pt");
  });
});

describe("deriveAutoTags: location / network / weather / battery / scroll", () => {
  it("slugifies note.location", () => {
    const tags = deriveAutoTags(makeNote({ location: "Prague, Czechia" }), NOW);

    expect(tags).toContain("location:prague-czechia");
  });

  it("emits network state, effective type, and save-data flag", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "text-capture",
          network: {
            online: true,
            effectiveType: "4g",
            saveData: true,
          },
        },
      }),
      NOW,
    );

    expect(tags).toContain("network:online");
    expect(tags).toContain("network:4g");
    expect(tags).toContain("network:save-data");
  });

  it("tags offline notes explicitly", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: { source: "new-note", network: { online: false } },
      }),
      NOW,
    );

    expect(tags).toContain("network:offline");
    expect(tags).not.toContain("network:online");
  });

  it("buckets temperature into warm / cool / cold", () => {
    const warm = deriveAutoTags(
      makeNote({
        captureContext: { source: "new-note", weather: { temperatureC: 25, source: "open-meteo" } },
      }),
      NOW,
    );
    const cool = deriveAutoTags(
      makeNote({
        captureContext: { source: "new-note", weather: { temperatureC: 10, source: "open-meteo" } },
      }),
      NOW,
    );
    const cold = deriveAutoTags(
      makeNote({
        captureContext: { source: "new-note", weather: { temperatureC: -3, source: "open-meteo" } },
      }),
      NOW,
    );

    expect(warm).toContain("weather:warm");
    expect(cool).toContain("weather:cool");
    expect(cold).toContain("weather:cold");
  });

  it("tags day / night and windy separately", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "new-note",
          weather: {
            isDay: false,
            temperatureC: 12,
            windSpeedKmh: 40,
            source: "open-meteo",
          },
        },
      }),
      NOW,
    );

    expect(tags).toContain("weather:night");
    expect(tags).toContain("weather:windy");
    expect(tags).not.toContain("weather:day");
  });

  it("emits battery:charging and battery:low independently", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "new-note",
          battery: { charging: true, levelPercent: 15 },
        },
      }),
      NOW,
    );

    expect(tags).toContain("battery:charging");
    expect(tags).toContain("battery:low");
  });

  it("buckets scroll progress into top / middle / bottom", () => {
    const top = deriveAutoTags(
      makeNote({ captureContext: { source: "url-capture", scroll: { progress: 0.02 } } }),
      NOW,
    );
    const middle = deriveAutoTags(
      makeNote({ captureContext: { source: "url-capture", scroll: { progress: 0.5 } } }),
      NOW,
    );
    const bottom = deriveAutoTags(
      makeNote({ captureContext: { source: "url-capture", scroll: { progress: 0.95 } } }),
      NOW,
    );

    expect(top).toContain("scroll:top");
    expect(middle).toContain("scroll:middle");
    expect(bottom).toContain("scroll:bottom");
  });
});

describe("deriveAutoTags: edit state", () => {
  it("tags untouched notes as edit:fresh (createdAt === updatedAt)", () => {
    const tags = deriveAutoTags(
      makeNote({
        createdAt: "2026-04-21T10:00:00.000Z",
        updatedAt: "2026-04-21T10:00:00.000Z",
      }),
      NOW,
    );

    expect(tags).toContain("edit:fresh");
    expect(tags).not.toContain("edit:revised");
  });

  it("tags re-saved notes as edit:revised when updatedAt is later", () => {
    const tags = deriveAutoTags(
      makeNote({
        createdAt: "2026-04-21T10:00:00.000Z",
        updatedAt: "2026-04-21T10:00:01.000Z",
      }),
      NOW,
    );

    expect(tags).toContain("edit:revised");
    expect(tags).not.toContain("edit:fresh");
  });

  it("skips the edit facet when either timestamp is unparseable", () => {
    const tags = deriveAutoTags(
      makeNote({ createdAt: "not-a-date", updatedAt: "2026-04-21T10:00:00.000Z" }),
      NOW,
    );

    expect(tags.some((tag) => tag.startsWith("edit:"))).toBe(false);
  });
});

describe("deriveAutoTags: orientation", () => {
  it("collapses -primary / -secondary into the base orientation bucket", () => {
    const primary = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "url-capture",
          screen: { orientation: "portrait-primary" },
        },
      }),
      NOW,
    );
    const secondary = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "url-capture",
          screen: { orientation: "landscape-secondary" },
        },
      }),
      NOW,
    );

    expect(primary).toContain("orientation:portrait");
    expect(primary).not.toContain("orientation:portrait-primary");
    expect(secondary).toContain("orientation:landscape");
    expect(secondary).not.toContain("orientation:landscape-secondary");
  });

  it("emits nothing when the orientation string is absent", () => {
    const tags = deriveAutoTags(
      makeNote({ captureContext: { source: "new-note", screen: {} } }),
      NOW,
    );

    expect(tags.some((tag) => tag.startsWith("orientation:"))).toBe(false);
  });

  it("emits nothing for orientation values outside portrait/landscape", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "url-capture",
          screen: { orientation: "any" },
        },
      }),
      NOW,
    );

    expect(tags.some((tag) => tag.startsWith("orientation:"))).toBe(false);
  });
});

describe("deriveAutoTags: author", () => {
  it("slugifies the captured page author", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "url-capture",
          page: { author: "Jane Doe" },
        },
      }),
      NOW,
    );

    expect(tags).toContain("author:jane-doe");
  });

  it("preserves Unicode (Czech diacritics) in author slugs", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "url-capture",
          page: { author: "Karel Čapek" },
        },
      }),
      NOW,
    );

    expect(tags).toContain("author:karel-čapek");
  });

  it("skips the facet when page.author is missing — no author:unknown noise", () => {
    const tags = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "url-capture",
          page: { title: "An article" },
        },
      }),
      NOW,
    );

    expect(tags.some((tag) => tag.startsWith("author:"))).toBe(false);
  });
});

describe("deriveAutoTags: weather conditions (WMO)", () => {
  function weatherTagsFor(code: number): string[] {
    return deriveAutoTags(
      makeNote({
        captureContext: {
          source: "new-note",
          weather: { weatherCode: code, source: "open-meteo" },
        },
      }),
      NOW,
    );
  }

  it("maps codes 0 and 1 to weather:clear", () => {
    expect(weatherTagsFor(0)).toContain("weather:clear");
    expect(weatherTagsFor(1)).toContain("weather:clear");
  });

  it("maps codes 2 and 3 to weather:cloudy", () => {
    expect(weatherTagsFor(2)).toContain("weather:cloudy");
    expect(weatherTagsFor(3)).toContain("weather:cloudy");
  });

  it("maps 45 and 48 to weather:fog", () => {
    expect(weatherTagsFor(45)).toContain("weather:fog");
    expect(weatherTagsFor(48)).toContain("weather:fog");
  });

  it("maps drizzle / rain / freezing-rain (51–67) and rain-showers (80–82) to weather:rain", () => {
    for (const code of [51, 55, 61, 65, 67, 80, 81, 82]) {
      expect(weatherTagsFor(code), `code ${code}`).toContain("weather:rain");
    }
  });

  it("maps snow (71–77) and snow-showers (85, 86) to weather:snow", () => {
    for (const code of [71, 73, 75, 77, 85, 86]) {
      expect(weatherTagsFor(code), `code ${code}`).toContain("weather:snow");
    }
  });

  it("maps thunderstorm codes 95–99 to weather:thunder", () => {
    for (const code of [95, 96, 99]) {
      expect(weatherTagsFor(code), `code ${code}`).toContain("weather:thunder");
    }
  });

  it("emits no condition tag for unknown codes or when weatherCode is missing", () => {
    // 44 sits in the gap between cloudy (0–3) and fog (45, 48).
    const unknown = weatherTagsFor(44);
    expect(
      unknown.filter((tag) =>
        ["weather:clear", "weather:cloudy", "weather:fog", "weather:rain", "weather:snow", "weather:thunder"].includes(tag),
      ),
    ).toHaveLength(0);

    const missing = deriveAutoTags(
      makeNote({
        captureContext: {
          source: "new-note",
          weather: { temperatureC: 15, source: "open-meteo" },
        },
      }),
      NOW,
    );
    expect(missing).not.toContain("weather:clear");
    expect(missing).not.toContain("weather:cloudy");
  });
});

describe("deriveAutoTags: engagement", () => {
  function engagementTagsFor(ms: number): string[] {
    return deriveAutoTags(
      makeNote({
        captureContext: { source: "url-capture", timeOnPageMs: ms },
      }),
      NOW,
    );
  }

  it("tags under 30 seconds as engagement:skimmed", () => {
    expect(engagementTagsFor(0)).toContain("engagement:skimmed");
    expect(engagementTagsFor(29_999)).toContain("engagement:skimmed");
  });

  it("tags 30 s – 5 min as engagement:read (inclusive of 30_000)", () => {
    expect(engagementTagsFor(30_000)).toContain("engagement:read");
    expect(engagementTagsFor(120_000)).toContain("engagement:read");
    expect(engagementTagsFor(299_999)).toContain("engagement:read");
  });

  it("tags 5 min and beyond as engagement:deep-dive (inclusive of 300_000)", () => {
    expect(engagementTagsFor(300_000)).toContain("engagement:deep-dive");
    expect(engagementTagsFor(30 * 60_000)).toContain("engagement:deep-dive");
  });

  it("skips the facet when timeOnPageMs is missing or negative", () => {
    const missing = deriveAutoTags(
      makeNote({ captureContext: { source: "new-note" } }),
      NOW,
    );
    expect(missing.some((tag) => tag.startsWith("engagement:"))).toBe(false);

    const negative = engagementTagsFor(-1);
    expect(negative.some((tag) => tag.startsWith("engagement:"))).toBe(false);
  });
});

describe("deriveAutoTags: tasks", () => {
  it("tags notes with no checkboxes as tasks:none", () => {
    const tags = deriveAutoTags(
      makeNote({ body: "Just some prose, no checklists here." }),
      NOW,
    );

    expect(tags).toContain("tasks:none");
  });

  it("tags any outstanding unchecked task as tasks:open", () => {
    const tags = deriveAutoTags(
      makeNote({
        body: ["- [ ] buy milk", "- [x] send invoice"].join("\n"),
      }),
      NOW,
    );

    expect(tags).toContain("tasks:open");
    expect(tags).not.toContain("tasks:done");
    expect(tags).not.toContain("tasks:none");
  });

  it("tags a fully-checked checklist as tasks:done", () => {
    const tags = deriveAutoTags(
      makeNote({
        body: ["- [x] wake up", "- [X] ship it"].join("\n"),
      }),
      NOW,
    );

    expect(tags).toContain("tasks:done");
    expect(tags).not.toContain("tasks:open");
    expect(tags).not.toContain("tasks:none");
  });
});

describe("deriveAutoTags: domains are handled by the Links page, not tags", () => {
  it("does not emit `domain:*` tags even when the note has URLs", () => {
    const tags = deriveAutoTags(
      makeNote({
        urls: [
          "https://www.example.com/one",
          "https://blog.example.com/two",
        ],
      }),
      NOW,
    );

    expect(tags.some((tag) => tag.startsWith("domain:"))).toBe(false);
  });
});

describe("deriveAutoTags: robustness", () => {
  it("returns a small, namespaced set for a note with no capture context", () => {
    const tags = deriveAutoTags(makeNote(), NOW);

    expect(tags.every((tag) => tag.includes(":"))).toBe(true);
    expect(tags).toContain("date:today");
    // Facets derived from the note itself (not captureContext) also apply to
    // bare notes: a just-created note has identical timestamps, and prose
    // without checkboxes is tasks:none.
    expect(tags).toContain("edit:fresh");
    expect(tags).toContain("tasks:none");
  });

  it("produces identical output for identical input (deterministic)", () => {
    const note = makeNote({
      captureContext: { source: "url-capture", deviceType: "desktop" },
      urls: ["https://example.com/a"],
    });

    expect(deriveAutoTags(note, NOW)).toEqual(deriveAutoTags(note, NOW));
  });
});
