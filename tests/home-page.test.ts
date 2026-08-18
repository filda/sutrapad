// @vitest-environment happy-dom
//
// Home page stats + timeline, read from the resident summary/task/link
// models (Phase 2 notes-scaling) rather than `workspace.notes` bodies. Pins
// two regressions a naive body-scan would reintroduce for a placeholder
// note: open-task counts must come from `taskIndex`, and the timeline
// excerpt must come from the precomputed `summary.excerpt`, not the (empty)
// body.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHomePage } from "../src/app/view/pages/home-page";
import type {
  SutraPadLinkIndex,
  SutraPadNoteSummary,
  SutraPadTaskIndex,
} from "../src/types";

const NOW = new Date();

function summary(overrides: Partial<SutraPadNoteSummary> = {}): SutraPadNoteSummary {
  return {
    id: "n1",
    title: "Untitled",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    tags: [],
    ...overrides,
  };
}

function emptyTaskIndex(): SutraPadTaskIndex {
  return { version: 1, savedAt: NOW.toISOString(), tasks: [] };
}

function emptyLinkIndex(): SutraPadLinkIndex {
  return { version: 1, savedAt: NOW.toISOString(), links: [] };
}

describe("buildHomePage", () => {
  it("counts open tasks from taskIndex, not from note bodies", () => {
    // The note itself has no body-derivable task info (it's a Phase 2
    // placeholder — body is ""), but taskIndex still carries one open task
    // for it. A body-scan would report 0; the index must report 1.
    const noteSummaries = [summary({ id: "n1" })];
    const taskIndex: SutraPadTaskIndex = {
      version: 1,
      savedAt: NOW.toISOString(),
      tasks: [
        { noteId: "n1", lineIndex: 0, text: "call back", done: false, noteUpdatedAt: NOW.toISOString() },
        { noteId: "n1", lineIndex: 1, text: "done already", done: true, noteUpdatedAt: NOW.toISOString() },
      ],
    };

    const page = buildHomePage({
      noteSummaries,
      taskIndex,
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    const openTasksStat = page.querySelector(".stat.is-accent .stat-value");
    expect(openTasksStat?.textContent).toBe("1");
  });

  it("counts distinct tags from both user tags and autoTags across summaries", () => {
    const noteSummaries = [
      summary({ id: "n1", tags: ["work"], autoTags: ["date:today"] }),
      summary({ id: "n2", tags: ["work", "personal"] }),
    ];

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    const stats = [...page.querySelectorAll(".stat")];
    const tagsStat = stats.find((s) => s.textContent?.includes("Tags"));
    expect(tagsStat?.querySelector(".stat-value")?.textContent).toBe("3");
  });

  it("reports the notes count and link count from the resident models", () => {
    const noteSummaries = [summary({ id: "n1" }), summary({ id: "n2" })];
    const linkIndex: SutraPadLinkIndex = {
      version: 1,
      savedAt: NOW.toISOString(),
      links: [{ url: "https://example.com", noteIds: ["n1"], count: 1, latestUpdatedAt: NOW.toISOString() }],
    };

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex,
      profile: null,
      onOpenNote: () => undefined,
    });

    const stats = [...page.querySelectorAll(".stat")];
    const notesStat = stats.find((s) => s.textContent?.includes("Notes"));
    const linksStat = stats.find((s) => s.textContent?.includes("Links"));
    expect(notesStat?.querySelector(".stat-value")?.textContent).toBe("2");
    expect(linksStat?.querySelector(".stat-value")?.textContent).toBe("1");
  });

  it("renders a timeline card using the summary's title, precomputed excerpt, and tags", () => {
    const noteSummaries = [
      summary({
        id: "n1",
        title: "Grocery list",
        excerpt: "milk, eggs, bread",
        tags: ["errands"],
        updatedAt: NOW.toISOString(),
      }),
    ];

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    expect(page.querySelector(".tl-title")?.textContent).toBe("Grocery list");
    expect(page.querySelector(".tl-excerpt")?.textContent).toBe("milk, eggs, bread");
    expect(page.textContent).toContain("errands");
  });

  it("falls back to no excerpt paragraph when the summary has none (unhydrated placeholder)", () => {
    const noteSummaries = [summary({ id: "n1", title: "Placeholder", excerpt: undefined })];

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    expect(page.querySelector(".tl-excerpt")).toBeNull();
  });

  it("invokes onOpenNote with the summary id when a timeline card is clicked", () => {
    const noteSummaries = [summary({ id: "n42", title: "Click me" })];
    let opened: string | null = null;

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: (id) => {
        opened = id;
      },
    });

    (page.querySelector(".tl-card") as HTMLButtonElement).click();
    expect(opened).toBe("n42");
  });

  it("renders no timeline when there are no notes", () => {
    const page = buildHomePage({
      noteSummaries: [],
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    expect(page.querySelector(".timeline")).toBeNull();
  });
});

function taskIndexWith(tasks: SutraPadTaskIndex["tasks"]): SutraPadTaskIndex {
  return { version: 1, savedAt: NOW.toISOString(), tasks };
}

function task(
  noteId: string,
  done: boolean,
  lineIndex = 0,
): SutraPadTaskIndex["tasks"][number] {
  return { noteId, lineIndex, text: "t", done, noteUpdatedAt: NOW.toISOString() };
}

function homePage(overrides: Partial<Parameters<typeof buildHomePage>[0]> = {}) {
  return buildHomePage({
    noteSummaries: [summary()],
    taskIndex: emptyTaskIndex(),
    linkIndex: emptyLinkIndex(),
    profile: null,
    onOpenNote: () => undefined,
    ...overrides,
  });
}

/** Value of `--nc-bg` on the first timeline card, or "" when undecorated. */
function cardPaperBg(page: HTMLElement): string {
  return (
    page.querySelector<HTMLElement>(".tl-card")?.style.getPropertyValue("--nc-bg") ?? ""
  );
}

function statPairs(page: HTMLElement): Array<[string, string]> {
  return [...page.querySelectorAll(".today-stats .stat")].map((stat) => [
    stat.querySelector(".stat-label")?.textContent ?? "",
    stat.querySelector(".stat-value")?.textContent ?? "",
  ]);
}

describe("buildHomePage stats strip", () => {
  it("renders the four stats in order, accenting only Open tasks", () => {
    const page = homePage({
      noteSummaries: [summary({ id: "a", tags: ["work"] }), summary({ id: "b" })],
      taskIndex: taskIndexWith([task("a", false)]),
      linkIndex: {
        version: 1,
        savedAt: NOW.toISOString(),
        links: [
          {
            url: "https://a.example",
            noteIds: ["a"],
            count: 1,
            latestUpdatedAt: NOW.toISOString(),
          },
        ],
      },
    });

    expect(page.querySelector(".today-stats")).not.toBeNull();
    expect(statPairs(page)).toEqual([
      ["Notes", "2"],
      ["Open tasks", "1"],
      ["Tags", "1"],
      ["Links", "1"],
    ]);

    const accented = [...page.querySelectorAll(".today-stats .stat.is-accent")];
    expect(accented).toHaveLength(1);
    expect(accented[0].querySelector(".stat-label")?.textContent).toBe("Open tasks");
  });

  it("counts only the undone tasks, with more open than done in the fixture", () => {
    // A 1-open/1-done fixture can't tell "count open" from "count done" apart —
    // both come out as 1. Two open and one done can.
    const page = homePage({
      noteSummaries: [summary({ id: "a" })],
      taskIndex: taskIndexWith([
        task("a", false, 0),
        task("a", false, 1),
        task("a", true, 2),
      ]),
    });
    expect(statPairs(page)).toContainEqual(["Open tasks", "2"]);
  });

  it("unions user tags with auto-tags and tolerates summaries missing both fields", () => {
    const bare: SutraPadNoteSummary = {
      id: "bare",
      title: "Bare",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const page = homePage({
      noteSummaries: [
        summary({ id: "a", tags: ["work"], autoTags: ["place:praha", "work"] }),
        bare,
      ],
    });
    // "work" counted once, "place:praha" once, the bare summary adds nothing.
    expect(statPairs(page)).toContainEqual(["Tags", "2"]);
  });
});

describe("buildHomePage header", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.removeItem("sp.intros.v1");
  });

  it("greets by time of day", () => {
    vi.useFakeTimers();
    for (const [iso, word] of [
      ["2026-08-17T09:00:00", "morning"],
      ["2026-08-17T14:00:00", "afternoon"],
      ["2026-08-17T20:00:00", "evening"],
    ] as const) {
      vi.setSystemTime(new Date(iso));
      const page = homePage();
      expect(page.querySelector(".page-title em")?.textContent).toBe(word);
    }
  });

  it("appends the profile's first name, trimmed at the first whitespace run", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T09:00:00"));
    const page = homePage({ profile: { name: "  Filip   Šubr ", email: "f@b.com" } });
    expect(page.querySelector(".page-title")?.textContent).toBe("Good morning, Filip.");
  });

  it("ends on a bare period for a signed-out or nameless profile", () => {
    expect(homePage().querySelector(".page-title")?.textContent).toMatch(/\.$/u);
    expect(
      homePage({ profile: { name: "   ", email: "f@b.com" } }).querySelector(
        ".page-title",
      )?.textContent,
    ).not.toContain(",");
  });

  it("writes the fresh-notebook subtitle when there are no notes", () => {
    const page = homePage({ noteSummaries: [] });
    expect(page.querySelector(".page-subtitle")?.textContent).toBe(
      "A fresh notebook. Start a note or drop a link in — everything you write lives here.",
    );
  });

  it("writes counts in the subtitle, singular and plural", () => {
    const one = homePage({
      noteSummaries: [summary({ id: "a" })],
      taskIndex: taskIndexWith([task("a", false)]),
    });
    expect(one.querySelector(".page-subtitle")?.textContent).toBe(
      "1 note, 1 open thread. Pick up where you left off.",
    );

    const many = homePage({
      noteSummaries: [summary({ id: "a" }), summary({ id: "b" })],
      taskIndex: taskIndexWith([task("a", false), task("b", false)]),
    });
    expect(many.querySelector(".page-subtitle")?.textContent).toBe(
      "2 notes, 2 open threads. Pick up where you left off.",
    );
  });

  it("says `no open threads` when the backlog is clear", () => {
    const page = homePage({ noteSummaries: [summary({ id: "a" })] });
    expect(page.querySelector(".page-subtitle")?.textContent).toBe(
      "1 note, no open threads. Pick up where you left off.",
    );
  });

  it("persists the intro state under the `home` pageId", () => {
    window.localStorage.removeItem("sp.intros.v1");
    homePage();
    expect(window.localStorage.getItem("sp.intros.v1") ?? "").toContain('"home"');
  });

  it("keeps the lockup expanded past the auto-fade visit threshold", () => {
    // Home passes `noAutoFade` because the greeting and counts carry live
    // information — unlike a static onboarding blurb, it shouldn't fold away
    // on the 11th visit.
    window.localStorage.setItem(
      "sp.intros.v1",
      JSON.stringify({ home: { visits: 50, dismissed: false, pinned: false } }),
    );
    const page = homePage();
    expect(page.querySelector(".page-header")?.classList.contains("is-collapsed")).toBe(
      false,
    );
  });
});

describe("buildHomePage timeline", () => {
  it("renders `.home-page` with a timeline of dated sections", () => {
    const page = homePage({ noteSummaries: [summary({ id: "a", title: "Today note" })] });
    expect(page.className).toBe("home-page");
    const timeline = page.querySelector(".timeline");
    expect(timeline?.className).toBe("timeline");
    expect(timeline?.querySelector(".tl-divider")?.textContent).toBe("Today");
    expect(timeline?.querySelector(".tl-item")?.tagName).toBe("ARTICLE");
    expect(timeline?.querySelector(".tl-section")).not.toBeNull();
    const time = timeline?.querySelector(".tl-time");
    expect(time).not.toBeNull();
    // Local HH:MM of the note's updatedAt.
    expect(time?.textContent ?? "").toMatch(/^\d{2}:\d{2}$/u);
  });

  it("labels the yesterday and earlier buckets, and skips empty ones", () => {
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const older = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const page = homePage({
      noteSummaries: [
        summary({ id: "y", updatedAt: yesterday, createdAt: yesterday }),
        summary({ id: "o", updatedAt: older, createdAt: older }),
      ],
    });
    const dividers = [...page.querySelectorAll(".tl-divider")].map((d) => d.textContent);
    // No note lands in Today, so that section isn't rendered at all.
    expect(dividers).toEqual(["Yesterday", "Earlier"]);
  });

  it("renders no timeline at all for an empty notebook", () => {
    expect(homePage({ noteSummaries: [] }).querySelector(".timeline")).toBeNull();
  });

  it("opens the note when its card is clicked", () => {
    const onOpenNote = vi.fn();
    const page = homePage({ noteSummaries: [summary({ id: "a" })], onOpenNote });
    page.querySelector<HTMLButtonElement>(".tl-card")?.click();
    expect(onOpenNote).toHaveBeenCalledWith("a");
  });

  it("falls back to `Untitled note` for a blank card title", () => {
    const page = homePage({ noteSummaries: [summary({ id: "a", title: "   " })] });
    expect(page.querySelector(".tl-title")?.textContent).toBe("Untitled note");
  });

  it("caps the tag row at six pills and counts the overflow", () => {
    const tags = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const page = homePage({ noteSummaries: [summary({ id: "a", tags })] });
    const row = page.querySelector(".tl-tags");
    expect(row?.querySelectorAll(".tag-pill")).toHaveLength(6);
    expect(row?.querySelector(".tl-tag-more")?.textContent).toBe("+2");
  });

  it("omits the tag row and the overflow chip when they'd be empty", () => {
    const none = homePage({ noteSummaries: [summary({ id: "a", tags: [] })] });
    expect(none.querySelector(".tl-tags")).toBeNull();

    const exactly = homePage({
      noteSummaries: [summary({ id: "a", tags: ["a", "b", "c", "d", "e", "f"] })],
    });
    expect(exactly.querySelector(".tl-tags .tl-tag-more")).toBeNull();
  });

  it("decorates cards with a halved rotation and a single sticker when persona is on", () => {
    const doc = {
      id: "a",
      title: "Persona note",
      body: "text",
      urls: [],
      tags: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const page = homePage({
      noteSummaries: [summary({ id: "a", title: "Persona note" })],
      personaOptions: { allNotes: [doc], dark: false },
    });

    expect(page.querySelector(".timeline")?.classList.contains("timeline--persona")).toBe(
      true,
    );
    const card = page.querySelector<HTMLElement>(".tl-card");
    expect(card?.classList.contains("has-persona")).toBe(true);
    // 0.5× the persona's own tilt — the notes grid uses the full value.
    const rotation = Number.parseFloat(
      card?.style.getPropertyValue("--nc-rotation").replace("deg", "") ?? "0",
    );
    expect(Math.abs(rotation)).toBeLessThanOrEqual(0.4);
  });

  it("caps the sticker row at one chip even when the persona earned several", () => {
    // reading (url + "reading" tag) + to-go (open task) + night-owl (02:00) can
    // all fire for this fixture; the timeline shows one so a stacked column
    // stays calm, and the chip reuses the shared class so [data-sticker]
    // colour rules keep working.
    const night = "2026-08-17T02:00:00.000Z";
    const doc = {
      id: "a",
      title: "Night reading",
      body: "- [ ] finish https://example.com/article",
      urls: ["https://example.com/article"],
      tags: ["reading"],
      createdAt: night,
      updatedAt: night,
    };
    const page = homePage({
      noteSummaries: [
        summary({
          id: "a",
          title: "Night reading",
          tags: ["reading"],
          urls: ["https://example.com/article"],
          createdAt: night,
          updatedAt: night,
        }),
      ],
      taskIndex: taskIndexWith([task("a", false)]),
      personaOptions: { allNotes: [doc], dark: false },
    });

    const chips = page.querySelectorAll(".tl-card .tl-stickers .note-list-sticker");
    expect(chips).toHaveLength(1);
  });

  it("leaves cards undecorated when persona is off", () => {
    const page = homePage({ noteSummaries: [summary({ id: "a" })] });
    const card = page.querySelector<HTMLElement>(".tl-card");
    expect(card?.classList.contains("has-persona")).toBe(false);
    expect(page.querySelector(".tl-stickers")).toBeNull();
    expect(page.querySelector(".timeline")?.classList.contains("timeline--persona")).toBe(
      false,
    );
  });
});

describe("buildHomePage hint slot", () => {
  it("mounts the composed banner between the stats strip and the timeline", () => {
    const banner = document.createElement("div");
    banner.className = "hint-banner";
    const page = homePage({ hintBanner: banner });
    const children = [...page.children].map((child) => child.className);
    expect(children).toEqual([
      "page-header",
      "today-stats",
      "hint-banner",
      "timeline",
    ]);
  });

  it("renders no slot when the composer returned null", () => {
    const page = homePage({ hintBanner: null });
    expect(page.querySelector(".hint-banner")).toBeNull();
  });
});

describe("buildHomePage timeline — buckets, bare summaries, persona plumbing", () => {
  it("keeps a bucket that only has older notes", () => {
    // All three buckets are checked together before the timeline is skipped —
    // an over-eager guard would hide a notebook whose newest note is a week old.
    const older = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const page = homePage({
      noteSummaries: [summary({ id: "o", updatedAt: older, createdAt: older })],
    });
    expect(page.querySelector(".timeline")).not.toBeNull();
    expect(page.querySelector(".tl-divider")?.textContent).toBe("Earlier");
  });

  it("omits the tag row for a pre-Phase-2 summary with no tags field", () => {
    const bare: SutraPadNoteSummary = {
      id: "bare",
      title: "Bare",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const page = homePage({ noteSummaries: [bare] });
    expect(page.querySelector(".tl-tags")).toBeNull();
  });

  it("passes the dark flag through to the persona derivation", () => {
    // The options object carries allNotes / dark / hasOpenTask / autoTags —
    // dropping it would silently render every card on light paper.
    const doc = {
      id: "a",
      title: "Persona note",
      body: "text",
      urls: [],
      tags: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const summaries = [summary({ id: "a", title: "Persona note" })];

    const light = cardPaperBg(
      homePage({ noteSummaries: summaries, personaOptions: { allNotes: [doc], dark: false } }),
    );
    const dark = cardPaperBg(
      homePage({ noteSummaries: summaries, personaOptions: { allNotes: [doc], dark: true } }),
    );
    expect(light).not.toBe("");
    expect(dark).not.toBe(light);
  });

  it("derives the to-go sticker from the task index, counting open tasks only", () => {
    // `hasOpenTaskById` is built from `taskIndex` before the per-card persona
    // derivation; the to-go sticker is its only visible consequence here. The
    // fixture deliberately earns no higher-priority sticker: created three days
    // before it was last edited (so not "one-shot"), at noon (not "night owl"),
    // with no tags or urls (no reading / regular / first-of-kind).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const created = "2026-08-14T12:00:00.000Z";
    const updated = "2026-08-17T12:00:00.000Z";
    const doc = {
      id: "a",
      title: "Chores",
      body: "text",
      urls: [],
      tags: [],
      createdAt: created,
      updatedAt: updated,
    };
    const summaries = [
      summary({ id: "a", title: "Chores", createdAt: created, updatedAt: updated }),
    ];
    const personaOptions = { allNotes: [doc], dark: false };

    const withOpen = homePage({
      noteSummaries: summaries,
      taskIndex: taskIndexWith([task("a", false)]),
      personaOptions,
    });
    expect(withOpen.querySelector('[data-sticker="to-go"]')).not.toBeNull();

    const allDone = homePage({
      noteSummaries: summaries,
      taskIndex: taskIndexWith([task("a", true)]),
      personaOptions,
    });
    expect(allDone.querySelector('[data-sticker="to-go"]')).toBeNull();
    vi.useRealTimers();
  });
});
