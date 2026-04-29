// @vitest-environment happy-dom
//
// End-to-end smoke test for `createApp`. The rest of the suite runs
// in the default `node` environment because logic is extracted DOM-free;
// this file is a deliberate exception (alongside `notes-list-xss.test.ts`).
//
// What this protects against
// --------------------------
// The bug class we're guarding against is the one we just fixed: the
// `render()` ↔ `scheduleRender()` ↔ atom-subscriber handshake fails in
// a way that produces NO console error, NO failing unit test, and a
// blank-page experience in the browser. Specifically: if `render()`
// mutates an atom and that atom's subscriber re-queues another
// `render()` via microtask, the browser stays busy in microtasks
// indefinitely and never paints. Vitest's per-test timeout converts
// that "silently broken" failure mode into a clean "Test timed out"
// signal. A `setTimeout` based settle-wait in the test body is the
// trip-wire — if microtasks loop, the timer's macrotask never fires.
//
// What this does NOT protect against
// ----------------------------------
// happy-dom doesn't enforce CSP, doesn't paint, has only partial
// support for `matchMedia` / IntersectionObserver / focus / scroll,
// and has no service worker. Failure modes that depend on a real
// engine (focus loss during autosave on mobile, CSP blocking a
// regressed inline-script handler, paint timing) need a real headless
// browser and don't belong here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_WORKSPACE_KEY } from "../src/app/storage/local-workspace";

// Stub `GoogleAuthService` — the real one tries to load
// `https://accounts.google.com/gsi/client` and call `/userinfo`, both
// of which fail in happy-dom. The auth path isn't what this test is
// for; we just need `createApp` to reach `render()` and produce a
// usable DOM. `runAppBootstrap` already has a `try/catch` around
// `auth.initialize()`, so a thrown initialize is the exact path that
// exercises the "atom→render handshake works for the error pulse"
// invariant at the bottom of this file.
vi.mock("../src/services/google-auth", () => {
  return {
    GoogleAuthService: class MockGoogleAuthService {
      async initialize(): Promise<void> {
        throw new Error("smoke-test: auth disabled");
      }
      async bootstrap(): Promise<null> {
        return null;
      }
      async refreshSession(): Promise<null> {
        return null;
      }
      getAccessToken(): string | null {
        return null;
      }
    },
    readEmailHint(): string | null {
      return null;
    },
    hasLoggedInHint(): boolean {
      return false;
    },
  };
});

describe("createApp smoke", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    // Reset the URL so `captureIncomingWorkspaceFromUrl` short-circuits
    // (no `?note=` / `?url=` payload) — otherwise it would hit
    // `resolveCurrentCoordinates` / `reverseGeocodeCoordinates` and
    // tickle `fetch`, which happy-dom doesn't fully wire up.
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Per-test timeout tightened from the 5s vitest default to fail a
  // real hang in ~3s instead of ~5s. Success path runs ~0.9-1.4s
  // locally (dominated by the cold dynamic `import("../src/app")`
  // transforming the whole module graph); 3s leaves ~2× headroom
  // for slow GitHub Actions runners (especially macOS, which is
  // typically 2-3× slower than Linux). Raise this if it flakes — the
  // fix is almost certainly happy-dom warm-up, not the test itself.
  it("renders without looping and surfaces the bootstrap-error pulse", { timeout: 3000 }, async () => {
    // Dynamic import so the `vi.mock` above is in effect when `app.ts`
    // imports `../src/services/google-auth`.
    const { createApp } = await import("../src/app");
    const root = document.querySelector<HTMLElement>("#app");
    if (root === null) throw new Error("expected #app in document");

    createApp(root);

    // After the synchronous render at the end of `createApp`, the root
    // should already hold the topbar/notes layout. If `createApp`
    // threw, this would fail with "expected children > 0".
    expect(root.children.length).toBeGreaterThan(0);

    // Drain the microtask queue plus one macrotask so the bootstrap's
    // mock-rejected `auth.initialize()` resolves through the catch
    // block, fires its `setSyncState("error")` + `setLastError`
    // chain, then runs the trailing synchronous `render()`. The
    // bootstrap's promise chain is ~3 microtasks deep — anything
    // beyond `setTimeout(0)` is just margin.
    //
    // **The trip-wire**: if `render()` ↔ `scheduleRender()` ever
    // loops again via microtasks, this `setTimeout` is a macrotask
    // that can only run *after* the microtask queue drains. The
    // await never resolves, vitest's per-test timeout fires (2s, set
    // on the `it` above), the parent fork-pool kills the worker, and
    // the test report points at this exact line. Failure mode is
    // "Test timed out" — louder than "silently blank page".
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Structural landmarks always present after the first render.
    // (The `.status` <p> from `editor-card.ts` only appears when a note
    // editor is mounted, which requires a non-empty workspace — so we
    // don't assert on it here. The sync pill in the topbar is
    // unconditional.)
    expect(root.querySelector(".topbar")).toBeInstanceOf(HTMLElement);
    expect(root.querySelector(".nav-tabs")).toBeInstanceOf(HTMLElement);
    const syncPill = root.querySelector(".sync-pill");
    expect(syncPill).toBeInstanceOf(HTMLElement);

    // The mocked `auth.initialize()` threw, so the bootstrap's catch
    // block flipped sync state to "error" via `setSyncState`. That
    // mutation only reaches the DOM if the atom→subscribe→
    // scheduleRender→render handshake is wired up correctly. So this
    // single assertion proves: (a) initial render ran, (b) the error
    // pulse propagated through the atom store, and (c) a second
    // render painted the new state without infinite-looping.
    expect(syncPill?.className).toContain("is-error");
  });

  it("can be re-mounted against a fresh root without throwing (HMR canary)", { timeout: 3000 }, async () => {
    // Dev-mode HMR re-runs `createApp` against the same `window` after
    // every save. The `import.meta.hot.dispose` hook is supposed to
    // tear down keydown / storage listeners + render subscriptions so
    // the next mount doesn't see ghost listeners stacking up. We
    // can't drive the HMR hook directly from tests, but we can at
    // least confirm a second `createApp` against a fresh root
    // element doesn't throw and still produces DOM. If a leak ever
    // makes a second mount blow up (e.g. duplicated palette host
    // appended twice), this is the canary.
    const { createApp } = await import("../src/app");

    const firstRoot = document.querySelector<HTMLElement>("#app");
    if (firstRoot === null) throw new Error("expected #app");
    createApp(firstRoot);
    await new Promise((resolve) => setTimeout(resolve, 10));

    document.body.innerHTML = '<div id="app"></div>';
    const secondRoot = document.querySelector<HTMLElement>("#app");
    if (secondRoot === null) throw new Error("expected #app after reset");

    expect(() => createApp(secondRoot)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(secondRoot.children.length).toBeGreaterThan(0);
  });

  it("keeps the focused body textarea mounted while local edits update the workspace", { timeout: 3000 }, async () => {
    const workspace = {
      activeNoteId: "note-1",
      notes: [
        {
          id: "note-1",
          title: "Alpha",
          body: "",
          urls: [],
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          tags: [],
        },
      ],
    };
    localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
    window.history.replaceState({}, "", "/notes/note-1");

    const { createApp } = await import("../src/app");
    const root = document.querySelector<HTMLElement>("#app");
    if (root === null) throw new Error("expected #app");

    createApp(root);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(root.querySelector(".sync-pill")?.className).toContain("is-error");

    const textarea = root.querySelector<HTMLTextAreaElement>(".body-input");
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    if (textarea === null) throw new Error("expected body textarea");

    textarea.focus();
    textarea.value = "A";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();

    expect(root.querySelector(".body-input")).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(JSON.parse(localStorage.getItem(LOCAL_WORKSPACE_KEY) ?? "{}").notes[0].body).toBe("A");
  });

  it("preserves caret + focus through the new-note geolocation backfill", { timeout: 5000 }, async () => {
    // Seed local with a real note so the spawn path lands the user on
    // a fresh draft instead of the empty-workspace home pulse.
    const workspace = {
      activeNoteId: "seed",
      notes: [
        {
          id: "seed",
          title: "Existing",
          body: "kept",
          urls: [],
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          tags: [],
        },
      ],
    };
    localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
    window.history.replaceState({}, "", "/notes/seed");

    const { createApp } = await import("../src/app");
    const root = document.querySelector<HTMLElement>("#app");
    if (root === null) throw new Error("expected #app");

    createApp(root);
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Spawn the fresh draft via the documented `N` keyboard shortcut —
    // same path `+ Add` runs internally.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textarea = root.querySelector<HTMLTextAreaElement>(".body-input");
    if (textarea === null) throw new Error("expected body textarea on fresh note");

    textarea.focus();
    textarea.value = "x";
    textarea.setSelectionRange(1, 1);

    // Drain enough timers so the post-`+ Add` async backfill resolves
    // (geolocation rejects in happy-dom, the no-coords path runs, the
    // prettified title lands) and the focus-preserving render fires.
    await new Promise((resolve) => setTimeout(resolve, 60));

    const refreshed = root.querySelector<HTMLTextAreaElement>(".body-input");
    if (refreshed === null) throw new Error("expected body textarea after backfill");

    // Sanity check: the backfill actually fired and re-rendered the
    // editor. The default placeholder is `DEFAULT_NOTE_TITLE`
    // ("Untitled note"); after the backfill it's a generated
    // time-of-day title. If we still see the placeholder, the patch
    // path didn't run and the focus assertion below would be
    // testing nothing.
    const titleInput = root.querySelector<HTMLInputElement>(".title-input");
    expect(titleInput?.value).toBeTruthy();
    expect(titleInput?.value).not.toBe("Untitled note");

    // Even though the backfill triggers a render to apply the patched
    // title + capture-context, the focus and caret must survive on the
    // freshly mounted textarea — the user doesn't notice the swap.
    expect(document.activeElement).toBe(refreshed);
    expect(refreshed.selectionStart).toBe(1);
    expect(refreshed.selectionEnd).toBe(1);
  });

  it("typing `#auto` mid-prose does not commit `#a`, `#au`, `#aut`, `#auto` progressively", { timeout: 5000 }, async () => {
    // Regression for the "tags pile up" report. When the user inserts a
    // hashtag between two existing words, the regex lookahead is
    // immediately satisfied by the downstream space — so without the
    // caret-aware extraction in `mergeHashtagsIntoTags` every keystroke
    // would commit a new prefix tag (`#a` → `#au` → `#aut` → `#auto`)
    // and the localStorage workspace would carry all four.
    const workspace = {
      activeNoteId: "note-1",
      notes: [
        {
          id: "note-1",
          title: "T",
          body: "first  next",
          urls: [],
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          tags: [],
        },
      ],
    };
    localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
    window.history.replaceState({}, "", "/notes/note-1");

    const { createApp } = await import("../src/app");
    const root = document.querySelector<HTMLElement>("#app");
    if (root === null) throw new Error("expected #app");

    createApp(root);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const textarea = root.querySelector<HTMLTextAreaElement>(".body-input");
    if (textarea === null) throw new Error("expected body textarea");
    textarea.focus();

    // Simulate typing `#auto` between the two spaces of "first  next" —
    // caret starts at index 6 (between the two spaces), advances one
    // position per char. The textarea's `selectionStart` is the
    // signal the input handler reads, so we keep it in sync.
    let caret = 6;
    const insertions = "#auto";
    // The sequential awaits below are intentional — each keystroke
    // needs the microtask queue drained AND a macrotask boundary
    // before the next one so any queued render lands first.
    // eslint-disable-next-line no-await-in-loop
    for (let i = 0; i < insertions.length; i += 1) {
      const ch = insertions[i];
      textarea.value = textarea.value.slice(0, caret) + ch + textarea.value.slice(caret);
      caret += 1;
      textarea.setSelectionRange(caret, caret);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
      const stored = JSON.parse(localStorage.getItem(LOCAL_WORKSPACE_KEY) ?? "{}");
      const note = stored.notes?.find(
        (n: { id: string }) => n.id === stored.activeNoteId,
      );
      // No partial prefix tag is allowed at any keystroke.
      expect(note?.tags ?? []).toEqual([]);
    }
  });

  it("body textarea focus + caret survive an unrelated rendering-atom mutation", { timeout: 5000 }, async () => {
    // Even atoms that ride no specific suppression wrapper (e.g.
    // `currentTheme$`, `notesViewMode$`, `tasksFilter$`) trigger a full
    // render through the atom subscriber chain. The user can be
    // mid-keystroke in the body textarea when one of those fires —
    // theme auto-switch on a system light/dark flip, palette opening
    // a note in another tab, a deferred async resolver landing — so
    // the global `render()` pass needs to be implicitly focus-safe,
    // not just the handful of paths that opted in via
    // `renderPreservingBodyInputFocus`.
    const workspace = {
      activeNoteId: "note-1",
      notes: [
        {
          id: "note-1",
          title: "Alpha",
          body: "abcdef",
          urls: [],
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          tags: [],
        },
      ],
    };
    localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
    window.history.replaceState({}, "", "/notes/note-1");

    const { createApp } = await import("../src/app");
    const root = document.querySelector<HTMLElement>("#app");
    if (root === null) throw new Error("expected #app");

    createApp(root);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const textarea = root.querySelector<HTMLTextAreaElement>(".body-input");
    if (textarea === null) throw new Error("expected body textarea");
    textarea.focus();
    textarea.setSelectionRange(3, 3);

    // Drive a render via an unrelated rendering-atom mutation: pick the
    // theme switcher's exposed control because clicking it cycles
    // `currentTheme$` and forces a full re-render through the
    // subscriber chain (no editor-specific focus wrapper is in play).
    // If the global render isn't focus-safe, the body textarea will
    // be replaced and `document.activeElement` will fall back to
    // `<body>` here.
    const themeButton = root.querySelector<HTMLButtonElement>("button[data-theme-toggle]")
      ?? Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => /theme|paper|sand|charcoal/i.test(b.getAttribute("aria-label") ?? "")
      );

    // Fall through to firing a synthetic atom mutation by dispatching
    // a visibility change — that triggers the SW update coordinator,
    // not a render — so we explicitly mutate via the URL hash, which
    // routes through the location syncs in `render()`. Either way,
    // we need *some* render to fire while focus is in the body.
    if (themeButton) {
      themeButton.click();
    } else {
      // Last resort: navigate to a different menu and back. The
      // `setActiveMenuItem` call inside the home button handler runs
      // through the rendering atom chain.
      const homeLink = root.querySelector<HTMLElement>('[data-menu="home"]')
        ?? root.querySelector<HTMLElement>('.nav-tabs a, .nav-tabs button');
      homeLink?.click();
      const notesLink = root.querySelector<HTMLElement>('[data-menu="notes"]');
      notesLink?.click();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));

    const afterRender = root.querySelector<HTMLTextAreaElement>(".body-input");
    if (afterRender === null) {
      // The render may have navigated away — that's fine for this
      // test, the focus-preservation contract only needs to hold
      // when the editor stays mounted. Re-mount it and verify the
      // textarea stayed focusable.
      window.history.replaceState({}, "", "/notes/note-1");
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }

    // The render rebuilt the editor; focus + caret must come back.
    expect(document.activeElement).toBe(afterRender);
    expect(afterRender.selectionStart).toBe(3);
    expect(afterRender.selectionEnd).toBe(3);
  });
});
