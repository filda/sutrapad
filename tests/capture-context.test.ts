import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildScreenSnapshot,
  resolveCurrentWeather,
  collectCaptureContext,
  computeScrollSnapshot,
  detectBrowser,
  detectDeviceType,
  detectOperatingSystem,
  extractCanonicalUrl,
  extractMetaContent,
  extractPageMetadataFromDocument,
  resolveAmbientLightSnapshot,
  resolveBatterySnapshot,
  resolveMotionStatus,
  resolveNoiseLevelDb,
  resolveSensorsSnapshot,
} from "../src/lib/capture-context";
import type { WindowLike, NavigatorLike } from "../src/lib/capture-context";

function createDocumentStub({
  title = "",
  lang = "",
  referrer = "",
  scrollHeight = 0,
  selectors = {},
}: {
  title?: string;
  lang?: string;
  referrer?: string;
  scrollHeight?: number;
  selectors?: Record<string, Record<string, string> | undefined>;
}): Document {
  return {
    title,
    referrer,
    documentElement: {
      lang,
      scrollHeight,
    },
    querySelector: (selector: string) => {
      const attributes = selectors[selector];
      if (!attributes) {
        return null;
      }

      return {
        getAttribute: (name: string) => attributes[name] ?? null,
      };
    },
  } as unknown as Document;
}

describe("capture context helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("extracts page metadata from a document snapshot", () => {
    const document = createDocumentStub({
      title: "  Example article  ",
      lang: " en ",
      selectors: {
        "meta[name='description']": { content: "  Story summary  " },
        "meta[property='og:title']": { content: "  OG title  " },
        "meta[property='og:description']": { content: "  OG description  " },
        "meta[property='og:image']": { content: "  https://example.com/cover.jpg  " },
        "meta[name='author']": { content: "  Sutra Bot  " },
        "meta[property='article:published_time']": { content: "  2026-04-18T09:00:00Z  " },
        "link[rel='canonical']": { href: "  https://example.com/article  " },
      },
    });

    expect(extractMetaContent(document, "meta[name='description']")).toBe("Story summary");
    expect(extractCanonicalUrl(document)).toBe("https://example.com/article");
    expect(extractPageMetadataFromDocument(document)).toEqual({
      title: "Example article",
      lang: "en",
      description: "Story summary",
      canonicalUrl: "https://example.com/article",
      ogTitle: "OG title",
      ogDescription: "OG description",
      ogImage: "https://example.com/cover.jpg",
      author: "Sutra Bot",
      publishedTime: "2026-04-18T09:00:00Z",
    });
  });

  it("tolerates missing title/lang without throwing (optional chaining path)", () => {
    // Kills OptionalChaining mutants on `document.title?.trim()` and
    // `documentElement.lang?.trim()` — removing the `?.` would throw here.
    const documentStub = {
      title: undefined,
      referrer: "",
      documentElement: { lang: undefined, scrollHeight: 0 },
      querySelector: () => null,
    } as unknown as Document;

    expect(extractPageMetadataFromDocument(documentStub)).toEqual({
      title: undefined,
      lang: undefined,
      description: undefined,
      canonicalUrl: undefined,
      ogTitle: undefined,
      ogDescription: undefined,
      ogImage: undefined,
      author: undefined,
      publishedTime: undefined,
    });
  });

  it("reads canonical URLs and meta content directly", () => {
    expect(extractCanonicalUrl(createDocumentStub({}))).toBeUndefined();
    expect(
      extractMetaContent(createDocumentStub({}), "meta[name='description']"),
    ).toBeUndefined();
  });

  it("computes and clamps scroll progress", () => {
    expect(
      computeScrollSnapshot(
        { innerHeight: 600, scrollX: 12, scrollY: 300 },
        { documentElement: { scrollHeight: 1200 } },
      ),
    ).toEqual({
      x: 12,
      y: 300,
      progress: 0.5,
    });

    expect(
      computeScrollSnapshot(
        { innerHeight: 600, scrollX: 0, scrollY: 999 },
        { documentElement: { scrollHeight: 800 } },
      ),
    ).toEqual({
      x: 0,
      y: 999,
      progress: 1,
    });
  });

  it("reports zero progress when the page is shorter than the viewport", () => {
    // Kills ConditionalExpression / EqualityOperator mutations on `scrollableHeight > 0`:
    // when scrollableHeight is 0, mutations that flip `>` to `>=` would divide by zero
    // and produce NaN instead of the clamped 0.
    expect(
      computeScrollSnapshot(
        { innerHeight: 1000, scrollX: 0, scrollY: 0 },
        { documentElement: { scrollHeight: 600 } },
      ),
    ).toEqual({ x: 0, y: 0, progress: 0 });

    expect(
      computeScrollSnapshot(
        { innerHeight: 1000, scrollX: 0, scrollY: 0 },
        { documentElement: { scrollHeight: 1000 } },
      ),
    ).toEqual({ x: 0, y: 0, progress: 0 });
  });

  // detectDeviceType boundary table — designed to kill EqualityOperator mutants
  // (>= -> >, >= -> <, etc.) on both the mobileHint (>= 768) and touch (>= 900) thresholds.
  it.each([
    [{ mobileHint: true, viewportWidth: 767, screenWidth: 767 }, "mobile"],
    [{ mobileHint: true, viewportWidth: 768, screenWidth: 768 }, "tablet"],
    [{ mobileHint: true, viewportWidth: 820, screenWidth: 820 }, "tablet"],
    [{ mobileHint: true, viewportWidth: 320 }, "mobile"],
    [{ maxTouchPoints: 5, viewportWidth: 390, screenWidth: 390 }, "mobile"],
    [{ maxTouchPoints: 5, viewportWidth: 899, screenWidth: 899 }, "mobile"],
    [{ maxTouchPoints: 5, viewportWidth: 900, screenWidth: 900 }, "tablet"],
    [{ maxTouchPoints: 0, viewportWidth: 1440, screenWidth: 1440 }, "desktop"],
    [{ viewportWidth: 1440, screenWidth: 1440 }, "desktop"],
  ] as const)("detectDeviceType(%j) === %s", (input, expected) => {
    expect(detectDeviceType(input)).toBe(expected);
  });

  // detectOperatingSystem matrix — covers each if-branch twice (platform path + UA path).
  // This kills the LogicalOperator mutants that flip `||` to `&&` and the StringLiteral
  // mutants that swap individual needles.
  it.each([
    ["via platform", "", "Win32", "Windows"],
    ["via UA", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "", "Windows"],
    ["macOS via platform", "", "MacIntel", "macOS"],
    ["macOS via UA", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "", "macOS"],
    ["iOS via platform (iPhone)", "", "iPhone", "iOS"],
    ["iOS via platform (iPad)", "", "iPad", "iOS"],
    ["iOS via UA", "Mozilla/5.0 (iOS 17; CPU)", "", "iOS"],
    ["Android via UA", "Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", "Android"],
    ["Linux via platform", "Mozilla/5.0", "Linux x86_64", "Linux"],
    ["Linux via UA", "Mozilla/5.0 (X11; Linux; rv:120.0) Gecko/20100101", "", "Linux"],
    ["fallback to platform when nothing matches", "Mozilla/5.0 (FreeBSD; rv:120.0)", "FreeBSD", "FreeBSD"],
  ])("detectOperatingSystem (%s)", (_label, userAgent, platform, expected) => {
    expect(detectOperatingSystem(userAgent, platform)).toBe(expected);
  });

  it("returns undefined when no platform or UA signal matches", () => {
    expect(detectOperatingSystem("Mozilla/5.0", "")).toBeUndefined();
    expect(detectOperatingSystem("Mozilla/5.0")).toBeUndefined();
  });

  // detectBrowser table — each case targets one fall-through branch.
  it("picks the first non-Not brand from Client Hints before looking at the UA", () => {
    expect(
      detectBrowser("Mozilla/5.0 Chrome/123.0 Safari/537.36", [
        { brand: "Not.A/Brand", version: "99" },
        { brand: "Google Chrome", version: "123" },
      ]),
    ).toBe("Google Chrome");
  });

  it.each([
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/123.0 Safari/537.36 Edg/123.0.0.0", "Microsoft Edge"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/123.0 Safari/537.36 OPR/105.0.0.0", "Opera"],
    ["Mozilla/5.0 (Windows NT 10.0) Opera/9.80", "Opera"],
    ["Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/115.0", "Firefox"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/123.0 Safari/537.36", "Chrome"],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      "Safari",
    ],
  ])("detects %s as %s", (userAgent, expected) => {
    expect(detectBrowser(userAgent)).toBe(expected);
  });

  it("returns undefined when the UA is unknown and client hints are missing", () => {
    expect(detectBrowser("Mozilla/5.0 SomeObscureBrowser/1.0")).toBeUndefined();
  });

  it("falls back to the UA when Client Hints only contain a Not-brand token", () => {
    expect(
      detectBrowser("Mozilla/5.0 Chrome/120.0 Safari/537.36", [
        { brand: "Not.A/Brand", version: "99" },
      ]),
    ).toBe("Chrome");
  });

  it("builds a screen snapshot from window-like input", () => {
    expect(
      buildScreenSnapshot({
        innerWidth: 1440,
        innerHeight: 900,
        devicePixelRatio: 2,
        screen: {
          width: 1728,
          height: 1117,
          orientation: { type: "landscape-primary" },
        },
        setTimeout,
        clearTimeout,
      }),
    ).toEqual({
      viewportWidth: 1440,
      viewportHeight: 900,
      screenWidth: 1728,
      screenHeight: 1117,
      pixelRatio: 2,
      orientation: "landscape-primary",
    });
  });

  it("resolves battery and ambient light snapshots when supported", async () => {
    await expect(
      resolveBatterySnapshot({
        getBattery: () => Promise.resolve({ level: 0.424, charging: true }),
      }),
    ).resolves.toEqual({
      levelPercent: 42,
      charging: true,
    });

    class FakeAmbientLightSensor {
      public illuminance = 320;
      private listener: (() => void) | null = null;

      addEventListener(_type: string, listener: () => void): void {
        this.listener = listener;
      }

      removeEventListener(): void {
        this.listener = null;
      }

      start(): void {
        this.listener?.();
      }

      stop(): void {}
    }

    await expect(
      resolveAmbientLightSnapshot({
        innerWidth: 1,
        innerHeight: 1,
        AmbientLightSensor: FakeAmbientLightSensor,
        setTimeout,
        clearTimeout,
      }),
    ).resolves.toEqual({
      ambientLightLux: 320,
    });
  });

  it("collects a merged capture snapshot with live and source-page metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({
          current: {
            temperature_2m: 17.5,
            weather_code: 2,
            wind_speed_10m: 8.4,
            is_day: 1,
          },
        }),
      }),
    );

    const context = await collectCaptureContext({
      source: "url-capture",
      currentDate: new Date("2026-04-18T14:00:00.000Z"),
      coordinates: {
        latitude: 50.0755,
        longitude: 14.4378,
      },
      sourceSnapshot: {
        referrer: "https://news.example.com/story",
        scroll: { x: 3, y: 240, progress: 0.4 },
        timeOnPageMs: 4321,
        page: {
          title: "Example page",
          description: "Short summary",
        },
      },
      navigatorLike: {
        language: "en-US",
        languages: ["en-US", "cs-CZ"],
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
        platform: "Win32",
        onLine: true,
        maxTouchPoints: 0,
        connection: {
          effectiveType: "4g",
          rtt: 50,
          downlink: 12.4,
          saveData: false,
        },
        getBattery: () => Promise.resolve({ level: 0.58, charging: false }),
        userAgentData: {
          brands: [
            { brand: "Not.A/Brand", version: "99" },
            { brand: "Google Chrome", version: "123" },
          ],
          mobile: false,
          platform: "Windows",
        },
      },
      currentWindow: {
        innerWidth: 1440,
        innerHeight: 900,
        devicePixelRatio: 2,
        screen: {
          width: 1728,
          height: 1117,
          orientation: { type: "landscape-primary" },
        },
        scrollX: 12,
        scrollY: 345,
        performance: {
          now: () => 9999,
        },
        setTimeout,
        clearTimeout,
      },
      currentDocument: {
        referrer: "https://ignored.example.com/",
        documentElement: {
          scrollHeight: 2200,
        },
      },
    });

    expect(context).toMatchObject({
      source: "url-capture",
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffsetMinutes: -new Date("2026-04-18T14:00:00.000Z").getTimezoneOffset(),
      locale: new Intl.DateTimeFormat().resolvedOptions().locale,
      languages: ["en-US", "cs-CZ"],
      referrer: "https://news.example.com/story",
      deviceType: "desktop",
      os: "Windows",
      browser: "Google Chrome",
      screen: {
        viewportWidth: 1440,
        viewportHeight: 900,
        screenWidth: 1728,
        screenHeight: 1117,
        pixelRatio: 2,
        orientation: "landscape-primary",
      },
      scroll: { x: 3, y: 240, progress: 0.4 },
      timeOnPageMs: 4321,
      page: {
        title: "Example page",
        description: "Short summary",
      },
      network: {
        online: true,
        effectiveType: "4g",
        rtt: 50,
        downlink: 12.4,
        saveData: false,
      },
      battery: {
        levelPercent: 58,
        charging: false,
      },
      weather: {
        temperatureC: 17.5,
        weatherCode: 2,
        windSpeedKmh: 8.4,
        isDay: true,
        source: "open-meteo",
      },
    });
    expect(context.experimental).toBeUndefined();
    expect(context.sensors).toBeUndefined();
  });
});

interface MotionAxes {
  x?: number | null;
  y?: number | null;
  z?: number | null;
}

/**
 * A `WindowLike` whose fake `addEventListener` synchronously replays the given
 * `devicemotion` events, and whose `setTimeout` defers the resolver's `finish`
 * to a microtask — so the listener is registered and every event delivered
 * before classification runs.
 */
function createMotionWindow(
  events: ReadonlyArray<{ accelerationIncludingGravity?: MotionAxes | null; acceleration?: MotionAxes | null }>,
  deviceMotionEvent?: { requestPermission?: () => Promise<string> },
): WindowLike {
  return {
    innerWidth: 1,
    innerHeight: 1,
    setTimeout: ((callback: () => void) => {
      queueMicrotask(callback);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout,
    addEventListener: (type, listener) => {
      if (type !== "devicemotion") return;
      for (const event of events) listener(event);
    },
    removeEventListener: () => {},
    DeviceMotionEvent: deviceMotionEvent,
  } as WindowLike;
}

function gravity(magnitudes: readonly number[]): Array<{ accelerationIncludingGravity: MotionAxes }> {
  return magnitudes.map((x) => ({ accelerationIncludingGravity: { x, y: 0, z: 0 } }));
}

/** A touch-capable navigator — motion sampling only runs on devices like this. */
const MOBILE_NAV: NavigatorLike = { maxTouchPoints: 5 };

function createNoiseEnv({
  state = "granted",
  fill = 0.1,
  rejectGetUserMedia = false,
}: {
  state?: string;
  fill?: number;
  rejectGetUserMedia?: boolean;
}): {
  currentWindow: WindowLike;
  navigatorLike: NavigatorLike;
  stop: () => void;
  close: () => void;
  calls: {
    queryArg?: { name: string };
    constraints?: { audio: boolean };
    fftSize?: number;
    createdAnalyser?: unknown;
    sourceStream?: unknown;
    connectArg?: unknown;
  };
} {
  const stop = vi.fn();
  const close = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  const calls: {
    queryArg?: { name: string };
    constraints?: { audio: boolean };
    fftSize?: number;
    createdAnalyser?: unknown;
    sourceStream?: unknown;
    connectArg?: unknown;
  } = {};
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData: (array: Float32Array) => {
      calls.fftSize = analyser.fftSize;
      array.fill(fill);
    },
  };
  calls.createdAnalyser = analyser;
  const audioContext = {
    createAnalyser: () => analyser,
    createMediaStreamSource: (source: unknown) => {
      calls.sourceStream = source;
      return {
        connect: (destination: unknown) => {
          calls.connectArg = destination;
        },
      };
    },
    close,
  };
  return {
    stop,
    close,
    calls,
    currentWindow: {
      innerWidth: 1,
      innerHeight: 1,
      AudioContext: function AudioContextStub() {
        return audioContext;
      } as unknown as WindowLike["AudioContext"],
      setTimeout,
      clearTimeout,
    } as WindowLike,
    navigatorLike: {
      maxTouchPoints: 5,
      permissions: {
        query: (descriptor: { name: PermissionName }) => {
          calls.queryArg = descriptor;
          return Promise.resolve({ state });
        },
      },
      mediaDevices: {
        getUserMedia: (constraints: { audio: boolean }) => {
          calls.constraints = constraints;
          return rejectGetUserMedia
            ? Promise.reject(new Error("denied"))
            : Promise.resolve(stream);
        },
      },
    },
  };
}

describe("capture context sensors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies device motion from accelerometer samples", async () => {
    // Magnitudes 8,12,7,13,9 -> high variance -> moving.
    await expect(
      resolveMotionStatus(createMotionWindow(gravity([8, 12, 7, 13, 9])), MOBILE_NAV),
    ).resolves.toBe("moving");
    // Near-constant ~9.81 -> still.
    await expect(
      resolveMotionStatus(createMotionWindow(gravity([9.81, 9.82, 9.8, 9.81, 9.79])), MOBILE_NAV),
    ).resolves.toBe("still");
  });

  it("falls back to `acceleration` when gravity-inclusive data is absent", async () => {
    const window = createMotionWindow(
      [8, 12, 7, 13].map((x) => ({ acceleration: { x, y: 0, z: 0 } })),
    );
    await expect(resolveMotionStatus(window, MOBILE_NAV)).resolves.toBe("moving");
  });

  it("skips motion sampling on a device with no touch capability", async () => {
    // A desktop / headless DOM exposes the listener API but no accelerometer;
    // sampling there would block capture for the whole window. The touch gate
    // short-circuits before any listener is registered.
    await expect(
      resolveMotionStatus(createMotionWindow(gravity([8, 12, 7, 13])), { maxTouchPoints: 0 }),
    ).resolves.toBeUndefined();
    await expect(
      resolveMotionStatus(createMotionWindow(gravity([8, 12, 7, 13])), {}),
    ).resolves.toBeUndefined();
  });

  it("samples motion when the userAgentData mobile hint is set", async () => {
    await expect(
      resolveMotionStatus(createMotionWindow(gravity([8, 12, 7, 13])), {
        userAgentData: { mobile: true },
      }),
    ).resolves.toBe("moving");
  });

  it("returns undefined when no motion listener is available", async () => {
    await expect(
      resolveMotionStatus(
        { innerWidth: 1, innerHeight: 1, setTimeout, clearTimeout } as WindowLike,
        MOBILE_NAV,
      ),
    ).resolves.toBeUndefined();
  });

  it("honours the iOS motion permission gate", async () => {
    const events = gravity([8, 12, 7, 13]);

    await expect(
      resolveMotionStatus(
        createMotionWindow(events, { requestPermission: () => Promise.resolve("granted") }),
        MOBILE_NAV,
      ),
    ).resolves.toBe("moving");

    await expect(
      resolveMotionStatus(
        createMotionWindow(events, { requestPermission: () => Promise.resolve("denied") }),
        MOBILE_NAV,
      ),
    ).resolves.toBeUndefined();

    await expect(
      resolveMotionStatus(
        createMotionWindow(events, { requestPermission: () => Promise.reject(new Error("no gesture")) }),
        MOBILE_NAV,
      ),
    ).resolves.toBeUndefined();
  });

  it("measures noise as dBFS when the microphone permission is already granted", async () => {
    const env = createNoiseEnv({ state: "granted", fill: 0.1 });
    // rms 0.1 -> 20*log10(0.1) = -20.
    await expect(resolveNoiseLevelDb(env.currentWindow, env.navigatorLike)).resolves.toBe(-20);
    // Checks the exact mic permission descriptor and capture constraints.
    expect(env.calls.queryArg).toEqual({ name: "microphone" });
    expect(env.calls.constraints).toEqual({ audio: true });
    // The analyser is configured to the documented window and the mic stream
    // is routed into it.
    expect(env.calls.fftSize).toBe(2048);
    expect(env.calls.sourceStream).toBeDefined();
    expect(env.calls.connectArg).toBe(env.calls.createdAnalyser);
    // Stream is released and the context closed even on the success path.
    expect(env.stop).toHaveBeenCalledTimes(1);
    expect(env.close).toHaveBeenCalledTimes(1);
  });

  it("never opens the mic unless permission is already granted", async () => {
    const env = createNoiseEnv({ state: "prompt" });
    await expect(resolveNoiseLevelDb(env.currentWindow, env.navigatorLike)).resolves.toBeUndefined();
    expect(env.stop).not.toHaveBeenCalled();
  });

  it("returns undefined and releases nothing when getUserMedia rejects", async () => {
    const env = createNoiseEnv({ state: "granted", rejectGetUserMedia: true });
    await expect(resolveNoiseLevelDb(env.currentWindow, env.navigatorLike)).resolves.toBeUndefined();
    expect(env.stop).not.toHaveBeenCalled();
  });

  it("does not open the microphone when AudioContext is unavailable", async () => {
    // The AudioContext guard is a real privacy guarantee, not just an
    // optimisation: if we can't analyse audio we must not even prompt/open
    // the mic. So getUserMedia must never be called when AudioContext is gone.
    const env = createNoiseEnv({ state: "granted" });
    const windowWithoutAudio = { ...env.currentWindow, AudioContext: undefined } as WindowLike;
    await expect(resolveNoiseLevelDb(windowWithoutAudio, env.navigatorLike)).resolves.toBeUndefined();
    expect(env.calls.constraints).toBeUndefined();
    expect(env.stop).not.toHaveBeenCalled();
  });

  it("returns undefined when the audio APIs are missing", async () => {
    await expect(
      resolveNoiseLevelDb({ innerWidth: 1, innerHeight: 1, setTimeout, clearTimeout } as WindowLike, {}),
    ).resolves.toBeUndefined();
  });

  it("merges both sensors into one snapshot", async () => {
    const noiseEnv = createNoiseEnv({ state: "granted", fill: 0.1 });
    // Compose: motion plumbing from one window, audio plumbing from the other.
    const currentWindow = {
      ...createMotionWindow(gravity([8, 12, 7, 13])),
      AudioContext: noiseEnv.currentWindow.AudioContext,
    } as WindowLike;

    await expect(resolveSensorsSnapshot(currentWindow, noiseEnv.navigatorLike)).resolves.toEqual({
      motionStatus: "moving",
      noiseLevelDb: -20,
    });
  });

  it("returns undefined when neither sensor produced a reading", async () => {
    await expect(
      resolveSensorsSnapshot(
        { innerWidth: 1, innerHeight: 1, setTimeout, clearTimeout } as WindowLike,
        {},
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps a partial snapshot when only one sensor reads", async () => {
    // Touch-capable navigator with no audio APIs: motion reads, noise doesn't.
    await expect(
      resolveSensorsSnapshot(createMotionWindow(gravity([9.81, 9.82, 9.8, 9.81])), {
        maxTouchPoints: 5,
      }),
    ).resolves.toEqual({ motionStatus: "still", noiseLevelDb: undefined });
  });

  it("keeps a partial snapshot when only noise reads", async () => {
    // createNoiseEnv's window has no motion listener, so motion stays
    // undefined while noise resolves -> exercises the other half of the
    // combiner's AND guard.
    const env = createNoiseEnv({ state: "granted", fill: 0.1 });
    await expect(resolveSensorsSnapshot(env.currentWindow, env.navigatorLike)).resolves.toEqual({
      motionStatus: undefined,
      noiseLevelDb: -20,
    });
  });
});

// ---------------------------------------------------------------------------
// Gap-closing block added 2026-08-19 after a focused mutation run put this
// file at 84.7 % with 35 survivors. Each describe below targets a branch the
// original suite reached but never discriminated — mostly "the guard that
// converts a hostile browser API into `undefined`", which is the whole job of
// this module: capture must never throw, and must never invent a reading.
//
// What is left in the report afterwards is equivalent by construction, and
// there is one recurring shape worth naming: **an empty `catch {}` is
// indistinguishable from `catch { return undefined; }` when the function ends
// right after the try/catch** — control falls out of the block and the
// function returns `undefined` either way. That covers the catch blocks in
// `resolveBatterySnapshot`, `resolveAmbientLightSnapshot`,
// `resolveCurrentWeather` and `resolveNoiseLevelDb`. The one exception is
// `resolveMotionStatus`'s permission catch, where code follows the block — so
// that one *is* asserted below.
//
// Also equivalent: the `?? ""` fallbacks on `platform` and `userAgent` (a junk
// string matches none of the sniffing branches, so it behaves like the empty
// one), and the `typeof addEventListener !== "function"` half of the motion
// guard (with no way to subscribe, the sampling path still ends at
// `classifyMotion([])` → `undefined`; the `removeEventListener` half is the
// killable one and is covered).
//
// After this block the file measures **220 / 229 (96.1 %)**. The nine left are
// the four empty-catch pairs, the two `?? ""` fallbacks, the `addEventListener`
// half of the motion guard, and the redundant `?.` before `trim()` (the chain
// already short-circuits at `?.brand`). `resolveMotionStatus`'s permission
// catch is reported as NoCoverage rather than Killed because Stryker's
// per-test coverage cannot attribute an async continuation to the test that
// awaited it — the assertion for it is real, see "gives up when the iOS
// permission gate throws".
// ---------------------------------------------------------------------------

/** Ambient-light sensor fake whose listeners are keyed by event type. */
function createAmbientSensor({
  illuminance = 320 as unknown,
  emit = true,
  throwOnConstruct = false,
}: { illuminance?: unknown; emit?: boolean; throwOnConstruct?: boolean } = {}) {
  const calls: {
    added: string[];
    removed: string[];
    stopped: number;
    started: number;
    cleared?: unknown;
  } = { added: [], removed: [], stopped: 0, started: 0 };
  const listeners = new Map<string, Array<() => void>>();

  class FakeSensor {
    illuminance = illuminance;
    constructor() {
      if (throwOnConstruct) throw new Error("sensor unavailable");
    }
    addEventListener(type: string, listener: () => void): void {
      calls.added.push(type);
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }
    removeEventListener(type: string, listener: () => void): void {
      calls.removed.push(type);
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener),
      );
    }
    stop(): void {
      calls.stopped += 1;
    }
    start(): void {
      calls.started += 1;
      // A real sensor fires asynchronously; firing on `start` keeps the test
      // synchronous while still going through the listener registry, so the
      // registered event *name* is load-bearing.
      if (emit) for (const listener of listeners.get("reading") ?? []) listener();
    }
  }

  const timeouts: Array<() => void> = [];
  const currentWindow = {
    innerWidth: 1,
    innerHeight: 1,
    AmbientLightSensor: FakeSensor as unknown as WindowLike["AmbientLightSensor"],
    setTimeout: ((callback: () => void) => {
      timeouts.push(callback);
      return 7 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: ((handle: unknown) => {
      calls.cleared = handle;
    }) as unknown as typeof clearTimeout,
  } as WindowLike & { AmbientLightSensor: unknown };

  return { currentWindow, calls, timeouts };
}

describe("capture context device and browser detection edges", () => {
  it("sizes a mobile-hinted device by its widest dimension", () => {
    // A phone reports a narrow viewport and a wide screen (or vice versa after
    // a rotation). Taking the smaller of the two would file every tablet as a
    // phone.
    expect(
      detectDeviceType({ mobileHint: true, viewportWidth: 500, screenWidth: 1400 }),
    ).toBe("tablet");
    expect(
      detectDeviceType({ mobileHint: true, viewportWidth: 400, screenWidth: 600 }),
    ).toBe("mobile");
  });

  it("sizes a touch device by its widest dimension too", () => {
    expect(
      detectDeviceType({ maxTouchPoints: 5, viewportWidth: 600, screenWidth: 1200 }),
    ).toBe("tablet");
    expect(
      detectDeviceType({ maxTouchPoints: 5, viewportWidth: 600, screenWidth: 800 }),
    ).toBe("mobile");
  });

  it("skips the placeholder brand Chromium sends", () => {
    // `userAgentData.brands` always carries a decoy entry ("Not/A)Brand" and
    // friends) to keep sniffers honest; picking it would name the browser
    // after the anti-fingerprinting filler.
    expect(
      detectBrowser("Mozilla/5.0 Chrome/123.0", [
        { brand: "Not/A)Brand", version: "8" },
        { brand: "Chromium", version: "123" },
      ]),
    ).toBe("Chromium");
  });

  it("trims the brand string it reports", () => {
    // Chromium pads brand entries in some builds; an untrimmed value ends up
    // in the note's captured context and in every downstream comparison.
    expect(
      detectBrowser("Mozilla/5.0 Chrome/123.0", [{ brand: "  Chromium  ", version: "123" }]),
    ).toBe("Chromium");
  });

  it("falls back to the user agent when every brand is a decoy", () => {
    // `find` returns undefined here, so the whole `?.brand?.trim()` chain has
    // to stay optional — otherwise capture throws on a browser that only
    // reports decoys.
    expect(
      detectBrowser("Mozilla/5.0 Firefox/126.0", [{ brand: "Not.A/Brand", version: "99" }]),
    ).toBe("Firefox");
  });
});

describe("capture context battery edges", () => {
  it("reports no charging verdict when the API returns a non-boolean", () => {
    return expect(
      resolveBatterySnapshot({
        getBattery: () =>
          Promise.resolve({ level: 0.5, charging: "yes" } as unknown as { level: number; charging: boolean }),
      }),
    ).resolves.toEqual({ levelPercent: 50, charging: undefined });
  });

  it("survives a getBattery that rejects", () => {
    return expect(
      resolveBatterySnapshot({ getBattery: () => Promise.reject(new Error("no battery")) }),
    ).resolves.toBeUndefined();
  });
});

describe("capture context ambient light edges", () => {
  it("reads the illuminance through a 'reading' listener and cleans up after itself", async () => {
    const { currentWindow, calls } = createAmbientSensor({ illuminance: 42 });

    await expect(resolveAmbientLightSnapshot(currentWindow)).resolves.toEqual({
      ambientLightLux: 42,
    });

    expect(calls.added).toEqual(["reading"]);
    // Cleanup is what stops a sensor from streaming for the rest of the
    // session: the same event name comes off, the timer is cleared, the
    // hardware is stopped.
    expect(calls.removed).toEqual(["reading"]);
    expect(calls.cleared).toBe(7);
    expect(calls.stopped).toBe(1);
  });

  it("gives up when the sensor never reports a reading", async () => {
    const { currentWindow, calls, timeouts } = createAmbientSensor({ emit: false });

    const pending = resolveAmbientLightSnapshot(currentWindow);
    // Fire the 150 ms bail-out the sensor path arms.
    for (const callback of timeouts) callback();

    await expect(pending).resolves.toBeUndefined();
    expect(calls.removed).toEqual(["reading"]);
    expect(calls.stopped).toBe(1);
  });

  it("reports nothing when the reading is not a number", async () => {
    const { currentWindow } = createAmbientSensor({ illuminance: "bright" });

    await expect(resolveAmbientLightSnapshot(currentWindow)).resolves.toBeUndefined();
  });

  it("survives a sensor constructor that throws", async () => {
    const { currentWindow } = createAmbientSensor({ throwOnConstruct: true });

    await expect(resolveAmbientLightSnapshot(currentWindow)).resolves.toBeUndefined();
  });
});

describe("capture context motion edges", () => {
  it("refuses to sample without a way to unsubscribe", async () => {
    // Registering a `devicemotion` listener we can never remove would keep the
    // accelerometer awake for the rest of the session.
    const events = gravity([8, 12, 7, 13]);
    const noRemove = {
      innerWidth: 1,
      innerHeight: 1,
      setTimeout: ((callback: () => void) => {
        queueMicrotask(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: (() => {}) as typeof clearTimeout,
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type !== "devicemotion") return;
        for (const event of events) listener(event);
      },
    } as unknown as WindowLike;

    await expect(resolveMotionStatus(noRemove, MOBILE_NAV)).resolves.toBeUndefined();
  });

  it("unsubscribes from the same event it subscribed to", async () => {
    // A mismatched name leaves the accelerometer listener attached for the
    // rest of the session — invisible in a fake that fires synchronously, so
    // the event name is asserted directly.
    const removed: string[] = [];
    const events = gravity([8, 12, 7, 13]);
    const window = {
      innerWidth: 1,
      innerHeight: 1,
      setTimeout: ((callback: () => void) => {
        queueMicrotask(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: (() => {}) as typeof clearTimeout,
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type !== "devicemotion") return;
        for (const event of events) listener(event);
      },
      removeEventListener: (type: string) => {
        removed.push(type);
      },
    } as unknown as WindowLike;

    await resolveMotionStatus(window, MOBILE_NAV);

    expect(removed).toEqual(["devicemotion"]);
  });

  it("stops at the sample cap instead of listening to the whole window", async () => {
    // 32 near-identical samples (still) followed by eight violent ones. The cap
    // means the verdict comes from the first 32 — without it, or with an
    // off-by-one, the outliers leak in and the verdict flips to "moving".
    const samples = [...Array.from({ length: 32 }, () => 9.81), ...Array.from({ length: 8 }, () => 50)];

    await expect(
      resolveMotionStatus(createMotionWindow(gravity(samples)), MOBILE_NAV),
    ).resolves.toBe("still");
  });

  it("gives up when the iOS permission gate throws", async () => {
    // `requestPermission` rejects on a cross-origin iframe; capture must fall
    // through to "no verdict" rather than sampling anyway.
    const window = createMotionWindow(gravity([8, 12, 7, 13]), {
      requestPermission: () => Promise.reject(new Error("blocked")),
    });

    await expect(resolveMotionStatus(window, MOBILE_NAV)).resolves.toBeUndefined();
  });
});

/** Replaces global `fetch` with a stub resolving to `response`. */
function stubFetch(response: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("capture context weather", () => {
  const PRAGUE = { latitude: 50.0755, longitude: 14.4378 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks open-meteo for exactly the four fields the snapshot needs", async () => {
    const fetchMock = stubFetch({ ok: true, json: () => ({ current: {} }) });

    await resolveCurrentWeather(PRAGUE);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("50.0755");
    expect(url.searchParams.get("longitude")).toBe("14.4378");
    // Dropping a field here silently blanks that part of every capture.
    expect(url.searchParams.get("current")).toBe(
      "temperature_2m,weather_code,wind_speed_10m,is_day",
    );
    // One day is all the snapshot reads; a wider forecast is wasted payload.
    expect(url.searchParams.get("forecast_days")).toBe("1");
  });

  it("maps a full payload onto the snapshot", async () => {
    stubFetch({
      ok: true,
      json: () => ({
        current: { temperature_2m: 17.5, weather_code: 2, wind_speed_10m: 8.4, is_day: 1 },
      }),
    });

    await expect(resolveCurrentWeather(PRAGUE)).resolves.toEqual({
      temperatureC: 17.5,
      weatherCode: 2,
      windSpeedKmh: 8.4,
      isDay: true,
      source: "open-meteo",
    });
  });

  it("reads is_day: 0 as night, and a missing is_day as no verdict", async () => {
    stubFetch({ ok: true, json: () => ({ current: { is_day: 0 } }) });
    await expect(resolveCurrentWeather(PRAGUE)).resolves.toMatchObject({ isDay: false });

    vi.unstubAllGlobals();
    stubFetch({ ok: true, json: () => ({ current: { temperature_2m: 3 } }) });
    await expect(resolveCurrentWeather(PRAGUE)).resolves.toMatchObject({ isDay: undefined });
  });

  it("ignores a body that arrives with a non-OK status", async () => {
    // The gate is only observable with a parseable body: an error page that
    // happens to be valid JSON would otherwise be read as a forecast.
    stubFetch({
      ok: false,
      json: () => ({ current: { temperature_2m: -99, is_day: 1 } }),
    });

    await expect(resolveCurrentWeather(PRAGUE)).resolves.toBeUndefined();
  });

  it("returns nothing when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(resolveCurrentWeather(PRAGUE)).resolves.toBeUndefined();
  });

  it("does not call out at all without coordinates", async () => {
    const fetchMock = stubFetch({ ok: true, json: () => ({}) });

    await expect(resolveCurrentWeather(undefined)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("capture context assembly edges", () => {
  const NO_WEATHER = { ok: false, json: () => ({}) };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(NO_WEATHER));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Minimal live environment: no sensors, no battery, nothing async. */
  const bareWindow = { innerWidth: 1024, innerHeight: 768 } as WindowLike;

  it("keeps a partly-filled page snapshot from the source page", async () => {
    // The bookmarklet often captures a title but no description. Requiring
    // *every* field to be present would throw the whole snapshot away.
    const context = await collectCaptureContext({
      source: "url-capture",
      currentWindow: bareWindow,
      currentDocument: createDocumentStub({}),
      navigatorLike: {},
      sourceSnapshot: { page: { title: "Example page", description: undefined } },
    });

    expect(context.page?.title).toBe("Example page");
  });

  it("drops a page snapshot with nothing in it", async () => {
    const context = await collectCaptureContext({
      source: "url-capture",
      currentWindow: bareWindow,
      currentDocument: createDocumentStub({}),
      navigatorLike: {},
      sourceSnapshot: { page: { title: undefined } },
    });

    expect(context.page).toBeUndefined();
  });

  it("falls back to navigator.platform when userAgentData has no platform", async () => {
    // Chromium exposes `userAgentData` without `platform` in some embedded
    // builds; losing the fallback would blank the OS for those users.
    const context = await collectCaptureContext({
      source: "url-capture",
      currentWindow: bareWindow,
      currentDocument: createDocumentStub({}),
      navigatorLike: {
        platform: "Win32",
        userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/123.0",
        userAgentData: { mobile: false },
      },
    });

    expect(context.os).toBe("Windows");
  });

  it("takes the referrer from the live document when the capture carried none", async () => {
    const context = await collectCaptureContext({
      source: "new-note",
      currentWindow: bareWindow,
      currentDocument: createDocumentStub({ referrer: "https://news.example.com/story" }),
      navigatorLike: {},
    });

    expect(context.referrer).toBe("https://news.example.com/story");
  });

  it("classifies the device from the live navigator and screen", async () => {
    // The whole options bag has to reach `detectDeviceType`: with an empty one
    // every capture would claim "desktop".
    const context = await collectCaptureContext({
      source: "new-note",
      currentWindow: { innerWidth: 390, innerHeight: 844 } as WindowLike,
      currentDocument: createDocumentStub({}),
      navigatorLike: { userAgentData: { mobile: true } },
    });

    expect(context.deviceType).toBe("mobile");
  });

  it("prefers the Intl locale over navigator.language", async () => {
    // `resolvedOptions().locale` is the one the app formats dates with, so the
    // capture has to record that rather than the raw navigator string.
    const intlLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
    const context = await collectCaptureContext({
      source: "new-note",
      currentWindow: bareWindow,
      currentDocument: createDocumentStub({}),
      navigatorLike: { language: "xx-XX" },
    });

    expect(context.locale).toBe(intlLocale);
    expect(context.locale).not.toBe("xx-XX");
  });
});

// --- Gap-closing block, 2026-08-29 ------------------------------------------

describe("motion sampling cleans up after itself", () => {
  it("cancels the sampling window when the sample cap ends it early", async () => {
    // `finish` runs on whichever comes first: the timeout, or the sample cap.
    // When the cap wins the timer is still armed — and without the
    // `clearTimeout` it fires later into an already-resolved promise. Nothing
    // user-visible breaks, which is exactly why nobody noticed: on a page that
    // captures repeatedly the timers just pile up.
    //
    // The assertion is on the injected window because the promise has already
    // settled by then and there is no other observable. `removeEventListener`
    // is asserted alongside it so this pins the whole teardown, not one call.
    const cleared: unknown[] = [];
    const removed: string[] = [];
    const base = createMotionWindow(gravity(Array.from({ length: 40 }, () => 9.81)));
    const currentWindow = {
      ...base,
      clearTimeout: ((handle: unknown) => {
        cleared.push(handle);
      }) as unknown as typeof clearTimeout,
      removeEventListener: ((type: string) => {
        removed.push(type);
      }) as WindowLike["removeEventListener"],
    } as WindowLike;

    await resolveMotionStatus(currentWindow, MOBILE_NAV);

    // The fake replays every event in one synchronous loop and ignores
    // `removeEventListener`, so `finish` runs once per surplus event past the
    // cap. That is a harness artifact, not a source bug — in a real DOM the
    // removal stops the next one. What matters is that the teardown ran at
    // all, with the handle the sampler was given.
    expect(cleared.length).toBeGreaterThan(0);
    expect(new Set(cleared)).toEqual(new Set([1]));
    expect(new Set(removed)).toEqual(new Set(["devicemotion"]));
  });
});
