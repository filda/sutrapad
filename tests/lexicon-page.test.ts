// @vitest-environment happy-dom
//
// DOM regression tests for the Topic Lexicon Builder page.
//
// The headline test here is `preserves the target input across a Drive
// autosave settling` — Filip hit a bug where typing into the target
// field would suddenly lose characters whenever the typeahead was
// surfacing suggestions. The root cause turned out to be the page's
// rerender granularity: every change to `pageState.saveStatus` was
// triggering a full `body.replaceChildren(...)`, which recreated the
// candidate card and its `<input>` element. The fix narrows
// save-status-only transitions to an in-place pill update and leaves
// the candidate card intact. This suite pins that behaviour.
//
// Each test resets the page module via `vi.resetModules()` because the
// page keeps `pageState` and `renderHandle` at module scope.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { BuilderState } from "../src/app/logic/lexicon/types";
import type { MenuItemId } from "../src/app/logic/menu";
import type { LexiconStore } from "../src/services/drive/lexicon-store";
import type { UserProfile } from "../src/types";

interface DeferredSave {
  readonly promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function deferred(): DeferredSave {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeBuilder(): BuilderState {
  // Two waiting candidates so the post-Map rerender still has a target
  // input (the typeahead-erase bug only manifests while the user is
  // typing into the *next* candidate's input). One existing target
  // makes the typeahead non-empty.
  return {
    version: 1,
    forms: { praha: "praha" },
    rejectedForms: [],
    candidates: {
      praze: { count: 4, contexts: ["… potkal jsem v praze …"] },
      psovi: { count: 2, contexts: ["… dal psovi misku …"] },
    },
  };
}

const PROFILE: UserProfile = {
  name: "Filip",
  email: "filip@example.test",
};

let loadStateMock: Mock = vi.fn();
let saveMock: Mock = vi.fn();

// The page receives a ready-built `LexiconStore` (see hardening item 10), so
// the test just hands it one that delegates to the per-test mocks above —
// no module mock of the concrete Drive store needed.
function makeStoreMock(): LexiconStore {
  return {
    loadState: () => loadStateMock(),
    saveStateAndRuntime: (...args: unknown[]) => saveMock(...args),
  } as LexiconStore;
}

// happy-dom auto-fetches `<img src=…>` URLs. The page itself doesn't
// embed images, but stubbing keeps stderr quiet if anything sneaks in
// via dependency code (parity with the other view-page suites).
beforeEach(() => {
  vi.resetModules();
  loadStateMock = vi.fn();
  saveMock = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountPage(builder: BuilderState): Promise<{ page: HTMLElement }> {
  // Resolve loadState immediately with the supplied builder so we land
  // on the candidate card without having to render the loading
  // placeholder away in every test.
  loadStateMock.mockResolvedValue(builder);
  const { buildLexiconPage } = await import("../src/app/view/pages/lexicon-page");
  const page = buildLexiconPage({
    profile: PROFILE,
    getLexiconStore: () => makeStoreMock(),
    onSignIn: vi.fn(),
    onSelectMenuItem: vi.fn(),
  });
  document.body.append(page);
  // Two microtask flushes cover `loadFromDrive` resolving plus the
  // `queueMicrotask(targetInput.focus)` in the candidate card.
  await flushMicrotasks();
  await flushMicrotasks();
  return { page };
}

async function flushMicrotasks(): Promise<void> {
  // Two passes covers `Promise.resolve()` → handler → another
  // `Promise.resolve()` chains the page sets up around save scheduling.
  await Promise.resolve();
  await Promise.resolve();
}

function getTargetInput(page: HTMLElement): HTMLInputElement {
  const input = page.querySelector<HTMLInputElement>(".lexicon-target-input");
  if (!input) throw new Error("target input not found");
  return input;
}

function getSaveStatusEl(page: HTMLElement): HTMLElement {
  const el = page.querySelector<HTMLElement>(".lexicon-save-status");
  if (!el) throw new Error("save-status strip not found");
  return el;
}

describe("buildLexiconPage save-status rerender granularity", () => {
  it("preserves the target input element identity across a Drive autosave settling", async () => {
    const save = deferred();
    saveMock.mockReturnValue(save.promise);

    const { page } = await mountPage(makeBuilder());

    // Click Map with an empty target to trigger `acceptExact` — this
    // mutates the builder and kicks off `scheduleSave`. The new
    // candidate card is mounted with a fresh input; we grab that one
    // and assert its identity survives the subsequent save settle.
    const mapButton = page.querySelector<HTMLButtonElement>(".lexicon-action-map");
    if (!mapButton) throw new Error("map button not found");
    mapButton.click();
    await flushMicrotasks();

    const inputAfterMap = getTargetInput(page);
    // Simulate user typing into the just-mounted input while the
    // autosave is still in flight.
    inputAfterMap.value = "psy";
    inputAfterMap.dispatchEvent(new Event("input", { bubbles: true }));

    // Save resolves — under the old code this would trigger a full
    // body rebuild, replacing `inputAfterMap` with a fresh empty input.
    save.resolve();
    await flushMicrotasks();
    await flushMicrotasks();

    const inputAfterSave = getTargetInput(page);
    expect(inputAfterSave).toBe(inputAfterMap);
    expect(inputAfterSave.value).toBe("psy");
  });

  it("flips the save-status pill text in place from 'Saving…' to the idle copy", async () => {
    const save = deferred();
    saveMock.mockReturnValue(save.promise);

    const { page } = await mountPage(makeBuilder());

    const mapButton = page.querySelector<HTMLButtonElement>(".lexicon-action-map");
    if (!mapButton) throw new Error("map button not found");
    mapButton.click();
    await flushMicrotasks();

    const pillDuringSave = getSaveStatusEl(page);
    expect(pillDuringSave.textContent).toBe("Saving to Drive…");
    expect(pillDuringSave.className).toContain("lexicon-save-saving");

    save.resolve();
    await flushMicrotasks();
    await flushMicrotasks();

    const pillAfterSave = getSaveStatusEl(page);
    // Same element (in-place mutation), not a re-rendered replacement.
    expect(pillAfterSave).toBe(pillDuringSave);
    expect(pillAfterSave.textContent).toBe("Autosaves to Drive after every decision.");
    expect(pillAfterSave.className).toContain("lexicon-save-idle");
  });

  it("surfaces the save-failure copy in place when the Drive save rejects", async () => {
    const save = deferred();
    saveMock.mockReturnValue(save.promise);

    const { page } = await mountPage(makeBuilder());

    const mapButton = page.querySelector<HTMLButtonElement>(".lexicon-action-map");
    if (!mapButton) throw new Error("map button not found");
    mapButton.click();
    await flushMicrotasks();

    const pillDuringSave = getSaveStatusEl(page);
    save.reject(new Error("403 unauthorized"));
    await flushMicrotasks();
    await flushMicrotasks();

    const pillAfterError = getSaveStatusEl(page);
    expect(pillAfterError).toBe(pillDuringSave);
    expect(pillAfterError.className).toContain("lexicon-save-error");
    expect(pillAfterError.textContent).toContain("403 unauthorized");
  });

});

/** Builds the page with whatever store/profile the test needs, no auto-flush. */
async function buildPage(overrides: {
  profile?: UserProfile | null;
  store?: LexiconStore | null;
  onSignIn?: () => void;
  onSelectMenuItem?: (id: MenuItemId) => void;
}): Promise<HTMLElement> {
  const { buildLexiconPage } = await import("../src/app/view/pages/lexicon-page");
  const page = buildLexiconPage({
    profile: overrides.profile === undefined ? PROFILE : overrides.profile,
    getLexiconStore: () =>
      overrides.store === undefined ? makeStoreMock() : overrides.store,
    onSignIn: overrides.onSignIn ?? vi.fn(),
    onSelectMenuItem: overrides.onSelectMenuItem ?? vi.fn(),
  });
  document.body.append(page);
  return page;
}

function builderWithTargets(): BuilderState {
  return {
    version: 1,
    forms: {
      praha: "praha",
      praze: "praha",
      brno: "brno",
      brne: "brno",
      plzen: "plzen",
    },
    rejectedForms: [],
    candidates: {
      psovi: { count: 2, contexts: ["… dal psovi misku …"] },
    },
  };
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressKey(input: HTMLInputElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

function suggestionItems(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>(".lexicon-typeahead-item")];
}

describe("buildLexiconPage shell", () => {
  it("renders the workbench header and routes the back link to Settings", async () => {
    const onSelectMenuItem = vi.fn();
    loadStateMock.mockResolvedValue(makeBuilder());
    const page = await buildPage({ onSelectMenuItem });
    await flushMicrotasks();

    expect(page.className).toBe("lexicon-page");
    const header = page.querySelector(".lexicon-header");
    expect(header?.querySelector(".panel-eyebrow")?.textContent).toBe(
      "Workbench · Internal",
    );
    expect(header?.querySelector("h1")?.textContent).toBe("Topic Lexicon Builder");
    expect(header?.querySelector(".lexicon-subtitle")?.textContent).toContain(
      "Curate Czech word forms into canonical topic tags.",
    );

    const back = header?.querySelector<HTMLButtonElement>(".lexicon-back");
    expect(back?.className).toBe("is-link lexicon-back");
    expect(back?.textContent).toBe("← Back to Settings");
    back?.click();
    expect(onSelectMenuItem).toHaveBeenCalledWith("settings");
  });

  it("shows the sign-in card instead of a body when signed out", async () => {
    const onSignIn = vi.fn();
    const page = await buildPage({ profile: null, onSignIn });

    const card = page.querySelector(".lexicon-signin-card");
    expect(card?.className).toBe("lexicon-card lexicon-signin-card");
    expect(card?.querySelector("h2")?.textContent).toBe("Sign in to use the workbench");
    expect(card?.querySelector("p")?.textContent).toContain(
      "The builder reads and writes its working state to your Google Drive.",
    );
    expect(page.querySelector(".lexicon-body")).toBeNull();
    // Signed out means no Drive round-trip either.
    expect(loadStateMock).not.toHaveBeenCalled();

    const button = card?.querySelector<HTMLButtonElement>("button");
    expect(button?.className).toBe("button button-primary");
    expect(button?.textContent).toBe("Sign in with Google");
    button?.click();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});

describe("buildLexiconPage load states", () => {
  it("shows the placeholder card while the Drive load is in flight", async () => {
    loadStateMock.mockReturnValue(
      new Promise<BuilderState>(() => {
        /* never settles — the page stays on the loading placeholder */
      }),
    );
    const page = await buildPage({});
    await flushMicrotasks();

    const card = page.querySelector(".lexicon-placeholder-card");
    expect(card?.className).toBe("lexicon-card lexicon-placeholder-card");
    expect(card?.querySelector("p")?.textContent).toBe("Loading lexicon from Drive…");
    expect(page.querySelector(".lexicon-candidate-card")).toBeNull();
  });

  it("surfaces a failed load with the Drive message and retries on demand", async () => {
    loadStateMock.mockRejectedValueOnce(new Error("403 unauthorized"));
    const page = await buildPage({});
    await flushMicrotasks();
    await flushMicrotasks();

    const card = page.querySelector(".lexicon-error-card");
    expect(card?.className).toBe("lexicon-card lexicon-error-card");
    expect(card?.querySelector("p")?.textContent).toBe(
      "Couldn't load builder state: 403 unauthorized",
    );

    // Retry re-runs the load; this time Drive answers.
    loadStateMock.mockResolvedValue(makeBuilder());
    const retry = [
      ...(card?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].find((button) => button.textContent === "Retry");
    expect(retry?.className).toBe("button");
    retry?.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(page.querySelector(".lexicon-error-card")).toBeNull();
    expect(page.querySelector(".lexicon-candidate-card")).not.toBeNull();
  });

  it("reports a signed-in user with no store as a load error", async () => {
    // The store is built from an access token; a signed-in profile with a
    // rejected token yields null here.
    const page = await buildPage({ store: null });
    await flushMicrotasks();

    expect(page.querySelector(".lexicon-error-card p")?.textContent).toBe(
      "Couldn't load builder state: Not signed in.",
    );
  });
});

describe("buildLexiconPage candidate card", () => {
  it("shows the candidate word, its occurrence count and every context line", async () => {
    const { page } = await mountPage(makeBuilder());

    const card = page.querySelector(".lexicon-candidate-card");
    expect(card?.querySelector("h2")?.textContent).toBe("Current candidate");
    expect(card?.querySelector(".lexicon-candidate-word")?.textContent).toBe("praze");
    expect(card?.querySelector(".lexicon-candidate-count")?.textContent).toBe(
      "4 occurrences",
    );
    expect(
      [...(card?.querySelectorAll(".lexicon-candidate-context") ?? [])].map(
        (el) => el.textContent,
      ),
    ).toEqual(["… potkal jsem v praze …"]);
  });

  it("uses the singular for a one-occurrence candidate", async () => {
    const { page } = await mountPage({
      version: 1,
      forms: {},
      rejectedForms: [],
      candidates: { psovi: { count: 1, contexts: [] } },
    });
    expect(page.querySelector(".lexicon-candidate-count")?.textContent).toBe(
      "1 occurrence",
    );
  });

  it("labels the target input and hints the self-map default", async () => {
    const { page } = await mountPage(makeBuilder());
    expect(page.querySelector(".lexicon-target-label")?.textContent).toContain(
      "Target tag",
    );
    const input = getTargetInput(page);
    expect(input.placeholder).toBe("e.g. praha — leave empty for praze → praze");
    expect(input.autocomplete).toBe("off");
    expect(input.spellcheck).toBe(false);
  });

  it("maps the form to a normalized target and counts it as mapped", async () => {
    saveMock.mockResolvedValue(undefined);
    const { page } = await mountPage(makeBuilder());

    typeInto(getTargetInput(page), "  PRAHA  ");
    page.querySelector<HTMLButtonElement>(".lexicon-action-map")?.click();
    await flushMicrotasks();

    // praha was already mapped, praze joins it → 2 mapped, 1 waiting.
    expect(page.querySelector(".lexicon-progress-strip")?.textContent).toBe(
      "Mapped 2 · Rejected 0 · Waiting 1",
    );
    const saved = saveMock.mock.calls[0][0] as BuilderState;
    expect(saved.forms.praze).toBe("praha");
  });

  it("rejects a form and moves on to the next candidate", async () => {
    saveMock.mockResolvedValue(undefined);
    const { page } = await mountPage(makeBuilder());

    const reject = page.querySelector<HTMLButtonElement>(".lexicon-action-reject");
    expect(reject?.textContent).toBe("Reject");
    reject?.click();
    await flushMicrotasks();

    expect(page.querySelector(".lexicon-candidate-word")?.textContent).toBe("psovi");
    expect(page.querySelector(".lexicon-progress-strip")?.textContent).toBe(
      "Mapped 1 · Rejected 1 · Waiting 1",
    );
  });

  it("skips a candidate for this session without touching Drive", async () => {
    const { page } = await mountPage(makeBuilder());

    const skip = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Skip",
    );
    expect(skip?.className).toBe("button is-ghost");
    skip?.click();
    await flushMicrotasks();

    expect(page.querySelector(".lexicon-candidate-word")?.textContent).toBe("psovi");
    // Skipping is session-local: nothing was persisted, and the skipped form
    // no longer counts as waiting.
    expect(saveMock).not.toHaveBeenCalled();
    expect(page.querySelector(".lexicon-progress-strip")?.textContent).toBe(
      "Mapped 1 · Rejected 0 · Waiting 1",
    );
  });

  it("commits on Enter in the target input", async () => {
    saveMock.mockResolvedValue(undefined);
    const { page } = await mountPage(makeBuilder());

    const input = getTargetInput(page);
    typeInto(input, "zzz-unmatched");
    const event = pressKey(input, "Enter");
    await flushMicrotasks();

    expect(event.defaultPrevented).toBe(true);
    const saved = saveMock.mock.calls[0][0] as BuilderState;
    expect(saved.forms.praze).toBe("zzz-unmatched");
  });

  it("explains the empty states differently for a blank and a worked-through builder", async () => {
    const blank = await mountPage({
      version: 1,
      forms: {},
      rejectedForms: [],
      candidates: {},
    });
    expect(blank.page.querySelector(".lexicon-empty-note")?.textContent).toBe(
      "Import text above to start building the lexicon.",
    );

    vi.resetModules();
    const worked = await mountPage({
      version: 1,
      forms: { praha: "praha" },
      rejectedForms: [],
      candidates: {},
    });
    expect(worked.page.querySelector(".lexicon-empty-note")?.textContent).toBe(
      "No candidates waiting. Import more text to find new forms.",
    );
  });
});

describe("buildLexiconPage import card", () => {
  it("renders the paste + upload affordances", async () => {
    const { page } = await mountPage(makeBuilder());
    const card = page.querySelector(".lexicon-import-card");
    expect(card?.className).toBe("lexicon-card lexicon-import-card");
    expect(card?.querySelector("h2")?.textContent).toBe("Import text");
    expect(card?.querySelector(".lexicon-card-hint")?.textContent).toContain(
      "Paste Czech text or upload a small text file.",
    );

    const label = card?.querySelector(".lexicon-file-label");
    expect(label?.textContent).toContain("Upload .txt file: ");
    const file = card?.querySelector<HTMLInputElement>(".lexicon-file-input");
    expect(file?.type).toBe("file");
    expect(file?.accept).toBe(".txt,text/plain");

    const textarea = card?.querySelector<HTMLTextAreaElement>(".lexicon-textarea");
    expect(textarea?.placeholder).toBe("Paste text here…");
    // happy-dom reflects `rows` as the attribute string.
    expect(textarea?.getAttribute("rows")).toBe("6");

    const button = card?.querySelector<HTMLButtonElement>(".lexicon-import-button");
    expect(button?.className).toBe("button button-primary lexicon-import-button");
    expect(button?.textContent).toBe("Import");
  });

  it("imports pasted text, clears the textarea and surfaces new candidates", async () => {
    saveMock.mockResolvedValue(undefined);
    const { page } = await mountPage({
      version: 1,
      forms: {},
      rejectedForms: [],
      candidates: {},
    });

    const textarea = page.querySelector<HTMLTextAreaElement>(".lexicon-textarea");
    if (!textarea) throw new Error("textarea not found");
    textarea.value = "Zítra pojedu do Brna a potom do Plzně";
    page.querySelector<HTMLButtonElement>(".lexicon-import-button")?.click();
    await flushMicrotasks();

    expect(page.querySelector(".lexicon-candidate-card")).not.toBeNull();
    expect(page.querySelector(".lexicon-empty-note")).toBeNull();
    // The textarea is cleared so the next paste starts from a clean slate.
    expect(
      page.querySelector<HTMLTextAreaElement>(".lexicon-textarea")?.value,
    ).toBe("");
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("ignores an import of whitespace only", async () => {
    const { page } = await mountPage({
      version: 1,
      forms: {},
      rejectedForms: [],
      candidates: {},
    });
    const textarea = page.querySelector<HTMLTextAreaElement>(".lexicon-textarea");
    if (!textarea) throw new Error("textarea not found");
    textarea.value = "   \n  ";
    page.querySelector<HTMLButtonElement>(".lexicon-import-button")?.click();
    await flushMicrotasks();

    expect(saveMock).not.toHaveBeenCalled();
    // Untouched — an accidental click shouldn't wipe what's in the box.
    expect(textarea.value).toBe("   \n  ");
  });
});

describe("buildLexiconPage target typeahead", () => {
  it("stays closed until the user types", async () => {
    const { page } = await mountPage(builderWithTargets());
    const list = page.querySelector<HTMLElement>(".lexicon-typeahead");
    expect(list?.getAttribute("role")).toBe("listbox");
    expect(list?.hidden).toBe(true);

    typeInto(getTargetInput(page), "  ");
    expect(list?.hidden).toBe(true);
  });

  it("lists matching targets with the first one highlighted", async () => {
    const { page } = await mountPage(builderWithTargets());
    typeInto(getTargetInput(page), "br");

    const list = page.querySelector<HTMLElement>(".lexicon-typeahead");
    expect(list?.hidden).toBe(false);
    const items = suggestionItems(page);
    expect(items.map((item) => item.textContent)).toEqual(["brno"]);
    expect(items[0].getAttribute("role")).toBe("option");
    expect(items[0].className).toBe("lexicon-typeahead-item is-active");
    expect(items[0].getAttribute("aria-selected")).toBe("true");
  });

  it("closes again when the query stops matching anything", async () => {
    const { page } = await mountPage(builderWithTargets());
    const input = getTargetInput(page);
    typeInto(input, "br");
    expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(false);

    typeInto(input, "zzzz");
    expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(true);
    expect(suggestionItems(page)).toHaveLength(0);
  });

  it("moves the highlight with ArrowDown / ArrowUp, wrapping at both ends", async () => {
    const { page } = await mountPage(builderWithTargets());
    const input = getTargetInput(page);
    // "p" matches praha and plzen.
    typeInto(input, "p");
    expect(suggestionItems(page)).toHaveLength(2);

    const activeIndex = (): number =>
      suggestionItems(page).findIndex((item) => item.classList.contains("is-active"));
    expect(activeIndex()).toBe(0);

    expect(pressKey(input, "ArrowDown").defaultPrevented).toBe(true);
    expect(activeIndex()).toBe(1);
    pressKey(input, "ArrowDown");
    expect(activeIndex()).toBe(0);
    expect(pressKey(input, "ArrowUp").defaultPrevented).toBe(true);
    expect(activeIndex()).toBe(1);
  });

  it("closes on Escape without touching the typed value", async () => {
    const { page } = await mountPage(builderWithTargets());
    const input = getTargetInput(page);
    typeInto(input, "p");

    expect(pressKey(input, "Escape").defaultPrevented).toBe(true);
    expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(true);
    expect(input.value).toBe("p");
  });

  it("fills the input from the highlighted suggestion on Enter instead of committing", async () => {
    saveMock.mockResolvedValue(undefined);
    const { page } = await mountPage(builderWithTargets());
    const input = getTargetInput(page);
    typeInto(input, "pl");

    pressKey(input, "Enter");
    await flushMicrotasks();

    // First Enter picks; it must not also fire the parent Enter→Map handler.
    expect(input.value).toBe("plzen");
    expect(saveMock).not.toHaveBeenCalled();
    expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(true);
    expect(page.querySelector(".lexicon-candidate-word")?.textContent).toBe("psovi");
  });

  it("ignores keys other than the navigation set while the list is open", async () => {
    const { page } = await mountPage(builderWithTargets());
    const input = getTargetInput(page);
    typeInto(input, "p");

    expect(pressKey(input, "a").defaultPrevented).toBe(false);
    expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(false);
  });

  it("picks a suggestion on mousedown so the click beats the blur", async () => {
    const { page } = await mountPage(builderWithTargets());
    const input = getTargetInput(page);
    typeInto(input, "pl");

    const item = suggestionItems(page)[0];
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    item.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe("plzen");
    expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(true);
  });

  it("closes shortly after blur", async () => {
    vi.useFakeTimers();
    try {
      const { page } = await mountPage(builderWithTargets());
      const input = getTargetInput(page);
      typeInto(input, "p");
      expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(false);

      input.dispatchEvent(new Event("blur"));
      // Still open immediately after blur — the grace period lets a click on a
      // suggestion land first.
      expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(false);
      vi.advanceTimersByTime(120);
      expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildLexiconPage save-status edge", () => {
  it("reports a lost session as a save error without rebuilding the body", async () => {
    // Signed in at load time, signed out by the time the decision saves.
    let store: LexiconStore | null = makeStoreMock();
    loadStateMock.mockResolvedValue(makeBuilder());
    const { buildLexiconPage } = await import("../src/app/view/pages/lexicon-page");
    const page = buildLexiconPage({
      profile: PROFILE,
      getLexiconStore: () => store,
      onSignIn: vi.fn(),
      onSelectMenuItem: vi.fn(),
    });
    document.body.append(page);
    await flushMicrotasks();
    await flushMicrotasks();

    store = null;
    page.querySelector<HTMLButtonElement>(".lexicon-action-map")?.click();
    await flushMicrotasks();

    const pill = getSaveStatusEl(page);
    expect(pill.className).toContain("lexicon-save-error");
    expect(pill.textContent).toContain("Not signed in.");
  });
});

describe("buildLexiconPage structure + wiring gaps", () => {
  it("wraps the body and the candidate rows in their layout classes", async () => {
    const { page } = await mountPage(makeBuilder());
    expect(page.querySelector(".lexicon-body")).not.toBeNull();
    expect(page.querySelector(".lexicon-candidate-word-row")).not.toBeNull();
    expect(page.querySelector(".lexicon-target-row")).not.toBeNull();
    expect(page.querySelector(".lexicon-target-input-wrap")).not.toBeNull();
    expect(page.querySelector(".lexicon-actions")).not.toBeNull();
    expect(
      page.querySelector<HTMLButtonElement>(".lexicon-action-map")?.textContent,
    ).toBe("Map");
  });

  it("focuses the target input on mount so the keyboard flow starts there", async () => {
    const { page } = await mountPage(makeBuilder());
    expect(document.activeElement).toBe(getTargetInput(page));
  });

  it("loads from Drive once, not again on every rebuild", async () => {
    loadStateMock.mockResolvedValue(makeBuilder());
    const { buildLexiconPage } = await import("../src/app/view/pages/lexicon-page");
    const options = {
      profile: PROFILE,
      getLexiconStore: () => makeStoreMock(),
      onSignIn: vi.fn(),
      onSelectMenuItem: vi.fn(),
    };
    buildLexiconPage(options);
    await flushMicrotasks();
    await flushMicrotasks();
    // A theme switch or sync-pill change rebuilds the page; the module cache
    // is there precisely so that costs no extra Drive round-trip.
    buildLexiconPage(options);
    await flushMicrotasks();

    expect(loadStateMock).toHaveBeenCalledTimes(1);
  });

  it("clears the very textarea the user typed into, not just the rebuilt one", async () => {
    // The import rerenders the body, so reading `.lexicon-textarea` after the
    // click finds a fresh (always empty) element — the assertion has to hold
    // onto the original node to prove it was cleared.
    saveMock.mockResolvedValue(undefined);
    const { page } = await mountPage({
      version: 1,
      forms: {},
      rejectedForms: [],
      candidates: {},
    });
    const textarea = page.querySelector<HTMLTextAreaElement>(".lexicon-textarea");
    if (!textarea) throw new Error("textarea not found");
    textarea.value = "Zítra pojedu do Brna";
    page.querySelector<HTMLButtonElement>(".lexicon-import-button")?.click();
    await flushMicrotasks();

    expect(textarea.value).toBe("");
  });

  it("reads an uploaded .txt file into the textarea", async () => {
    const { page } = await mountPage(makeBuilder());
    const fileInput = page.querySelector<HTMLInputElement>(".lexicon-file-input");
    const textarea = page.querySelector<HTMLTextAreaElement>(".lexicon-textarea");
    if (!fileInput || !textarea) throw new Error("import card not found");

    const file = new File(["Zítra pojedu do Brna"], "notes.txt", {
      type: "text/plain",
    });
    Object.defineProperty(fileInput, "files", { value: [file], writable: false });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(textarea.value).toBe("Zítra pojedu do Brna");
  });

  it("ignores a change event with no file attached", async () => {
    const { page } = await mountPage(makeBuilder());
    const fileInput = page.querySelector<HTMLInputElement>(".lexicon-file-input");
    const textarea = page.querySelector<HTMLTextAreaElement>(".lexicon-textarea");
    if (!fileInput || !textarea) throw new Error("import card not found");

    textarea.value = "typed by hand";
    Object.defineProperty(fileInput, "files", { value: [], writable: false });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await flushMicrotasks();

    expect(textarea.value).toBe("typed by hand");
  });

  it("falls back to generic copy when Drive rejects with a non-Error", async () => {
    loadStateMock.mockRejectedValueOnce("just a string");
    const page = await buildPage({});
    await flushMicrotasks();
    await flushMicrotasks();

    expect(page.querySelector(".lexicon-error-card p")?.textContent).toBe(
      "Couldn't load builder state: Drive load failed.",
    );
  });

  it("falls back to generic copy when the save rejects with a non-Error", async () => {
    saveMock.mockRejectedValue({ status: 500 });
    const { page } = await mountPage(makeBuilder());

    page.querySelector<HTMLButtonElement>(".lexicon-action-map")?.click();
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    const pill = getSaveStatusEl(page);
    expect(pill.className).toContain("lexicon-save-error");
    expect(pill.textContent).toContain("Drive save failed.");
  });
});

function builderWithThreeP(): BuilderState {
  return {
    version: 1,
    forms: { praha: "praha", plzen: "plzen", policie: "policie" },
    rejectedForms: [],
    candidates: { psovi: { count: 2, contexts: [] } },
  };
}

describe("buildLexiconPage typeahead keyboard details", () => {
  it("marks exactly one option as selected", async () => {
    const { page } = await mountPage(builderWithThreeP());
    typeInto(getTargetInput(page), "p");
    expect(
      suggestionItems(page).map((item) => item.getAttribute("aria-selected")),
    ).toEqual(["true", "false", "false"]);
  });

  it("wraps ArrowUp from the first option to the last", async () => {
    // With only two suggestions `-1 + len` and `+1` are indistinguishable —
    // three options are needed to pin the direction.
    const { page } = await mountPage(builderWithThreeP());
    const input = getTargetInput(page);
    typeInto(input, "p");
    pressKey(input, "ArrowUp");

    const activeIndex = suggestionItems(page).findIndex((item) =>
      item.classList.contains("is-active"),
    );
    expect(suggestionItems(page)).toHaveLength(3);
    expect(activeIndex).toBe(2);
  });

  it("leaves the arrow keys alone while the list is closed", async () => {
    // Without the early return the handler would swallow ArrowDown even with
    // no list on screen — the caret could no longer move in the input.
    const { page } = await mountPage(builderWithThreeP());
    const input = getTargetInput(page);
    expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(true);
    expect(pressKey(input, "ArrowDown").defaultPrevented).toBe(false);
    expect(page.querySelector<HTMLElement>(".lexicon-typeahead")?.hidden).toBe(true);
  });
});
