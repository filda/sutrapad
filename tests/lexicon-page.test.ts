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

// Hoisted-style mock factory so the page module's
// `import { GoogleDriveLexiconStore } from "../../../services/drive/lexicon-store"`
// resolves to a class that delegates to the per-test mocks above.
vi.mock("../src/services/drive/lexicon-store", () => ({
  GoogleDriveLexiconStore: class {
    async loadState() {
      return loadStateMock();
    }
    async saveStateAndRuntime(...args: unknown[]) {
      return saveMock(...args);
    }
  },
}));

// happy-dom auto-fetches `<img src=…>` URLs. The page itself doesn't
// embed images, but stubbing keeps stderr quiet if anything sneaks in
// via dependency code (parity with the other view-page suites).
beforeEach(() => {
  vi.resetModules();
  loadStateMock = vi.fn();
  saveMock = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
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
    getAccessToken: () => "test-token",
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
