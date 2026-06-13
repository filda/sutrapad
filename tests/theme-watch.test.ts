// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveThemeId,
  type ThemeChoice,
  watchAutoTheme,
} from "../src/app/logic/theme";

/**
 * DOM-bound coverage for the two theme helpers that read the OS dark-mode
 * preference through `window.matchMedia` — `resolveThemeId`'s default
 * `darkMedia` parameter and the whole `watchAutoTheme` subscription. The
 * node-env `theme.test.ts` always injects an explicit `DarkSchemeMedia`, so
 * the live `matchMedia` path and the change-handler body have no coverage
 * there. happy-dom gives us a real `document.documentElement` to observe the
 * re-applied `data-theme`; it ships no `matchMedia`, so each test installs a
 * controllable fake.
 */
type MatchMediaFn = (query: string) => MediaQueryList;

interface FakeMedia {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  /** Invoke every registered `change` listener, simulating an OS flip. */
  emitChange: () => void;
}

function installMatchMedia(matches: boolean): {
  media: FakeMedia;
  spy: ReturnType<typeof vi.fn>;
} {
  const changeListeners: Array<() => void> = [];
  const media: FakeMedia = {
    matches,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === "change") changeListeners.push(listener);
    }),
    emitChange: () => {
      for (const listener of changeListeners) listener();
    },
  };
  const spy = vi.fn(() => media);
  (window as unknown as { matchMedia: MatchMediaFn }).matchMedia =
    spy as unknown as MatchMediaFn;
  return { media, spy };
}

function removeMatchMedia(): void {
  (
    window as unknown as { matchMedia: MatchMediaFn | undefined }
  ).matchMedia = undefined;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

const autoChoice = (): ThemeChoice => "auto";

afterEach(() => {
  removeMatchMedia();
  delete document.documentElement.dataset.theme;
});

describe("resolveThemeId — default matchMedia parameter", () => {
  it("maps auto to dark by reading the live matchMedia preference", () => {
    const { spy } = installMatchMedia(true);
    expect(resolveThemeId("auto")).toBe("dark");
    expect(spy).toHaveBeenCalledWith(DARK_QUERY);
  });

  it("maps auto to sand when the live matchMedia reports a light preference", () => {
    installMatchMedia(false);
    expect(resolveThemeId("auto")).toBe("sand");
  });

  it("falls back to sand for auto when matchMedia is unavailable", () => {
    removeMatchMedia();
    expect(resolveThemeId("auto")).toBe("sand");
  });

  it("returns a concrete choice unchanged even though the default param reads matchMedia", () => {
    installMatchMedia(true);
    expect(resolveThemeId("forest")).toBe("forest");
  });
});

describe("watchAutoTheme", () => {
  it("returns null when matchMedia is unavailable", () => {
    removeMatchMedia();
    expect(watchAutoTheme(() => "auto")).toBeNull();
  });

  it("subscribes to the dark-scheme change event and returns the media list", () => {
    const { media, spy } = installMatchMedia(false);
    const result = watchAutoTheme(() => "auto");
    expect(result).toBe(media);
    expect(spy).toHaveBeenCalledWith(DARK_QUERY);
    expect(media.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("re-applies the resolved theme on an OS change while the user is on auto", () => {
    const { media } = installMatchMedia(true);
    watchAutoTheme(() => "auto");
    // Sentinel different from the dark resolution so we can see the re-apply.
    document.documentElement.dataset.theme = "sand";
    media.emitChange();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("does not re-apply when the user is on a concrete (non-auto) theme", () => {
    const { media } = installMatchMedia(true);
    watchAutoTheme(() => "forest");
    document.documentElement.dataset.theme = "sand";
    media.emitChange();
    expect(document.documentElement.dataset.theme).toBe("sand");
  });

  it("tolerates a MediaQueryList that lacks addEventListener without throwing", () => {
    // Some older WebKit builds expose a `MediaQueryList` without the
    // `addEventListener` method; the `?.` guard in `watchAutoTheme` must keep
    // the subscription a no-op rather than crashing theme setup on load.
    const media = { matches: true } as unknown as MediaQueryList;
    (window as unknown as { matchMedia: MatchMediaFn }).matchMedia =
      (() => media) as unknown as MatchMediaFn;
    expect(() => watchAutoTheme(autoChoice)).not.toThrow();
  });

  it("reads the current choice fresh on each change event", () => {
    const { media } = installMatchMedia(true);
    let choice: ThemeChoice = "forest";
    watchAutoTheme(() => choice);
    document.documentElement.dataset.theme = "sand";
    media.emitChange();
    expect(document.documentElement.dataset.theme).toBe("sand");
    choice = "auto";
    media.emitChange();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
