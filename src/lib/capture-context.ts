import type {
  SutraPadCaptureBatterySnapshot,
  SutraPadCaptureContext,
  SutraPadCaptureExperimentalSnapshot,
  SutraPadCapturePageMetadata,
  SutraPadCaptureScreenSnapshot,
  SutraPadCaptureScrollSnapshot,
  SutraPadCaptureSensorsSnapshot,
  SutraPadCaptureWeatherSnapshot,
  SutraPadCoordinates,
} from "../types";
import { safeFetch } from "./safe-fetch";
import {
  accelerationMagnitude,
  classifyMotion,
  computeNoiseLevelDb,
} from "./sensors";

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

interface PermissionStatusLike {
  state?: string;
}

interface MediaStreamTrackLike {
  stop: () => void;
}

interface MediaStreamLike {
  getTracks: () => MediaStreamTrackLike[];
}

interface AnalyserNodeLike {
  fftSize: number;
  getFloatTimeDomainData: (array: Float32Array<ArrayBuffer>) => void;
}

interface AudioContextLike {
  createAnalyser: () => AnalyserNodeLike;
  createMediaStreamSource: (stream: MediaStreamLike) => {
    connect: (destination: AnalyserNodeLike) => void;
  };
  close: () => Promise<void> | void;
}

interface DeviceMotionReadingLike {
  x?: number | null;
  y?: number | null;
  z?: number | null;
}

interface DeviceMotionEventLike {
  accelerationIncludingGravity?: DeviceMotionReadingLike | null;
  acceleration?: DeviceMotionReadingLike | null;
}

export interface NavigatorLike {
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
  permissions?: {
    query?: (descriptor: { name: PermissionName }) => Promise<PermissionStatusLike>;
  };
  mediaDevices?: {
    getUserMedia?: (constraints: { audio: boolean }) => Promise<MediaStreamLike>;
  };
}

export interface WindowLike {
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
  addEventListener?: (
    type: string,
    listener: (event: DeviceMotionEventLike) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (event: DeviceMotionEventLike) => void,
  ) => void;
  // `prototype` gives this type a property in common with the real
  // `DeviceMotionEvent` constructor so `window` stays assignable to
  // `WindowLike` (TS rejects assigning a constructor to an all-optional "weak"
  // type otherwise). `requestPermission` is the non-standard iOS gate.
  DeviceMotionEvent?: {
    prototype?: unknown;
    requestPermission?: () => Promise<string>;
  };
  AudioContext?: new () => AudioContextLike;
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

interface CollectCaptureContextOptions {
  source: SutraPadCaptureContext["source"];
  coordinates?: SutraPadCoordinates;
  sourceSnapshot?: Partial<SutraPadCaptureContext>;
  currentDate?: Date;
  navigatorLike?: NavigatorLike;
  currentWindow?: WindowLike;
  currentDocument?: DocumentLike;
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

/** How long to listen for `devicemotion` events before classifying. */
const MOTION_SAMPLE_WINDOW_MS = 400;
/** Stop early once this many usable accelerometer samples have arrived. */
const MOTION_MAX_SAMPLES = 32;
/**
 * AnalyserNode window size for the noise sample. 2048 frames at a 44.1 kHz
 * context is ~46 ms of audio — enough for a stable RMS without an audible
 * recording.
 */
const NOISE_FFT_SIZE = 2048;

/**
 * True only for devices that plausibly carry an accelerometer — i.e. ones the
 * user holds. The accelerometer is gated on this so a desktop (or a headless
 * test DOM) never spends the sampling window waiting for `devicemotion` events
 * that will never fire: those environments expose the listener API but no
 * hardware, so we'd otherwise block capture for `MOTION_SAMPLE_WINDOW_MS` for
 * nothing. A touch-capable laptop slips through and simply classifies "still".
 */
function isMotionCapableDevice(navigatorLike: NavigatorLike): boolean {
  return (navigatorLike.maxTouchPoints ?? 0) > 0 || navigatorLike.userAgentData?.mobile === true;
}

/**
 * Best-effort movement reading. Returns `undefined` (no verdict) when the
 * device isn't touch-capable, the environment exposes no motion listener, the
 * iOS motion-permission gate isn't already granted, or too few samples arrive
 * inside the window. Never raises a permission prompt on its own beyond what
 * iOS already gates.
 */
export async function resolveMotionStatus(
  currentWindow: WindowLike,
  navigatorLike: NavigatorLike,
): Promise<"still" | "moving" | undefined> {
  if (
    !isMotionCapableDevice(navigatorLike) ||
    typeof currentWindow.addEventListener !== "function" ||
    typeof currentWindow.removeEventListener !== "function"
  ) {
    return undefined;
  }

  const requestPermission = currentWindow.DeviceMotionEvent?.requestPermission;
  if (typeof requestPermission === "function") {
    try {
      if ((await requestPermission()) !== "granted") return undefined;
    } catch {
      return undefined;
    }
  }

  const magnitudes: number[] = [];
  return new Promise<"still" | "moving" | undefined>((resolve) => {
    const timeout = currentWindow.setTimeout(finish, MOTION_SAMPLE_WINDOW_MS);

    function onMotion(event: DeviceMotionEventLike): void {
      const reading = event.accelerationIncludingGravity ?? event.acceleration;
      const magnitude = accelerationMagnitude(reading?.x, reading?.y, reading?.z);
      if (magnitude !== undefined) magnitudes.push(magnitude);
      if (magnitudes.length >= MOTION_MAX_SAMPLES) finish();
    }

    function finish(): void {
      currentWindow.clearTimeout(timeout);
      currentWindow.removeEventListener?.("devicemotion", onMotion);
      resolve(classifyMotion(magnitudes));
    }

    currentWindow.addEventListener?.("devicemotion", onMotion);
  });
}

/**
 * Best-effort ambient-loudness reading. Deliberately silent: it only proceeds
 * when the microphone permission is *already* `granted` (checked via the
 * Permissions API), so capture never raises a mic prompt of its own. Returns
 * `undefined` when the APIs are missing, permission isn't granted, or the
 * audio graph fails. Always releases the stream and closes the context.
 */
export async function resolveNoiseLevelDb(
  currentWindow: WindowLike,
  navigatorLike: NavigatorLike,
): Promise<number | undefined> {
  const audioContextConstructor = currentWindow.AudioContext;
  const getUserMedia = navigatorLike.mediaDevices?.getUserMedia?.bind(
    navigatorLike.mediaDevices,
  );
  const query = navigatorLike.permissions?.query?.bind(navigatorLike.permissions);
  if (
    typeof audioContextConstructor !== "function" ||
    typeof getUserMedia !== "function" ||
    typeof query !== "function"
  ) {
    return undefined;
  }

  try {
    if ((await query({ name: "microphone" })).state !== "granted") {
      return undefined;
    }
  } catch {
    return undefined;
  }

  let stream: MediaStreamLike | undefined;
  let context: AudioContextLike | undefined;
  try {
    stream = await getUserMedia({ audio: true });
    context = new audioContextConstructor();
    const analyser = context.createAnalyser();
    analyser.fftSize = NOISE_FFT_SIZE;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return computeNoiseLevelDb(samples);
  } catch {
    return undefined;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    void context?.close();
  }
}

/**
 * Combines the two environment sensors into the `sensors` snapshot, running
 * them in parallel. Returns `undefined` when neither produced a reading, so
 * the field is omitted entirely rather than carrying an empty object.
 */
export async function resolveSensorsSnapshot(
  currentWindow: WindowLike,
  navigatorLike: NavigatorLike,
): Promise<SutraPadCaptureSensorsSnapshot | undefined> {
  const [motionStatus, noiseLevelDb] = await Promise.all([
    resolveMotionStatus(currentWindow, navigatorLike),
    resolveNoiseLevelDb(currentWindow, navigatorLike),
  ]);

  if (motionStatus === undefined && noiseLevelDb === undefined) return undefined;
  return { motionStatus, noiseLevelDb };
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
    const response = await safeFetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
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

function resolvePageSnapshot(
  sourceSnapshot?: Partial<SutraPadCaptureContext>,
): SutraPadCapturePageMetadata | undefined {
  const page = {
    ...sourceSnapshot?.page,
  };

  return Object.values(page).some(Boolean) ? page : undefined;
}

function resolveTimeOnPageMs(
  sourceSnapshot: Partial<SutraPadCaptureContext> | undefined,
  currentWindow: WindowLike,
): number | undefined {
  return sourceSnapshot?.timeOnPageMs ??
    (typeof currentWindow.performance?.now === "function"
      ? Math.round(currentWindow.performance.now())
      : undefined);
}

function buildNetworkSnapshot(
  connection: NavigatorConnectionLike | undefined,
  navigatorLike: NavigatorLike,
) {
  return {
    online: navigatorLike.onLine,
    effectiveType: connection?.effectiveType,
    rtt: connection?.rtt,
    downlink: connection?.downlink,
    saveData: connection?.saveData,
  };
}

function buildEnvironmentSnapshot(
  navigatorLike: NavigatorLike,
  currentWindow: WindowLike,
  currentDocument: DocumentLike,
  sourceSnapshot?: Partial<SutraPadCaptureContext>,
) {
  const screen = buildScreenSnapshot(currentWindow);
  const connection = navigatorLike.connection;
  const userAgent = navigatorLike.userAgent ?? "";
  const platform = navigatorLike.userAgentData?.platform ?? navigatorLike.platform;

  return {
    screen,
    scroll: sourceSnapshot?.scroll ?? computeScrollSnapshot(currentWindow, currentDocument),
    referrer: sourceSnapshot?.referrer ?? (currentDocument.referrer || undefined),
    locale: navigatorLike.language,
    languages: navigatorLike.languages?.length ? [...navigatorLike.languages] : undefined,
    deviceType: detectDeviceType({
      mobileHint: navigatorLike.userAgentData?.mobile,
      maxTouchPoints: navigatorLike.maxTouchPoints,
      viewportWidth: screen.viewportWidth,
      screenWidth: screen.screenWidth,
    }),
    os: detectOperatingSystem(userAgent, platform),
    browser: detectBrowser(userAgent, navigatorLike.userAgentData?.brands),
    network: buildNetworkSnapshot(connection, navigatorLike),
  };
}

async function resolveAsyncContextData(
  navigatorLike: NavigatorLike,
  currentWindow: WindowLike,
  coordinates?: SutraPadCoordinates,
) {
  const [battery, weather, experimental, sensors] = await Promise.all([
    resolveBatterySnapshot(navigatorLike),
    resolveCurrentWeather(coordinates),
    resolveAmbientLightSnapshot(currentWindow),
    resolveSensorsSnapshot(currentWindow, navigatorLike),
  ]);

  return {
    battery,
    weather,
    experimental,
    sensors,
  };
}

export async function collectCaptureContext({
  source,
  coordinates,
  sourceSnapshot,
  currentDate = new Date(),
  navigatorLike = navigator,
  currentWindow = window as unknown as WindowLike,
  currentDocument = document,
}: CollectCaptureContextOptions): Promise<SutraPadCaptureContext> {
  const resolvedOptions = new Intl.DateTimeFormat().resolvedOptions();
  const environment = buildEnvironmentSnapshot(
    navigatorLike,
    currentWindow,
    currentDocument,
    sourceSnapshot,
  );
  const asyncContextData = await resolveAsyncContextData(
    navigatorLike,
    currentWindow,
    coordinates,
  );

  return {
    source,
    timezone: resolvedOptions.timeZone,
    timezoneOffsetMinutes: -currentDate.getTimezoneOffset(),
    locale: resolvedOptions.locale || environment.locale,
    languages: environment.languages,
    referrer: environment.referrer,
    deviceType: environment.deviceType,
    os: environment.os,
    browser: environment.browser,
    screen: environment.screen,
    scroll: environment.scroll,
    timeOnPageMs: resolveTimeOnPageMs(sourceSnapshot, currentWindow),
    page: resolvePageSnapshot(sourceSnapshot),
    network: environment.network,
    battery: asyncContextData.battery,
    weather: asyncContextData.weather,
    experimental: asyncContextData.experimental,
    sensors: asyncContextData.sensors,
  };
}
