import { describe, expect, it } from "vitest";
import {
  DEFAULT_HINT_CANDIDATES,
  HINT_INSTALL_CAPTURE,
  HINT_ONE_THING,
  HINT_TAG_MERGE,
} from "../src/app/logic/hint-candidates";
import type { HintCandidate, HintContext } from "../src/app/logic/hints";
import type { SutraPadWorkspace, UserProfile } from "../src/types";

/**
 * The candidates are pure functions of {@link HintContext}; tests build a
 * realistic context skeleton and flip individual fields to exercise each
 * gate. Defaults are intentionally minimal — every field is required by
 * the type, so an inadvertent context-shape drift surfaces as a TS error
 * here rather than a runtime undefined-read at the home page.
 */
function ctx(overrides: Partial<HintContext> = {}): HintContext {
  return {
    workspace: { notes: [] } as unknown as SutraPadWorkspace,
    profile: null,
    dismissedTagAliases: new Set(),
    tasksOneThingKey: null,
    tagAliasSuggestions: [],
    openTaskCount: 0,
    hasEverCapturedExternally: false,
    callbacks: {
      openCapture: () => {},
      openSettings: () => {},
      openTasks: () => {},
    },
    ...overrides,
  };
}

const profile: UserProfile = { name: "Filip", email: "filip@example.com" };

function findCandidate(id: string): HintCandidate {
  const c = DEFAULT_HINT_CANDIDATES.find((cand) => cand.id === id);
  if (!c) throw new Error(`Candidate ${id} not registered`);
  return c;
}

describe("DEFAULT_HINT_CANDIDATES registration", () => {
  it("registers exactly three candidates", () => {
    // A guard against a candidate being silently lost during a refactor —
    // the engine doesn't care about the count, but the home banner only
    // works because these three are wired in render-app.
    expect(DEFAULT_HINT_CANDIDATES).toHaveLength(3);
  });

  it("registers each known id exactly once", () => {
    const ids = DEFAULT_HINT_CANDIDATES.map((c) => c.id);
    expect(new Set(ids)).toEqual(
      new Set([HINT_INSTALL_CAPTURE, HINT_TAG_MERGE, HINT_ONE_THING]),
    );
    expect(ids).toHaveLength(new Set(ids).size); // no duplicates
  });

  it("install-capture outranks the periodic nudges", () => {
    // Priority ordering is contract: the install bumper should always
    // win against tag-merge / one-thing when both apply on the same
    // visit, so a fresh user sees onboarding first.
    const install = findCandidate(HINT_INSTALL_CAPTURE);
    const merge = findCandidate(HINT_TAG_MERGE);
    const one = findCandidate(HINT_ONE_THING);
    expect(install.priority).toBeGreaterThan(merge.priority);
    expect(install.priority).toBeGreaterThan(one.priority);
  });

  it("tag-merge and one-thing share a priority tier so they rotate", () => {
    expect(findCandidate(HINT_TAG_MERGE).priority).toBe(
      findCandidate(HINT_ONE_THING).priority,
    );
  });

  it("cooldowns scale with hint frequency (daily < weekly < monthly)", () => {
    const install = findCandidate(HINT_INSTALL_CAPTURE).cooldownDays;
    const merge = findCandidate(HINT_TAG_MERGE).cooldownDays;
    const one = findCandidate(HINT_ONE_THING).cooldownDays;
    expect(one).toBeLessThan(merge);
    expect(merge).toBeLessThan(install);
  });
});

describe("install-capture candidate", () => {
  const install = findCandidate(HINT_INSTALL_CAPTURE);

  it("does not apply to a signed-out user", () => {
    expect(install.isApplicable(ctx({ profile: null }))).toBe(false);
  });

  it("does not apply when the user has already captured externally", () => {
    expect(
      install.isApplicable(
        ctx({ profile, hasEverCapturedExternally: true }),
      ),
    ).toBe(false);
  });

  it("applies to a signed-in user with no external captures yet", () => {
    expect(
      install.isApplicable(
        ctx({ profile, hasEverCapturedExternally: false }),
      ),
    ).toBe(true);
  });

  it("builds content with the install eyebrow + capture CTA", () => {
    const content = install.build(ctx({ profile }));
    expect(content.eyebrow.toLowerCase()).toContain("capture");
    expect(content.ctaLabel.toLowerCase()).toContain("capture");
    // Body should mention both desktop + mobile entry points so the user
    // knows the CTA covers both surfaces, not just one.
    expect(content.body.toLowerCase()).toContain("browser");
    expect(content.body.toLowerCase()).toContain("ios");
  });

  it("CTA invokes the openCapture callback", () => {
    let opened = 0;
    const c = ctx({
      profile,
      callbacks: {
        openCapture: () => {
          opened += 1;
        },
        openSettings: () => {},
        openTasks: () => {},
      },
    });
    install.build(c).onCta();
    expect(opened).toBe(1);
  });
});

describe("tag-merge candidate", () => {
  const merge = findCandidate(HINT_TAG_MERGE);

  it("does not apply when the suggestion list is empty", () => {
    expect(merge.isApplicable(ctx({ tagAliasSuggestions: [] }))).toBe(false);
  });

  it("applies whenever there's at least one suggestion", () => {
    expect(
      merge.isApplicable(
        ctx({
          tagAliasSuggestions: [
            { canonical: "žižkov", aliases: ["zizkov"], reason: "fuzzy" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("uses singular phrasing for one cluster", () => {
    const content = merge.build(
      ctx({
        tagAliasSuggestions: [
          { canonical: "žižkov", aliases: ["zizkov"], reason: "fuzzy" },
        ],
      }),
    );
    expect(content.title.toLowerCase()).toContain("two tags");
    // The body's noun is also singular and an actual word — guards
    // against the singular/plural ternary collapsing into a constant
    // value or an empty string.
    expect(content.body).toContain("the duplicate ");
    expect(content.body).not.toContain("duplicates");
  });

  it("uses plural phrasing with a count for multiple clusters", () => {
    const content = merge.build(
      ctx({
        tagAliasSuggestions: [
          { canonical: "a", aliases: ["b"], reason: "fuzzy" },
          { canonical: "c", aliases: ["d"], reason: "fuzzy" },
          { canonical: "e", aliases: ["f"], reason: "fuzzy" },
        ],
      }),
    );
    expect(content.title).toContain("3");
    expect(content.title.toLowerCase()).toContain("pairs");
    // Plural noun must be both an actual word and the plural form —
    // pairs the body assertion symmetrically with the singular case.
    expect(content.body).toContain("the duplicates ");
  });

  it("CTA invokes the openSettings callback", () => {
    let opened = 0;
    const c = ctx({
      tagAliasSuggestions: [
        { canonical: "a", aliases: ["b"], reason: "fuzzy" },
      ],
      callbacks: {
        openCapture: () => {},
        openSettings: () => {
          opened += 1;
        },
        openTasks: () => {},
      },
    });
    merge.build(c).onCta();
    expect(opened).toBe(1);
  });
});

describe("one-thing candidate", () => {
  const one = findCandidate(HINT_ONE_THING);

  it("does not apply when a one-thing key is already pinned", () => {
    expect(
      one.isApplicable(
        ctx({ tasksOneThingKey: "abc::1", openTaskCount: 10 }),
      ),
    ).toBe(false);
  });

  it("does not apply with fewer than three open tasks (soft threshold)", () => {
    // Two tasks is "I already know what's next" — the pin doesn't earn
    // its keep at this scale.
    expect(
      one.isApplicable(ctx({ tasksOneThingKey: null, openTaskCount: 2 })),
    ).toBe(false);
  });

  it("applies at exactly three open tasks (the threshold is inclusive)", () => {
    expect(
      one.isApplicable(ctx({ tasksOneThingKey: null, openTaskCount: 3 })),
    ).toBe(true);
  });

  it("applies with many more open tasks", () => {
    expect(
      one.isApplicable(ctx({ tasksOneThingKey: null, openTaskCount: 27 })),
    ).toBe(true);
  });

  it("includes the actual open task count in the body for context", () => {
    const content = one.build(
      ctx({ tasksOneThingKey: null, openTaskCount: 7 }),
    );
    expect(content.body).toContain("7");
  });

  it("CTA invokes the openTasks callback", () => {
    let opened = 0;
    const c = ctx({
      tasksOneThingKey: null,
      openTaskCount: 5,
      callbacks: {
        openCapture: () => {},
        openSettings: () => {},
        openTasks: () => {
          opened += 1;
        },
      },
    });
    one.build(c).onCta();
    expect(opened).toBe(1);
  });
});

describe("HINT_ID constants stay stable for dismiss memory", () => {
  it("install-capture keeps its v1 id string", () => {
    // Hard-coded so a typo-rename shows up here as a test failure rather
    // than silently wiping every existing user's dismiss state.
    expect(HINT_INSTALL_CAPTURE).toBe("install-capture");
  });

  it("tag-merge keeps its v1 id string", () => {
    expect(HINT_TAG_MERGE).toBe("tag-merge");
  });

  it("one-thing keeps its v1 id string", () => {
    expect(HINT_ONE_THING).toBe("one-thing");
  });
});

// Belt-and-braces: assert the build outputs are well-formed (non-empty
// strings) for the gates above. Empty title / body / CTA-label would
// pass typecheck but render an awkward banner; trip these here.
describe("hint content shape", () => {
  function ensureNonEmpty(content: ReturnType<HintCandidate["build"]>): void {
    expect(content.eyebrow).not.toBe("");
    expect(content.title).not.toBe("");
    expect(content.body).not.toBe("");
    expect(content.ctaLabel).not.toBe("");
  }

  it("install-capture produces non-empty content", () => {
    ensureNonEmpty(findCandidate(HINT_INSTALL_CAPTURE).build(ctx({ profile })));
  });

  it("tag-merge produces non-empty content (singular case)", () => {
    ensureNonEmpty(
      findCandidate(HINT_TAG_MERGE).build(
        ctx({
          tagAliasSuggestions: [
            { canonical: "a", aliases: ["b"], reason: "fuzzy" },
          ],
        }),
      ),
    );
  });

  it("tag-merge produces non-empty content (plural case)", () => {
    ensureNonEmpty(
      findCandidate(HINT_TAG_MERGE).build(
        ctx({
          tagAliasSuggestions: [
            { canonical: "a", aliases: ["b"], reason: "fuzzy" },
            { canonical: "c", aliases: ["d"], reason: "fuzzy" },
          ],
        }),
      ),
    );
  });

  it("one-thing produces non-empty content", () => {
    ensureNonEmpty(
      findCandidate(HINT_ONE_THING).build(
        ctx({ tasksOneThingKey: null, openTaskCount: 5 }),
      ),
    );
  });
});

