// @vitest-environment happy-dom
//
// Direct unit tests for `runAppBootstrap` — the smoke-test in
// `create-app-smoke.test.ts` already exercises the happy + error paths
// through `createApp`, but several branches of `runAppBootstrap` itself
// (early-return after a restored profile, non-`Error` throw fallback,
// the literal arguments handed to `history.replaceState`) are easier
// to assert against directly. This file fills those gaps so the
// bootstrap orchestration is observable without booting the full app.
// happy-dom gives us `window.history.replaceState` to spy on; the rest
// of the suite stays DOM-free and runs in the default `node` env.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppBootstrap } from "../src/app/session/session";
import type { SutraPadWorkspace, UserProfile } from "../src/types";

interface BootstrapHarness {
  effects: Parameters<typeof runAppBootstrap>[0];
  spies: {
    setProfile: ReturnType<typeof vi.fn>;
    setWorkspace: ReturnType<typeof vi.fn>;
    setSyncState: ReturnType<typeof vi.fn>;
    setLastError: ReturnType<typeof vi.fn>;
    persistLocalWorkspace: ReturnType<typeof vi.fn>;
    captureIncomingWorkspaceFromUrl: ReturnType<typeof vi.fn>;
    restoreWorkspaceAfterSignIn: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    initialize: ReturnType<typeof vi.fn>;
    restorePersistedSession: ReturnType<typeof vi.fn>;
  };
}

const emptyWorkspace: SutraPadWorkspace = { notes: [], activeNoteId: null };

function createHarness(
  overrides: Partial<{
    captureIncomingWorkspaceFromUrl: (workspace: SutraPadWorkspace) => Promise<SutraPadWorkspace>;
    initialize: () => Promise<void>;
    restorePersistedSession: () => Promise<UserProfile | null>;
  }> = {},
): BootstrapHarness {
  const spies = {
    setProfile: vi.fn(),
    setWorkspace: vi.fn(),
    setSyncState: vi.fn(),
    setLastError: vi.fn(),
    persistLocalWorkspace: vi.fn(),
    captureIncomingWorkspaceFromUrl: vi.fn(
      overrides.captureIncomingWorkspaceFromUrl ??
        (async (w: SutraPadWorkspace) => w),
    ),
    restoreWorkspaceAfterSignIn: vi.fn(async () => {}),
    render: vi.fn(),
    initialize: vi.fn(overrides.initialize ?? (async () => {})),
    restorePersistedSession: vi.fn(
      overrides.restorePersistedSession ?? (async () => null),
    ),
  };

  const effects: Parameters<typeof runAppBootstrap>[0] = {
    auth: {
      initialize: spies.initialize,
      restorePersistedSession: spies.restorePersistedSession,
    },
    captureIncomingWorkspaceFromUrl: spies.captureIncomingWorkspaceFromUrl,
    getWorkspace: () => emptyWorkspace,
    setWorkspace: spies.setWorkspace,
    setProfile: spies.setProfile,
    setSyncState: spies.setSyncState,
    setLastError: spies.setLastError,
    persistLocalWorkspace: spies.persistLocalWorkspace,
    restoreWorkspaceAfterSignIn: spies.restoreWorkspaceAfterSignIn,
    render: spies.render,
  };

  return { effects, spies };
}

describe("runAppBootstrap", () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // happy-dom provides window.history but not always a stable spy
    // surface — wrap it explicitly so we can assert args.
    replaceStateSpy = vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
  });

  it("captures the URL workspace, persists it, clears capture params, then initialises auth", async () => {
    const captured: SutraPadWorkspace = {
      notes: [
        {
          id: "n1",
          title: "captured",
          body: "",
          urls: [],
          tags: [],
          createdAt: "2026-04-20T10:00:00.000Z",
          updatedAt: "2026-04-20T10:00:00.000Z",
        },
      ],
      activeNoteId: null,
    };
    const { effects, spies } = createHarness({
      captureIncomingWorkspaceFromUrl: async () => captured,
    });

    await runAppBootstrap(effects);

    expect(spies.captureIncomingWorkspaceFromUrl).toHaveBeenCalledTimes(1);
    expect(spies.setWorkspace).toHaveBeenCalledWith(captured);
    expect(spies.persistLocalWorkspace).toHaveBeenCalledWith(captured);
    expect(spies.initialize).toHaveBeenCalledTimes(1);

    // Capture-param cleanup is observable via the exact argument shape:
    // an empty state, the empty title (Stryker mutates this string),
    // and the cleaned URL string from clearCaptureParamsFromLocation.
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    const args = replaceStateSpy.mock.calls[0];
    expect(args[0]).toEqual({});
    expect(args[1]).toBe("");
    expect(typeof args[2]).toBe("string");
  });

  it("skips the trailing render when restoreSessionOnStartup returned a profile", async () => {
    // The `if (restoredProfile) return;` branch must short-circuit:
    // restorePersistedSession already triggers its own render via the
    // applyRestoredProfile callback wired below, so a second render
    // here would double-paint the initial frame.
    const profile: UserProfile = {
      name: "Filda",
      email: "filda@example.test",
      picture: "https://example.test/avatar.png",
    };
    const { effects, spies } = createHarness({
      restorePersistedSession: async () => profile,
    });

    await runAppBootstrap(effects);

    expect(spies.setProfile).toHaveBeenCalledWith(profile);
    expect(spies.restoreWorkspaceAfterSignIn).toHaveBeenCalledTimes(1);
    // Final render in runAppBootstrap is the explicit "no profile" path.
    // Guarded against the early-return mutation: with the early-return
    // dropped, render fires twice (once per branch).
    expect(spies.render).not.toHaveBeenCalled();
  });

  it("renders exactly once when no persisted session was restored", async () => {
    // Happy "first launch" path: no profile, no error → exactly one
    // render at the bottom of the function.
    const { effects, spies } = createHarness();

    await runAppBootstrap(effects);

    expect(spies.setProfile).not.toHaveBeenCalled();
    expect(spies.render).toHaveBeenCalledTimes(1);
  });

  it("routes errors through setSyncState + setLastError + render with the Error message", async () => {
    // captureIncomingWorkspaceFromUrl throws. setLastError must
    // receive the original Error message, not a default fallback.
    const { effects, spies } = createHarness({
      captureIncomingWorkspaceFromUrl: async () => {
        throw new Error("Drive permissions denied");
      },
    });

    await runAppBootstrap(effects);

    expect(spies.setSyncState).toHaveBeenCalledWith("error");
    expect(spies.setLastError).toHaveBeenCalledWith(
      "Drive permissions denied",
    );
    // Single render even on the error path — the error UI needs a
    // paint just like a successful first launch.
    expect(spies.render).toHaveBeenCalledTimes(1);
  });

  it("falls back to the pinned default message when the thrown value is not an Error", async () => {
    // Anything that isn't a real Error (a string, an object, undefined)
    // must surface as the literal "App initialization failed." copy.
    // Pin the exact wording so a copy edit reads as a deliberate change.
    const { effects, spies } = createHarness({
      captureIncomingWorkspaceFromUrl: async () => {
        throw "not-an-error-object";
      },
    });

    await runAppBootstrap(effects);

    expect(spies.setLastError).toHaveBeenCalledWith("App initialization failed.");
    expect(spies.setSyncState).toHaveBeenCalledWith("error");
    expect(spies.render).toHaveBeenCalledTimes(1);
  });

  it("treats an auth.initialize() rejection as a bootstrap error, not an unhandled rejection", async () => {
    // Auth init throws after the workspace capture succeeds — the
    // try/catch must still produce a clean error pulse + render.
    const { effects, spies } = createHarness({
      initialize: async () => {
        throw new Error("auth init blew up");
      },
    });

    await runAppBootstrap(effects);

    expect(spies.setSyncState).toHaveBeenCalledWith("error");
    expect(spies.setLastError).toHaveBeenCalledWith("auth init blew up");
    expect(spies.render).toHaveBeenCalledTimes(1);
  });
});
