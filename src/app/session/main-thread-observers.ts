/**
 * Main-thread observability for the Diagnostics card (`docs/nfr-testing-plan.md`,
 * layer 2): Long Tasks, Event Timing (the entries INP is derived from), and a
 * periodic heap sample where the browser exposes one. Passive — it only ever
 * reads `PerformanceObserver` / `performance.memory` and reports numbers to
 * the callbacks; the reducers in `logic/diagnostics.ts` own the aggregation.
 *
 * Everything is feature-detected. Safari has neither `longtask` nor
 * `performance.memory`; Firefox lacks `longtask`. Where an entry type is
 * unsupported the observer is simply not started, and the card shows what
 * it has. `measureUserAgentSpecificMemory()` is deliberately not used: it
 * requires cross-origin isolation, which the Google sign-in popup flow
 * cannot run under.
 */

export interface MainThreadObserverHooks {
  onLongTask: (durationMs: number) => void;
  onInteraction: (durationMs: number) => void;
  onHeapSample: (usedBytes: number) => void;
}

export interface MainThreadObserverOptions {
  /** How often to sample `performance.memory` (default 60 s). `0` disables sampling. */
  heapSampleIntervalMs?: number;
  /**
   * Event Timing reports every event above this duration; 16 ms is the
   * spec minimum and keeps the count meaningful (one frame or more).
   */
  eventDurationThresholdMs?: number;
}

/** Minimal structural view of the globals we touch, for tests. */
interface ObserverGlobals {
  PerformanceObserver?: typeof PerformanceObserver;
  performance?: Performance & { memory?: { usedJSHeapSize?: number } };
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

const DEFAULT_HEAP_SAMPLE_INTERVAL_MS = 60_000;
const DEFAULT_EVENT_DURATION_THRESHOLD_MS = 16;

function supportedTypes(globals: ObserverGlobals): ReadonlySet<string> {
  const supported = globals.PerformanceObserver?.supportedEntryTypes;
  return new Set(Array.isArray(supported) ? supported : []);
}

/**
 * Starts the observers and returns a disposer. Never throws: an observer
 * whose construction fails (an older engine that lists a type but rejects
 * the options) is skipped.
 */
export function startMainThreadObservers(
  hooks: MainThreadObserverHooks,
  options: MainThreadObserverOptions = {},
  globals: ObserverGlobals = globalThis as unknown as ObserverGlobals,
): () => void {
  const disposers: Array<() => void> = [];
  const types = supportedTypes(globals);
  const Observer = globals.PerformanceObserver;

  if (Observer && types.has("longtask")) {
    try {
      const observer = new Observer((list) => {
        for (const entry of list.getEntries()) hooks.onLongTask(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: true });
      disposers.push(() => observer.disconnect());
    } catch {
      // Unsupported options shape — skip this observer.
    }
  }

  if (Observer && types.has("event")) {
    try {
      const observer = new Observer((list) => {
        for (const entry of list.getEntries()) hooks.onInteraction(entry.duration);
      });
      observer.observe({
        type: "event",
        buffered: true,
        durationThreshold: options.eventDurationThresholdMs ?? DEFAULT_EVENT_DURATION_THRESHOLD_MS,
      } as PerformanceObserverInit);
      disposers.push(() => observer.disconnect());
    } catch {
      // Same as above.
    }
  }

  const interval = options.heapSampleIntervalMs ?? DEFAULT_HEAP_SAMPLE_INTERVAL_MS;
  const sampleHeap = (): void => {
    const used = globals.performance?.memory?.usedJSHeapSize;
    if (typeof used === "number") hooks.onHeapSample(used);
  };
  if (interval > 0 && typeof globals.performance?.memory?.usedJSHeapSize === "number") {
    sampleHeap();
    const timer = globals.setInterval(sampleHeap, interval);
    disposers.push(() => globals.clearInterval(timer));
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}
