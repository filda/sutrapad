// @vitest-environment happy-dom
//
// First focused test for `src/app/view/shared/hint-banner.ts`. The engine
// (`logic/hints.ts`) and the candidate list have their own suites; what was
// unmeasured is the layer that joins them to the DOM — and that layer owns two
// decisions that are easy to get subtly wrong:
//
//   - **the impression is recorded before `build` runs**, so a candidate whose
//     builder throws still rotates. Otherwise the same hint would win every
//     render until dismissed and the round-robin would be dead.
//   - **the CTA cools the hint down too**, not just the dismiss ×. Navigating
//     away counts as handling the hint; without this, coming straight back
//     re-surfaces the same banner in the window before the candidate's own
//     gate flips (the captured note hasn't landed, the merge isn't confirmed,
//     the one-thing pin isn't set).
//
// Both handlers re-load the store before writing, so a second tab's dismiss is
// not trampled — asserted here too.
//
// `composeHintBanner` takes its candidate list, clock and storage as options,
// so none of this needs the real registration order or `Date.now()`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { composeHintBanner, buildHomeHintContext } from "../src/app/view/shared/hint-banner";
import type { HintCandidate, HintContext, HintStore } from "../src/app/logic/hints";
import { addDismissedTagAlias } from "../src/app/logic/tag-aliases";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

const NOW = 1_800_000_000_000;
const STORAGE_KEY = "sp.hints.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

const note = (overrides: Partial<SutraPadDocument> = {}): SutraPadDocument => ({
  id: "n-1",
  title: "První",
  body: "tělo",
  urls: [],
  createdAt: "2026-04-21T08:00:00.000Z",
  updatedAt: "2026-04-21T08:00:00.000Z",
  tags: [],
  ...overrides,
});

const workspace = (notes: SutraPadDocument[] = [note()]): SutraPadWorkspace => ({
  notes,
  activeNoteId: notes[0]?.id ?? null,
});

/** A context with no live signals — candidates in these tests gate on nothing. */
function context(overrides: Partial<HintContext> = {}): HintContext {
  return {
    workspace: workspace(),
    profile: null,
    dismissedTagAliases: new Set<string>(),
    tasksOneThingKey: null,
    tagAliasSuggestions: [],
    openTaskCount: 0,
    hasEverCapturedExternally: false,
    callbacks: {} as HintContext["callbacks"],
    ...overrides,
  };
}

interface CandidateOverrides {
  id?: string;
  priority?: number;
  cooldownDays?: number;
  applicable?: boolean;
  onCta?: () => void;
  build?: HintCandidate["build"];
}

function candidate(overrides: CandidateOverrides = {}): HintCandidate {
  const id = overrides.id ?? "tip-one";
  return {
    id,
    priority: overrides.priority ?? 1,
    cooldownDays: overrides.cooldownDays ?? 7,
    isApplicable: () => overrides.applicable ?? true,
    build:
      overrides.build ??
      (() => ({
        eyebrow: "Tip",
        title: `Title for ${id}`,
        body: `Body for ${id}`,
        ctaLabel: "Do it",
        onCta: overrides.onCta ?? (() => {}),
      })),
  };
}

const readStore = (): HintStore => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");

function compose(candidates: readonly HintCandidate[], ctx = context(), now = NOW) {
  return composeHintBanner({ ctx, candidates, now, storage: localStorage });
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("composeHintBanner selection", () => {
  it("renders nothing when no candidate applies", () => {
    // The home page omits the slot entirely rather than printing a "Tip:"
    // header with nothing under it.
    expect(compose([candidate({ applicable: false })])).toBeNull();
  });

  it("renders nothing for an empty candidate list", () => {
    expect(compose([])).toBeNull();
  });

  it("records the impression so the rotation moves on", () => {
    compose([candidate({ id: "tip-one" })]);

    expect(readStore()["tip-one"]?.lastShownAt).toBe(NOW);
  });

  it("records the impression even when the builder throws", () => {
    // Otherwise the same hint wins every render until dismissed and the
    // round-robin never advances.
    const exploding = candidate({
      id: "tip-boom",
      build: () => {
        throw new Error("bad content");
      },
    });

    expect(() => compose([exploding])).toThrow("bad content");
    expect(readStore()["tip-boom"]?.lastShownAt).toBe(NOW);
  });

  it("skips a candidate still inside its cooldown", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "tip-one": { lastShownAt: NOW - DAY_MS, dismissedAt: NOW - DAY_MS } }),
    );

    expect(compose([candidate({ id: "tip-one", cooldownDays: 7 })])).toBeNull();
  });

  it("shows a candidate again once its cooldown has passed", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "tip-one": { lastShownAt: NOW - 8 * DAY_MS, dismissedAt: NOW - 8 * DAY_MS },
      }),
    );

    expect(compose([candidate({ id: "tip-one", cooldownDays: 7 })])).not.toBeNull();
  });

  it("stamps the chosen hint's id on the banner", () => {
    // The home-page test asserts "the right banner rendered" from this
    // attribute rather than by scraping visible copy.
    const banner = compose([candidate({ id: "tip-merge-tags" })]);

    expect(banner?.dataset.hintId).toBe("tip-merge-tags");
  });
});

describe("composeHintBanner markup", () => {
  it("renders an advisory note with accent, copy and actions", () => {
    const banner = compose([candidate()]);

    expect(banner?.tagName.toLowerCase()).toBe("section");
    expect(banner?.className).toBe("hint-banner");
    expect(banner?.getAttribute("role")).toBe("note");
    // Advisory, not urgent: announced at the next pause rather than
    // interrupting whatever the user is reading.
    expect(banner?.getAttribute("aria-live")).toBe("polite");
    expect(banner?.getAttribute("aria-label")).toBe("Hint");
    expect([...(banner?.children ?? [])].map((child) => child.className)).toEqual([
      "hint-banner-accent",
      "hint-banner-text",
      "hint-banner-actions",
    ]);
  });

  it("hides the accent strip from screen readers", () => {
    const banner = compose([candidate()]);

    expect(banner?.querySelector(".hint-banner-accent")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("lays the candidate's copy out as eyebrow, title, body", () => {
    const banner = compose([candidate({ id: "tip-two" })]);

    expect(
      [...(banner?.querySelector(".hint-banner-text")?.children ?? [])].map((child) => [
        child.className,
        child.textContent,
      ]),
    ).toEqual([
      ["hint-banner-eyebrow", "Tip"],
      ["hint-banner-title", "Title for tip-two"],
      ["hint-banner-body", "Body for tip-two"],
    ]);
  });

  it("labels the CTA with the candidate's own wording", () => {
    const banner = compose([candidate()]);
    const cta = banner?.querySelector<HTMLButtonElement>(".hint-banner-cta");

    expect(cta?.type).toBe("button");
    expect(cta?.textContent).toBe("Do it");
  });

  it("gives the dismiss × a name and a tooltip", () => {
    // "✕" alone tells a screen-reader user nothing, and the title explains
    // that dismissing is temporary rather than permanent.
    const banner = compose([candidate()]);
    const dismiss = banner?.querySelector<HTMLButtonElement>(".hint-banner-dismiss");

    expect(dismiss?.type).toBe("button");
    expect(dismiss?.textContent).toBe("✕");
    expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss hint");
    expect(dismiss?.title).toBe("Not now — hide for a while");
  });

  it("keeps the CTA before the dismiss", () => {
    const banner = compose([candidate()]);

    expect(
      [...(banner?.querySelector(".hint-banner-actions")?.children ?? [])].map(
        (child) => child.className,
      ),
    ).toEqual(["hint-banner-cta", "hint-banner-dismiss"]);
  });
});

describe("composeHintBanner handlers", () => {
  it("cools the hint down and runs the candidate's action on the CTA", () => {
    const onCta = vi.fn();
    const banner = compose([candidate({ id: "tip-one", onCta })]);
    document.body.append(banner as HTMLElement);

    banner?.querySelector<HTMLButtonElement>(".hint-banner-cta")?.click();

    expect(onCta).toHaveBeenCalledOnce();
    // Cooldown first, so a quick "back" press doesn't re-surface the hint in
    // the window before the candidate's own gate flips.
    expect(readStore()["tip-one"]?.dismissedAt).toBe(NOW);
  });

  it("leaves the banner mounted after the CTA", () => {
    // The CTA navigates; tearing the banner out first would flash the layout
    // before the route change lands.
    const banner = compose([candidate()]);
    document.body.append(banner as HTMLElement);

    banner?.querySelector<HTMLButtonElement>(".hint-banner-cta")?.click();

    expect(banner?.isConnected).toBe(true);
  });

  it("cools the hint down and removes the banner on dismiss", () => {
    const banner = compose([candidate({ id: "tip-one" })]);
    document.body.append(banner as HTMLElement);

    banner?.querySelector<HTMLButtonElement>(".hint-banner-dismiss")?.click();

    expect(readStore()["tip-one"]?.dismissedAt).toBe(NOW);
    expect(banner?.isConnected).toBe(false);
  });

  it("re-reads the store before writing so another tab is not trampled", () => {
    const banner = compose([candidate({ id: "tip-one" })]);
    const store = readStore();
    store["tip-other"] = { lastShownAt: 123, dismissedAt: 456 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));

    banner?.querySelector<HTMLButtonElement>(".hint-banner-dismiss")?.click();

    expect(readStore()["tip-other"]).toEqual({ lastShownAt: 123, dismissedAt: 456 });
    expect(readStore()["tip-one"]?.dismissedAt).toBe(NOW);
  });

  it("keeps the dismissed hint out of the next render", () => {
    const candidates = [candidate({ id: "tip-one", cooldownDays: 7 })];
    const banner = compose(candidates);
    banner?.querySelector<HTMLButtonElement>(".hint-banner-dismiss")?.click();

    expect(compose(candidates, context(), NOW + DAY_MS)).toBeNull();
  });
});

describe("buildHomeHintContext", () => {
  it("tallies open tasks across the workspace", () => {
    const ctx = buildHomeHintContext({
      workspace: workspace([
        note({ id: "n-1", body: "- [ ] jedna\n- [x] dva" }),
        note({ id: "n-2", body: "- [ ] tri" }),
      ]),
      profile: null,
      dismissedTagAliases: new Set(),
      tasksOneThingKey: null,
      callbacks: {} as HintContext["callbacks"],
    });

    // Two open, one done — the done one must not inflate the count.
    expect(ctx.openTaskCount).toBe(2);
  });

  it("notices that the user has captured from outside the app", () => {
    const captured = buildHomeHintContext({
      workspace: workspace([
        note({ id: "n-1", captureContext: { source: "url-capture" } }),
      ]),
      profile: null,
      dismissedTagAliases: new Set(),
      tasksOneThingKey: null,
      callbacks: {} as HintContext["callbacks"],
    });

    expect(captured.hasEverCapturedExternally).toBe(true);
  });

  it("counts a text capture as external too", () => {
    const ctx = buildHomeHintContext({
      workspace: workspace([
        note({ id: "n-1", captureContext: { source: "text-capture" } }),
      ]),
      profile: null,
      dismissedTagAliases: new Set(),
      tasksOneThingKey: null,
      callbacks: {} as HintContext["callbacks"],
    });

    expect(ctx.hasEverCapturedExternally).toBe(true);
  });

  it("needs only one external capture in a notebook full of in-app notes", () => {
    // "Ever captured" is a one-way latch over the whole notebook, not a
    // property every note has to share: a single bookmarklet save from two
    // years ago is enough to retire the setup hint. A mixed workspace is the
    // only fixture that tells the two readings apart — with one note they
    // agree.
    const ctx = buildHomeHintContext({
      workspace: workspace([
        note({ id: "n-1", captureContext: { source: "new-note" } }),
        note({ id: "n-2", captureContext: { source: "url-capture" } }),
        note({ id: "n-3" }),
      ]),
      profile: null,
      dismissedTagAliases: new Set(),
      tasksOneThingKey: null,
      callbacks: {} as HintContext["callbacks"],
    });

    expect(ctx.hasEverCapturedExternally).toBe(true);
  });

  it("does not count an in-app note as an external capture", () => {
    // The bookmarklet-setup hint gates on this; a false positive hides the
    // hint from exactly the users who need it.
    const ctx = buildHomeHintContext({
      workspace: workspace([note({ id: "n-1", captureContext: { source: "new-note" } })]),
      profile: null,
      dismissedTagAliases: new Set(),
      tasksOneThingKey: null,
      callbacks: {} as HintContext["callbacks"],
    });

    expect(ctx.hasEverCapturedExternally).toBe(false);
  });

  it("passes the caller's signals straight through", () => {
    const profile = { name: "Filip", email: "f@example.com", picture: "" };
    const dismissed = new Set(["praha|prague"]);
    const ctx = buildHomeHintContext({
      workspace: workspace(),
      profile,
      dismissedTagAliases: dismissed,
      tasksOneThingKey: "n-1:2",
      callbacks: {} as HintContext["callbacks"],
    });

    expect(ctx.profile).toBe(profile);
    expect(ctx.dismissedTagAliases).toBe(dismissed);
    expect(ctx.tasksOneThingKey).toBe("n-1:2");
  });

  // `suggestTagAliases` only considers user tags used at least twice, so each
  // spelling needs two notes before the pair is even a candidate.
  const NEAR_DUPLICATE_TAGS = [
    note({ id: "n-1", tags: ["praha"] }),
    note({ id: "n-2", tags: ["praha"] }),
    note({ id: "n-3", tags: ["Praha"] }),
    note({ id: "n-4", tags: ["Praha"] }),
  ];

  it("derives alias suggestions from the workspace's own tags", () => {
    const ctx = buildHomeHintContext({
      workspace: workspace(NEAR_DUPLICATE_TAGS),
      profile: null,
      dismissedTagAliases: new Set(),
      tasksOneThingKey: null,
      callbacks: {} as HintContext["callbacks"],
    });

    expect(ctx.tagAliasSuggestions.length).toBeGreaterThan(0);
  });

  it("honours the dismissed-alias set when suggesting merges", () => {
    // The merge-tags hint gates on this list; a dismissed pair that keeps
    // coming back is the app nagging about a decision the user already made.
    const withoutDismissals = buildHomeHintContext({
      workspace: workspace(NEAR_DUPLICATE_TAGS),
      profile: null,
      dismissedTagAliases: new Set(),
      tasksOneThingKey: null,
      callbacks: {} as HintContext["callbacks"],
    }).tagAliasSuggestions;
    expect(withoutDismissals).toEqual([
      {
        canonical: "praha",
        aliases: ["Praha"],
        reason: "Same spelling after case and diacritics",
      },
    ]);

    const withDismissal = buildHomeHintContext({
      workspace: workspace(NEAR_DUPLICATE_TAGS),
      profile: null,
      // Built with the same helper the Settings "Keep separate" button uses,
      // so the key format cannot drift out from under the test.
      dismissedTagAliases: addDismissedTagAlias(new Set(), "praha", "Praha"),
      tasksOneThingKey: null,
      callbacks: {} as HintContext["callbacks"],
    }).tagAliasSuggestions;

    expect(withDismissal).toEqual([]);
  });
});
