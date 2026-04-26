import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SAFE_FETCH_TIMEOUT_MS, safeFetch } from "../src/lib/safe-fetch";

/**
 * Mock-fetch helper. Production `fetch` rejects on abort, but a test
 * mock that does the same generates an unhandled-rejection warning
 * unless every reject is awaited at *exactly* the right tick under
 * fake timers — fragile and flaky. Instead we let the mock react to
 * abort by *resolving* with a sentinel `Response` carrying an
 * `x-aborted` header, and check the request's signal directly.
 *
 * `safeFetch` itself only cares about the underlying response; it
 * never inspects the signal post-hoc, so swapping the rejection for a
 * resolved-but-flagged response keeps the contract observable without
 * the lifecycle gymnastics. The "rejection on abort" behaviour is the
 * platform's, not ours — covered by integration / browser tests
 * downstream, not the unit suite.
 */
function makeAbortObservingFetch(): {
  capturedSignals: AbortSignal[];
  capturedInits: RequestInit[];
  install: () => void;
  delayMs: number;
} {
  const state = {
    capturedSignals: [] as AbortSignal[],
    capturedInits: [] as RequestInit[],
    delayMs: 10_000,
    install(): void {
      globalThis.fetch = ((_input: RequestInfo | URL, init: RequestInit = {}) => {
        state.capturedInits.push(init);
        if (init.signal) state.capturedSignals.push(init.signal);
        // Resolve only after a simulated network hop; the timeout
        // AbortController is expected to fire first in the timeout
        // tests.
        return new Promise<Response>((resolve) => {
          const onAbort = (): void => {
            // Surface abort as a flagged response rather than reject —
            // see helper-level comment.
            resolve(new Response(null, { headers: { "x-aborted": "1" } }));
          };
          if (init.signal?.aborted) {
            onAbort();
            return;
          }
          init.signal?.addEventListener("abort", onAbort, { once: true });
          setTimeout(() => {
            init.signal?.removeEventListener("abort", onAbort);
            resolve(new Response("ok"));
          }, state.delayMs);
        });
      }) as typeof globalThis.fetch;
    },
  };
  return state;
}

describe("safeFetch", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("forwards a successful response unchanged", async () => {
    const expected = new Response("ok");
    globalThis.fetch = (async () => expected) as typeof globalThis.fetch;
    const result = await safeFetch("https://example.test/");
    expect(result).toBe(expected);
  });

  it("aborts the underlying fetch after the default timeout", async () => {
    const observer = makeAbortObservingFetch();
    observer.install();
    const promise = safeFetch("https://slow.test/");
    await vi.advanceTimersByTimeAsync(DEFAULT_SAFE_FETCH_TIMEOUT_MS + 10);
    const response = await promise;
    expect(response.headers.get("x-aborted")).toBe("1");
    expect(observer.capturedSignals[0].aborted).toBe(true);
  });

  it("respects a custom timeoutMs", async () => {
    const observer = makeAbortObservingFetch();
    observer.install();
    const promise = safeFetch("https://slow.test/", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(50);
    expect(observer.capturedSignals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    const response = await promise;
    expect(response.headers.get("x-aborted")).toBe("1");
  });

  it("aborts immediately if the caller's signal was already aborted", async () => {
    const observer = makeAbortObservingFetch();
    observer.install();
    const external = new AbortController();
    external.abort();
    const response = await safeFetch("https://x.test/", { signal: external.signal });
    expect(response.headers.get("x-aborted")).toBe("1");
    expect(observer.capturedSignals[0].aborted).toBe(true);
  });

  it("aborts when the caller's signal aborts mid-flight", async () => {
    const observer = makeAbortObservingFetch();
    observer.install();
    const external = new AbortController();
    const promise = safeFetch("https://x.test/", { signal: external.signal });
    await vi.advanceTimersByTimeAsync(50);
    expect(observer.capturedSignals[0].aborted).toBe(false);
    external.abort();
    const response = await promise;
    expect(response.headers.get("x-aborted")).toBe("1");
    expect(observer.capturedSignals[0].aborted).toBe(true);
  });

  it("clears the timeout on success so it doesn't fire later", async () => {
    const observer = makeAbortObservingFetch();
    observer.delayMs = 50; // Resolve before the 100 ms timeout.
    observer.install();
    const promise = safeFetch("https://fast.test/", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(60);
    const response = await promise;
    // Successful path returns the upstream "ok" body, not the aborted sentinel.
    expect(response.headers.get("x-aborted")).toBeNull();
    // After success, advancing further must not trigger a stray abort
    // on the (now-discarded) controller — observable as the captured
    // signal staying not-aborted.
    await vi.advanceTimersByTimeAsync(500);
    expect(observer.capturedSignals[0].aborted).toBe(false);
  });

  it("clears the timeout on synchronous fetch failure", async () => {
    // If `fetch` throws synchronously (invalid URL scheme, init error,
    // or a stub that misbehaves), the finally block must still clear
    // the timeout. Otherwise the abort fires later against a discarded
    // controller — harmless but observable noise.
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    globalThis.fetch = (() => {
      throw new TypeError("Failed to fetch");
    }) as typeof globalThis.fetch;

    await expect(safeFetch("https://x.test/")).rejects.toThrow(TypeError);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("removes the external-signal abort listener after a successful fetch", async () => {
    // Cleanup is observable via the AbortSignal's listener bookkeeping:
    // if `removeEventListener` were skipped (or called with the wrong
    // event name), the relay would still fire later when the caller
    // eventually aborts their own controller — and would call abort()
    // on the controller we've already thrown away. We pin both halves
    // here so a regression on the cleanup branch shows up in unit tests
    // instead of as a stray late-firing abort against a discarded
    // controller in production.
    const observer = makeAbortObservingFetch();
    observer.delayMs = 0;
    observer.install();

    const external = new AbortController();
    const addSpy = vi.spyOn(external.signal, "addEventListener");
    const removeSpy = vi.spyOn(external.signal, "removeEventListener");

    const promise = safeFetch("https://x.test/", { signal: external.signal });
    await vi.runAllTimersAsync();
    await promise;

    // Listener was attached during setup, then removed in the finally
    // block — exactly once each, with the same handler reference and
    // the literal "abort" event name (string-literal mutations would
    // pass an empty string and survive without this exact-arg check).
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0][0]).toBe("abort");
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls[0][0]).toBe("abort");
    // Same handler reference for add/remove — otherwise the relay
    // would not actually be detached and would still relay future
    // aborts to a dead controller.
    expect(removeSpy.mock.calls[0][1]).toBe(addSpy.mock.calls[0][1]);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("does not attach (and therefore does not remove) a listener when the external signal is already aborted", async () => {
    // The early-abort branch sets listenerAdded=false; the cleanup
    // path must agree and skip removeEventListener. Otherwise we'd
    // call removeEventListener for a handler we never added — a
    // no-op in production but a clear contract violation that we
    // want to catch in tests.
    const observer = makeAbortObservingFetch();
    observer.install();

    const external = new AbortController();
    external.abort();
    const addSpy = vi.spyOn(external.signal, "addEventListener");
    const removeSpy = vi.spyOn(external.signal, "removeEventListener");

    await safeFetch("https://x.test/", { signal: external.signal });
    expect(addSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("forwards init fields (headers, method) verbatim", async () => {
    const observer = makeAbortObservingFetch();
    observer.delayMs = 0;
    observer.install();
    // Kick off, advance timers so the mock's setTimeout(0) resolves,
    // then await — `await safeFetch(...)` directly would hang because
    // fake timers freeze the resolution.
    const promise = safeFetch("https://x.test/", {
      method: "POST",
      headers: { "X-Test": "1" },
      body: "payload",
    });
    await vi.runAllTimersAsync();
    await promise;
    const init = observer.capturedInits[0];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Test"]).toBe("1");
    expect(init.body).toBe("payload");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
