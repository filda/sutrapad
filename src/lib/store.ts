/**
 * Minimal reactive-store primitives.
 *
 * The goal is a tiny, framework-free replacement for the `let workspace = …`
 * + `setWorkspaceState` + `render()` triplet that's accreted across `app.ts`.
 * Reading code calls `workspace$.get()`, mutations go through
 * `workspace$.set(…)`, and renderers register via `workspace$.subscribe(…)`
 * — no central `render()` dispatcher to thread through every handler bag.
 *
 * Three primitives:
 *
 *   - `atom<T>(initial)` — a single mutable value with subscribers.
 *   - `computed(source, fn)` — a read-only value derived from one source,
 *     re-evaluated when the source changes, cached between reads.
 *   - `combine(a, b, fn)` — same shape as `computed` but reading two
 *     sources. Higher arities aren't included on YAGNI grounds: nest
 *     `combine` calls (or compose into a single atom holding a record)
 *     when you need three or more inputs.
 *
 * Design choices:
 *
 *   - Equality is `Object.is`. Setting the same value, or a `computed`
 *     re-evaluating to the same output, does NOT fire subscribers — saves
 *     a render loop on no-op state writes (a real pattern in `app.ts`,
 *     where multiple handlers may converge on the same workspace shape).
 *   - Subscribers are NOT invoked on `subscribe()`. Callers that want
 *     the initial value should `get()` it explicitly. This avoids the
 *     "subscribe-and-immediately-render-twice" anti-pattern when you
 *     wire up several subscribers in sequence at startup.
 *   - During notification, the listener set is snapshotted, so a listener
 *     that subscribes / unsubscribes mid-loop doesn't disturb the iteration.
 *   - `computed` and `combine` subscribe to their sources at construction
 *     time and never unsubscribe. The store is a single-instance global
 *     with the lifetime of the app — no widget-scoped derived values to
 *     reclaim. If we later need ephemeral computeds, we'll add a
 *     reference-counted `subscribe`-driven activation, but not now.
 *   - No batching primitive. Multiple `set()` calls in sequence fire
 *     subscribers once each — the renderer is expected to be idempotent
 *     and cheap enough that a few extra full re-renders aren't worth the
 *     batching machinery. If a hot path actually fires three sequential
 *     atom updates and the resulting triple-render shows up in flame
 *     graphs, add `batch()` then.
 */

/**
 * A read-only reactive value. Both `atom` and `computed` / `combine`
 * outputs satisfy this shape, so callers that only need to read +
 * subscribe (e.g. a render hook) accept any of them.
 */
export interface Readable<T> {
  /**
   * Snapshot of the current value. Always synchronous, never async,
   * never recomputed lazily — `computed` caches its derived result
   * and returns it from cache here.
   */
  get(): T;
  /**
   * Register a listener that fires whenever the value changes
   * (`Object.is` differs from the previously notified value).
   * Returns an idempotent unsubscribe function — calling it
   * multiple times is safe.
   */
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * A mutable reactive value. `set()` notifies subscribers only when
 * the new value differs from the current one (`Object.is`).
 */
export interface Atom<T> extends Readable<T> {
  set(next: T): void;
}

/**
 * Notifies the given listeners with `value`. The set is snapshotted
 * into an array so a listener that mutates the listener registry
 * mid-call (subscribe / unsubscribe inside its body) doesn't disrupt
 * the iteration order or visit count for the current notification
 * round.
 */
function notify<T>(listeners: Set<(value: T) => void>, value: T): void {
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) listener(value);
}

export function atom<T>(initial: T): Atom<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(value, next)) return;
      value = next;
      notify(listeners, value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function computed<Source, Out>(
  source: Readable<Source>,
  fn: (value: Source) => Out,
): Readable<Out> {
  let cached = fn(source.get());
  const listeners = new Set<(value: Out) => void>();
  source.subscribe((sourceValue) => {
    const next = fn(sourceValue);
    if (Object.is(cached, next)) return;
    cached = next;
    notify(listeners, cached);
  });
  return {
    get: () => cached,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function combine<A, B, Out>(
  a: Readable<A>,
  b: Readable<B>,
  fn: (a: A, b: B) => Out,
): Readable<Out> {
  let cached = fn(a.get(), b.get());
  const listeners = new Set<(value: Out) => void>();
  const recompute = (): void => {
    const next = fn(a.get(), b.get());
    if (Object.is(cached, next)) return;
    cached = next;
    notify(listeners, cached);
  };
  a.subscribe(recompute);
  b.subscribe(recompute);
  return {
    get: () => cached,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
