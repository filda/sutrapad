import type {
  SutraPadCaptureBatterySnapshot,
  SutraPadCaptureContext,
  SutraPadCaptureExperimentalSnapshot,
  SutraPadCapturePageMetadata,
  SutraPadCaptureScreenSnapshot,
  SutraPadCaptureScrollSnapshot,
  SutraPadCaptureWeatherSnapshot,
  SutraPadCoordinates,
} from "../types";

interface NavigatorConnectionLike {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
}

interface BatteryManagerLike {
  level?: number;
  charging?: boolean;
}

interface NavigatorLike {
  language?: string;
  languages?: readonly string[];
  userAgent?: string;
  platform?: string;
  onLine?: boolean;
  maxTouchPoints?: number;
  connection?: NavigatorConnectionLike;
  getBattery?: () => Promise<BatteryManagerLike>;
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    platform?: string;
  };
}

interface WindowLike {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio?: number;
  screen?: {
    width?: number;
    height?: number;
    orientation?: {
      type?: string;
    };
  };
  scrollX?: number;
  scrollY?: number;
  performance?: {
    now?: () => number;
  };
  AmbientLightSensor?: new () => {
    illuminance?: number;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
    start: () => void;
    stop?: () => void;
  };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

interface DocumentLike {
  referrer?: string;
  documentElement?: {
    lang?: string;
    scrollHeight?: number;
  };
}

export function extractMetaContent(document: Document, selector: string): string | undefined {
  const element = document.querySelector(selector);
  const content = element?.getAttribute("content")?.trim();
  return content || undefined;
}

export function extractCanonicalUrl(document: Document): string | undefined {
  const canonical = document.querySelector("link[rel='canonical']")?.getAttribute("href")?.trim();
  return canonical || undefined;
}

export function extractPageMetadataFromDocument(document: Document): SutraPadCapturePageMetadata {
  const title = document.title?.trim() || undefined;
  const lang = document.documentElement.lang?.trim() || undefined;

  return {
    title,
    lang,
    description: extractMetaContent(document, "meta[name='description']"),
    canonicalUrl: extractCanonicalUrl(document),
    ogTitle: extractMetaContent(document, "meta[property='og:title']"),
    ogDescription: extractMetaContent(document, "meta[property='og:description']"),
    ogImage: extractMetaContent(document, "meta[property='og:image']"),
    author: extractMetaContent(document, "meta[name='author']"),
    publishedTime: extractMetaContent(document, "meta[property='article:published_time']"),
  };
}

export function computeScrollSnapshot(
  currentWindow: Pick<WindowLike, "innerHeight" | "scrollX" | "scrollY">,
  currentDocument: Pick<DocumentLike, "documentElement">,
): SutraPadCaptureScrollSnapshot {
  const x = currentWindow.scrollX ?? 0;
  const y = currentWindow.scrollY ?? 0;
  const scrollHeight = currentDocument.documentElement?.scrollHeight ?? 0;
  const scrollableHeight = Math.max(scrollHeight - currentWindow.innerHeight, 0);
  const progress = scrollableHeight > 0 ? Math.min(Math.max(y / scrollableHeight, 0), 1) : 0;

  return {
    x,
    y,
    progress,
  };
}

export function detectDeviceType({
  mobileHint,
  maxTouchPoints,
  viewportWidth,
  screenWidth,
}: {
  mobileHint?: boolean;
  maxTouchPoints?: number;
  viewportWidth?: number;
  screenWidth?: number;
}): "mobile" | "tablet" | "desktop" {
  if (mobileHint) {
    const referenceWidth = Math.max(viewportWidth ?? 0, screenWidth ?? 0);
    return referenceWidth >= 768 ? "tablet" : "mobile";
  }

  if ((maxTouchPoints ?? 0) > 0) {
    const referenceWidth = Math.max(viewportWidth ?? 0, screenWidth ?? 0);
    return referenceWidth >= 900 ? "tablet" : "mobile";
  }

  return "desktop";
}

export function detectOperatingSystem(userAgent: string, platform?: string): string | undefined {
  const normalizedPlatform = platform?.toLowerCase() ?? "";
  const normalizedUserAgent = userAgent.toLowerCase();

  if (normalizedPlatform.includes("win") || normalizedUserAgent.includes("windows")) {
    return "Windows";
  }
  if (normalizedPlatform.includes("mac") || normalizedUserAgent.includes("mac os")) {
    return "macOS";
  }
  if (normalizedPlatform.includes("iphone") || normalizedPlatform.includes("ipad") || normalizedUserAgent.includes("ios")) {
    return "iOS";
  }
  if (normalizedUserAgent.includes("android")) {
    return "Android";
  }
  if (normalizedPlatform.includes("linux") || normalizedUserAgent.includes("linux")) {
    return "Linux";
  }

  return platform || undefined;
}

export function detectBrowser(
  userAgent: string,
  brands?: Array<{ brand: string; version: string }>,
): string | undefined {
  const preferredBrand = brands?.find((entry) => !entry.brand.includes("Not"))?.brand?.trim();
  if (preferredBrand) {
    return preferredBrand;
  }

  if (userAgent.includes("Edg/")) {
    return "Microsoft Edge";
  }
  if (userAgent.includes("OPR/") || userAgent.includes("Opera")) {
    return "Opera";
  }
  if (userAgent.includes("Firefox/")) {
    return "Firefox";
  }
  if (userAgent.includes("Chrome/")) {
    return "Chrome";
  }
  if (userAgent.includes("Safari/")) {
    return "Safari";
  }

  return undefined;
}

export function buildScreenSnapshot(currentWindow: WindowLike): SutraPadCaptureScreenSnapshot {
  return {
    viewportWidth: currentWindow.innerWidth,
    viewportHeight: currentWindow.innerHeight,
    screenWidth: currentWindow.screen?.width,
    screenHeight: currentWindow.screen?.height,
    pixelRatio: currentWindow.devicePixelRatio,
    orientation: currentWindow.screen?.orientation?.type,
  };
}

export async function resolveBatterySnapshot(
  navigatorLike: NavigatorLike,
): Promise<SutraPadCaptureBatterySnapshot | undefined> {
  if (!navigatorLike.getBattery) {
    return undefined;
  }

  try {
    const battery = await navigatorLike.getBattery();
    return {
      levelPercent:
        typeof battery.level === "number" ? Math.round(Math.min(Math.max(battery.level, 0), 1) * 100) : undefined,
      charging: typeof battery.charging === "boolean" ? battery.charging : undefined,
    };
  } catch {
    return undefined;
  }
}

export async function resolveAmbientLightSnapshot(
  currentWindow: WindowLike,
): Promise<SutraPadCaptureExperimentalSnapshot | undefined> {
  if (!currentWindow.AmbientLightSensor) {
    return undefined;
  }

  try {
    const sensor = new currentWindow.AmbientLightSensor();
    const result = await new Promise<number | undefined>((resolve) => {
      const timeout = currentWindow.setTimeout(() => {
        cleanup();
        resolve(undefined);
      }, 150);

      const onReading = (): void => {
        cleanup();
        resolve(typeof sensor.illuminance === "number" ? sensor.illuminance : undefined);
      };

      const cleanup = (): void => {
        currentWindow.clearTimeout(timeout);
        sensor.removeEventListener("reading", onReading);
        sensor.stop?.();
      };

      sensor.addEventListener("reading", onReading);
      sensor.start();
    });

    return result === undefined ? undefined : { ambientLightLux: result };
  } catch {
    return undefined;
  }
}

export async function resolveCurrentWeather(
  coordinates?: SutraPadCoordinates,
): Promise<SutraPadCaptureWeatherSnapshot | undefined> {
  if (!coordinates) {
    return undefined;
  }

  try {
    const params = new URLSearchParams({
      latitude: String(coordinates.latitude),
      longitude: String(coordinates.longitude),
      current: "temperature_2m,weather_code,wind_speed_10m,is_day",
      forecast_days: "1",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        is_day?: number;
      };
    };

    return {
      temperatureC: payload.current?.temperature_2m,
      weatherCode: payload.current?.weather_code,
      windSpeedKmh: payload.current?.wind_speed_10m,
      isDay: payload.current?.is_day === undefined ? undefined : payload.current.is_day === 1,
      source: "open-meteo",
    };
  } catch {
    return undefined;
  }
}

export async function collectCaptureContext({
  source,
  coordinates,
  sourceSnapshot,
  currentDate = new Date(),
  navigatorLike = navigator,
  currentWindow = window,
  currentDocument = document,
}: {
  source: SutraPadCaptureContext["source"];
  coordinates?: SutraPadCoordinates;
  sourceSnapshot?: Partial<SutraPadCaptureContext>;
  currentDate?: Date;
  navigatorLike?: NavigatorLike;
  currentWindow?: WindowLike;
  currentDocument?: DocumentLike;
}): Promise<SutraPadCaptureContext> {
  const resolvedOptions = new Intl.DateTimeFormat().resolvedOptions();
  const screen = buildScreenSnapshot(currentWindow);
  const page = {
    ...sourceSnapshot?.page,
  };
  const battery = await resolveBatterySnapshot(navigatorLike);
  const weather = await resolveCurrentWeather(coordinates);
  const experimental = await resolveAmbientLightSnapshot(currentWindow);
  const connection = navigatorLike.connection;
  const scroll = sourceSnapshot?.scroll ?? computeScrollSnapshot(currentWindow, currentDocument);
  const userAgent = navigatorLike.userAgent ?? "";
  const platform = navigatorLike.userAgentData?.platform ?? navigatorLike.platform;

  return {
    source,
    timezone: resolvedOptions.timeZone,
    timezoneOffsetMinutes: -currentDate.getTimezoneOffset(),
    locale: resolvedOptions.locale || navigatorLike.language,
    languages: navigatorLike.languages?.length ? [...navigatorLike.languages] : undefined,
    referrer: sourceSnapshot?.referrer ?? (currentDocument.referrer || undefined),
    deviceType: detectDeviceType({
      mobileHint: navigatorLike.userAgentData?.mobile,
      maxTouchPoints: navigatorLike.maxTouchPoints,
      viewportWidth: screen.viewportWidth,
      screenWidth: screen.screenWidth,
    }),
    os: detectOperatingSystem(userAgent, platform),
    browser: detectBrowser(userAgent, navigatorLike.userAgentData?.brands),
    screen,
    scroll,
    timeOnPageMs:
      sourceSnapshot?.timeOnPageMs ??
      (typeof currentWindow.performance?.now === "function"
        ? Math.round(currentWindow.performance.now())
        : undefined),
    page: Object.values(page).some(Boolean) ? page : undefined,
    network: {
      online: navigatorLike.onLine,
      effectiveType: connection?.effectiveType,
      rtt: connection?.rtt,
      downlink: connection?.downlink,
      saveData: connection?.saveData,
    },
    battery,
    weather,
    experimental,
  };
}
