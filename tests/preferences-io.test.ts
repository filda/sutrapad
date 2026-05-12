import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferencesIO } from "../src/app/session/preferences-io";
import type { GoogleDrivePreferencesStore } from "../src/services/drive-store";
import type { SutraPadPreferences, UserProfile } from "../src/types";

/**
 * Tests for the preferences-IO orchestration layer. The Drive
 * `GoogleDrivePreferencesStore` is mocked — we already pin the wire
 * shape in `drive-preferences-store.test.ts`. The assertions here pin
 * the coordination contract:
 *
 *   - load swaps the atom; missing-file keeps local
 *   - save is debounced
 *   - signed-out is a soft no-op
 *   - the clean-snapshot guard skips redundant pushes
 *   - cancel actually cancels
 */

const PROFILE: UserProfile = { name: "Filip", email: "f@b.com" };

interface FakeStore {
  loadPreferences: ReturnType<typeof vi.fn>;
  savePreferences: ReturnType<typeof vi.fn>;
}

function createFakeStore(): FakeStore {
  return {
    loadPreferences: vi.fn(),
    savePreferences: vi.fn().mockResolvedValue(undefined),
  };
}

interface Harness {
  dismissed: Set<string>;
  profile: UserProfile | null;
  fake: FakeStore;
  io: ReturnType<typeof createPreferencesIO>;
}

function harness(overrides: Partial<Harness> = {}): Harness {
  const dismissed = overrides.dismissed ?? new Set<string>();
  const fake = overrides.fake ?? createFakeStore();
  let profile: UserProfile | null = overrides.profile ?? PROFILE;
  // The seed `let` is intentionally re-assignable so individual tests
  // can flip the profile to null mid-flight (e.g. signed-out race).
  let dismissedRef = dismissed;
  const io = createPreferencesIO({
    getPreferencesStore: () =>
      profile ? (fake as unknown as GoogleDrivePreferencesStore) : null,
    retryContext: {
      refreshSession: vi.fn(),
    },
    getDismissedTagAliases: () => dismissedRef,
    setDismissedTagAliases: (next) => {
      dismissedRef = next;
    },
    getProfile: () => profile,
  });
  return {
    dismissed,
    profile,
    fake,
    io,
    // Expose mutators for tests via property descriptors so the
    // current ref / profile reads above stay live.
    get dismissedCurrent() {
      return dismissedRef;
    },
    setProfile(next: UserProfile | null) {
      profile = next;
    },
  } as Harness & {
    readonly dismissedCurrent: ReadonlySet<string>;
    setProfile: (next: UserProfile | null) => void;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe("createPreferencesIO.loadPreferences", () => {
  it("replaces the local set when Drive returns a preferences blob", async () => {
    const h = harness();
    const payload: SutraPadPreferences = {
      version: 1,
      savedAt: "2026-05-01T00:00:00.000Z",
      dismissedTagAliases: ["a|b", "c|d"],
    };
    h.fake.loadPreferences.mockResolvedValue(payload);
    await h.io.loadPreferences();
    expect([...(h as unknown as { dismissedCurrent: Set<string> }).dismissedCurrent]).toEqual([
      "a|b",
      "c|d",
    ]);
  });

  it("keeps the local set when Drive returns null (no file yet)", async () => {
    // First-time use on this account: a fresh install where the user
    // dismissed a pair locally before signing in. The post-sign-in
    // load must NOT clobber that with an empty set.
    const local = new Set(["local|only"]);
    const h = harness({ dismissed: local });
    h.fake.loadPreferences.mockResolvedValue(null);
    await h.io.loadPreferences();
    expect([
      ...(h as unknown as { dismissedCurrent: Set<string> }).dismissedCurrent,
    ]).toEqual(["local|only"]);
  });

  it("is a no-op when signed out", async () => {
    const h = harness({ profile: null });
    const out = h as unknown as { setProfile: (p: UserProfile | null) => void };
    out.setProfile(null);
    await h.io.loadPreferences();
    expect(h.fake.loadPreferences).not.toHaveBeenCalled();
  });

  it("swallows Drive failures so the post-load chain doesn't reject", async () => {
    // A Drive failure here must not block the workspace load that
    // just preceded it. The IO logs and returns; the atom stays put.
    const h = harness({ dismissed: new Set(["keep|me"]) });
    h.fake.loadPreferences.mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(h.io.loadPreferences()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect([
      ...(h as unknown as { dismissedCurrent: Set<string> }).dismissedCurrent,
    ]).toEqual(["keep|me"]);
    warn.mockRestore();
  });
});

describe("createPreferencesIO.schedulePreferencesSave", () => {
  it("debounces with a 2-second timer and saves the sorted current set", async () => {
    const h = harness({ dismissed: new Set(["bill|kill", "a|b"]) });
    h.io.schedulePreferencesSave();
    // Not yet — debounced.
    expect(h.fake.savePreferences).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fake.savePreferences).toHaveBeenCalledTimes(1);
    const arg = h.fake.savePreferences.mock.calls[0][0] as SutraPadPreferences;
    // Sorted-by-key on the wire so the file is byte-stable across
    // toggles that land in the same final set.
    expect(arg.dismissedTagAliases).toEqual(["a|b", "bill|kill"]);
    expect(arg.version).toBe(1);
    expect(typeof arg.savedAt).toBe("string");
  });

  it("collapses rapid schedule calls into a single Drive RTT", async () => {
    const h = harness({ dismissed: new Set(["a|b"]) });
    h.io.schedulePreferencesSave();
    h.io.schedulePreferencesSave();
    h.io.schedulePreferencesSave();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fake.savePreferences).toHaveBeenCalledTimes(1);
  });

  it("skips the push when the current set matches the last Drive sync", async () => {
    // After a successful load, scheduling a save with the same value
    // shouldn't burn a Drive RTT. The clean-snapshot guard is the
    // direct analogue of `lastSyncedWorkspace` in `workspace-io`.
    const h = harness({ dismissed: new Set(["a|b"]) });
    h.fake.loadPreferences.mockResolvedValue({
      version: 1,
      savedAt: "2026-05-01T00:00:00.000Z",
      dismissedTagAliases: ["a|b"],
    });
    await h.io.loadPreferences();
    // Atom mutation through setDismissedTagAliases fires the
    // subscriber in production; here we model it by calling schedule
    // directly. With the snapshot just set to {"a|b"} and the current
    // set equal, the schedule should not arm a timer.
    h.io.schedulePreferencesSave();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fake.savePreferences).not.toHaveBeenCalled();
  });

  it("is a no-op when signed out at schedule time", async () => {
    const h = harness();
    const out = h as unknown as { setProfile: (p: UserProfile | null) => void };
    out.setProfile(null);
    h.io.schedulePreferencesSave();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fake.savePreferences).not.toHaveBeenCalled();
  });

  it("re-checks signed-in state at fire time and aborts if the user signed out mid-debounce", async () => {
    // Schedule, then sign out, then advance timers. The fire-time
    // gate covers the race where the user signed out between the
    // schedule and the timer firing — without it, `savePreferences`
    // would call into Drive with a freshly-rejected token.
    const h = harness({ dismissed: new Set(["a|b"]) });
    h.io.schedulePreferencesSave();
    (h as unknown as { setProfile: (p: UserProfile | null) => void }).setProfile(
      null,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fake.savePreferences).not.toHaveBeenCalled();
  });
});

describe("createPreferencesIO save error + snapshot behaviour", () => {
  it("skips a second push when the user re-schedules with the exact set we just saved", async () => {
    // Round-trip: schedule → fire → save lands → set the snapshot.
    // A subsequent schedule with the same set must not produce a
    // second Drive RTT. Without the snapshot update inside the save
    // path, every Keep-separate after the first would re-push the
    // identical bytes.
    const h = harness({ dismissed: new Set(["a|b"]) });
    h.io.schedulePreferencesSave();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fake.savePreferences).toHaveBeenCalledTimes(1);
    // Same set, schedule again — guard short-circuits at schedule time.
    h.io.schedulePreferencesSave();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fake.savePreferences).toHaveBeenCalledTimes(1);
  });

  it("logs and swallows a Drive save error so the timer state doesn't wedge", async () => {
    const h = harness({ dismissed: new Set(["a|b"]) });
    h.fake.savePreferences.mockRejectedValueOnce(new Error("net down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.io.schedulePreferencesSave();
    await vi.advanceTimersByTimeAsync(2000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("re-checks setsEqual when sizes match but contents differ", async () => {
    // Same-size mismatch path: a stale snapshot has {a|b} but the
    // current set is {c|d}. Sizes match, the inner has() check finds
    // the difference and `setsEqual` returns false — saving proceeds.
    const h = harness({ dismissed: new Set(["a|b"]) });
    h.fake.loadPreferences.mockResolvedValue({
      version: 1,
      savedAt: "2026-05-01T00:00:00.000Z",
      dismissedTagAliases: ["a|b"],
    });
    await h.io.loadPreferences();
    // Mutate the current set to a same-size-but-different value.
    (
      h as unknown as { dismissedCurrent: Set<string> }
    ).dismissedCurrent.clear();
    (h as unknown as { dismissedCurrent: Set<string> }).dismissedCurrent.add(
      "c|d",
    );
    h.io.schedulePreferencesSave();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.fake.savePreferences).toHaveBeenCalledTimes(1);
    const arg = h.fake.savePreferences.mock.calls[0][0] as SutraPadPreferences;
    expect(arg.dismissedTagAliases).toEqual(["c|d"]);
  });
});

describe("createPreferencesIO.cancelPreferencesSave", () => {
  it("cancels a pending save before it fires", async () => {
    const h = harness({ dismissed: new Set(["a|b"]) });
    h.io.schedulePreferencesSave();
    h.io.cancelPreferencesSave();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fake.savePreferences).not.toHaveBeenCalled();
  });
});
