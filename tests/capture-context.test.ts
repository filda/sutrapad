import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildScreenSnapshot,
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
} from "../src/lib/capture-context";

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

  it("detects device, operating system, browser and screen snapshots", () => {
    expect(
      detectDeviceType({ mobileHint: true, viewportWidth: 820, screenWidth: 820 }),
    ).toBe("tablet");
    expect(
      detectDeviceType({ maxTouchPoints: 5, viewportWidth: 390, screenWidth: 390 }),
    ).toBe("mobile");
    expect(detectDeviceType({ viewportWidth: 1440, screenWidth: 1440 })).toBe("desktop");

    expect(detectOperatingSystem("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32")).toBe(
      "Windows",
    );
    expect(detectOperatingSystem("Mozilla/5.0 (Linux; Android 14)", "")).toBe("Android");

    expect(
      detectBrowser("Mozilla/5.0 Chrome/123.0 Safari/537.36", [
        { brand: "Not.A/Brand", version: "99" },
        { brand: "Google Chrome", version: "123" },
      ]),
    ).toBe("Google Chrome");
    expect(
      detectBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/17.0 Safari/605.1.15",
      ),
    ).toBe("Safari");

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
        getBattery: async () => ({ level: 0.424, charging: true }),
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
        json: async () => ({
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
        getBattery: async () => ({ level: 0.58, charging: false }),
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
  });
});
