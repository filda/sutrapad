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
});
