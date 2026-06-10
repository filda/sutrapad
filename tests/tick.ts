/**
 * Yield to the event loop for `ms` macrotasks worth of time, defaulting
 * to a single 0-ms `setTimeout`. The intent is "let pending microtasks
 * drain and one macrotask boundary cross before the next assertion" —
 * the common shape `await new Promise((r) => setTimeout(r, 0))` written
 * inline across the suite.
 *
 * Use `tick()` (0 ms) when you just need the microtask queue to drain
 * past a `then`/`await`-chained handler; pass `ms` when a test
 * intentionally needs a longer pause (mount→paint, debounce window…).
 *
 * Implementation note: the executor body is a block (not a concise
 * arrow returning the setTimeout id) to satisfy
 * `eslint/no-promise-executor-return` — Promise executor return values
 * are silently dropped, so a returning arrow is a footgun in non-test
 * code.
 */
export function tick(ms = 0): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
