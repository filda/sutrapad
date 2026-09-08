import { describe, expect, it, vi } from "vitest";
import { startMainThreadObservers } from "../src/app/session/main-thread-observers";

interface FakeEntry {
  duration: number;
}

/** Minimal PerformanceObserver double: records observe() options, lets tests emit entries. */
function fakeObserverClass(supported: string[]) {
  const instances: Array<{
    callback: (list: { getEntries: () => FakeEntry[] }) => void;
    options: unknown;
    disconnected: boolean;
  }> = [];
  class FakeObserver {
    static supportedEntryTypes = supported;
    #callback: (list: { getEntries: () => FakeEntry[] }) => void;
    constructor(callback: (list: { getEntries: () => FakeEntry[] }) => void) {
      this.#callback = callback;
    }
    observe(options: unknown): void {
      instances.push({ callback: this.#callback, options, disconnected: false });
    }
    disconnect(): void {
      const me = instances.find((i) => i.callback === this.#callback);
      if (me) me.disconnected = true;
    }
  }
  const emit = (type: string, durations: number[]): void => {
    for (const instance of instances) {
      if ((instance.options as { type: string }).type !== type) continue;
      instance.callback({ getEntries: () => durations.map((duration) => ({ duration })) });
    }
  };
  return { FakeObserver, instances, emit };
}

function hooks() {
  return { onLongTask: vi.fn(), onInteraction: vi.fn(), onHeapSample: vi.fn() };
}

describe("startMainThreadObservers", () => {
  it("observes longtask and event entries when supported and routes durations to the hooks", () => {
    const { FakeObserver, instances, emit } = fakeObserverClass(["longtask", "event"]);
    const h = hooks();
    const stop = startMainThreadObservers(h, { heapSampleIntervalMs: 0 }, {
      PerformanceObserver: FakeObserver as unknown as typeof PerformanceObserver,
      setInterval: vi.fn() as unknown as typeof setInterval,
      clearInterval: vi.fn() as unknown as typeof clearInterval,
    });

    expect(instances.map((i) => (i.options as { type: string }).type).toSorted()).toEqual(["event", "longtask"]);
    expect(instances.find((i) => (i.options as { type: string }).type === "event")?.options).toMatchObject({
      buffered: true,
      durationThreshold: 16,
    });

    emit("longtask", [70, 320]);
    emit("event", [40]);
    expect(h.onLongTask.mock.calls.map(([d]) => d)).toEqual([70, 320]);
    expect(h.onInteraction.mock.calls.map(([d]) => d)).toEqual([40]);

    stop();
    expect(instances.every((i) => i.disconnected)).toBe(true);
  });

  it("skips entry types the engine does not list (Safari: neither; Firefox: no longtask)", () => {
    const { FakeObserver, instances } = fakeObserverClass(["event"]);
    startMainThreadObservers(hooks(), { heapSampleIntervalMs: 0 }, {
      PerformanceObserver: FakeObserver as unknown as typeof PerformanceObserver,
      setInterval: vi.fn() as unknown as typeof setInterval,
      clearInterval: vi.fn() as unknown as typeof clearInterval,
    });
    expect(instances.map((i) => (i.options as { type: string }).type)).toEqual(["event"]);
  });

  it("does nothing, and does not throw, without PerformanceObserver at all", () => {
    const h = hooks();
    const stop = startMainThreadObservers(h, {}, {
      setInterval: vi.fn() as unknown as typeof setInterval,
      clearInterval: vi.fn() as unknown as typeof clearInterval,
    });
    expect(() => stop()).not.toThrow();
    expect(h.onLongTask).not.toHaveBeenCalled();
  });

  it("survives an observer whose observe() rejects the options", () => {
    class Throwing {
      static supportedEntryTypes = ["longtask"];
      observe(): void {
        throw new TypeError("unsupported");
      }
      disconnect(): void {}
    }
    expect(() =>
      startMainThreadObservers(hooks(), { heapSampleIntervalMs: 0 }, {
        PerformanceObserver: Throwing as unknown as typeof PerformanceObserver,
        setInterval: vi.fn() as unknown as typeof setInterval,
        clearInterval: vi.fn() as unknown as typeof clearInterval,
      }),
    ).not.toThrow();
  });

  it("samples performance.memory immediately and on the interval, and stops with the disposer", () => {
    const h = hooks();
    let used = 1000;
    const setInterval = vi.fn().mockReturnValue(7);
    const clearInterval = vi.fn();
    const stop = startMainThreadObservers(h, { heapSampleIntervalMs: 500 }, {
      performance: { memory: { get usedJSHeapSize() { return used; } } } as unknown as Performance,
      setInterval: setInterval as unknown as typeof setInterval,
      clearInterval: clearInterval as unknown as typeof clearInterval,
    });
    expect(h.onHeapSample).toHaveBeenCalledWith(1000);
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 500);
    used = 2000;
    (setInterval.mock.calls[0][0] as () => void)();
    expect(h.onHeapSample).toHaveBeenLastCalledWith(2000);
    stop();
    expect(clearInterval).toHaveBeenCalledWith(7);
  });

  it("does not sample when performance.memory is absent or sampling is disabled", () => {
    const h = hooks();
    const setInterval = vi.fn();
    startMainThreadObservers(h, {}, {
      performance: {} as Performance,
      setInterval: setInterval as unknown as typeof setInterval,
      clearInterval: vi.fn() as unknown as typeof clearInterval,
    });
    startMainThreadObservers(h, { heapSampleIntervalMs: 0 }, {
      performance: { memory: { usedJSHeapSize: 5 } } as unknown as Performance,
      setInterval: setInterval as unknown as typeof setInterval,
      clearInterval: vi.fn() as unknown as typeof clearInterval,
    });
    expect(h.onHeapSample).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
  });
});
