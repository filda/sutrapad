/**
 * Eager OG-image cache prewarming.
 *
 * Backstory: cards on Notes / Tasks / Links pages call
 * `createOgImageResolver` lazily — every visible card kicks off its own
 * allorigins round-trip on first paint, and the og:image only swaps in
 * once the proxy returns. For a workspace with dozens of URL-bearing
 * notes, the first visit to a card grid spends 1–2 seconds showing a
 * sea of dull gradient bands before the images replace them.
 *
 * The prewarm walks every URL note right after workspace load and runs
 * the same resolver pipeline (`og-image.ts` → `resolveOgImageForUrl`)
 * in parallel with a small concurrency cap. Every hit (or cached
 * negative) lands in localStorage before the user navigates to a card
 * grid, so the first paint already has the image. Lazy resolution stays
 * in place as a fallback for URLs the user types in *after* load.
 *
 * The module is split into a pure planner and an async runner so:
 *   - `planOgImagePrewarm` can be unit-tested without faking fetch
 *     (it just consumes the cache snapshot and decides what's worth
 *     resolving).
 *   - `runOgImagePrewarm` owns the IO + concurrency + localStorage
 *     write loop, and accepts a `fetchImpl` injection for tests.
 *
 * Both helpers fold multiple notes pointing at the same primary URL
 * into a single resolution target. That matters for the capture-time
 * Stage 1 hit in `resolveOgImageForUrl` — passing the union of notes
 * means the resolver can pick up an og:image from any of them, not
 * just the first one in document order.
 */
import type { SutraPadDocument } from "../../types";
import { deriveNotePrimaryUrl } from "./note-primary-url";
import {
  loadOgImageCache,
  persistOgImageCache,
  setOgImageCacheEntry,
  type OgImageCache,
} from "./og-image-cache";
import { resolveOgImageForUrl } from "./og-image";

export interface OgImagePrewarmTarget {
  /** Primary URL to resolve — exactly one per target after folding. */
  readonly url: string;
  /** Notes whose `captureContext.page.ogImage` is in play for Stage 1. */
  readonly notes: readonly SutraPadDocument[];
}

/**
 * Default ceiling on simultaneous allorigins fetches during prewarm. Four
 * is small enough to stay polite on a free proxy and still drains a
 * couple-dozen URLs in well under a couple of seconds — the only window
 * that matters here is "before the user navigates to a card grid".
 */
export const DEFAULT_PREWARM_CONCURRENCY = 4;

/**
 * Walks `notes`, picks up each note's primary URL, and returns the set
 * of URLs that aren't already in `cache` (positive or negative). Pure:
 * given the same inputs it returns the same plan, which keeps the
 * planning step trivially testable.
 *
 * Notes pointing at the same URL are folded — the resolver only needs
 * to run once per URL, but every donor note's `captureContext` is
 * forwarded so a Stage 1 capture-time hit can come from any of them.
 */
export function planOgImagePrewarm(
  notes: readonly SutraPadDocument[],
  cache: OgImageCache,
): OgImagePrewarmTarget[] {
  const byUrl = new Map<string, SutraPadDocument[]>();
  for (const note of notes) {
    const url = deriveNotePrimaryUrl(note);
    if (url === null) continue;
    // Cached hits AND cached misses both short-circuit — the resolver
    // would do the same on its own, but skipping them here keeps the
    // worker pool focused on URLs that actually need a round-trip.
    if (cache[url] !== undefined) continue;

    const existing = byUrl.get(url);
    if (existing === undefined) {
      byUrl.set(url, [note]);
    } else {
      existing.push(note);
    }
  }

  const targets: OgImagePrewarmTarget[] = [];
  for (const [url, notesForUrl] of byUrl) {
    targets.push({ url, notes: notesForUrl });
  }
  return targets;
}

export interface RunOgImagePrewarmOptions {
  /** Injection point for tests — production callers omit and get `safeFetch` via the resolver. */
  readonly fetchImpl?: typeof fetch;
  /** Override the default concurrency cap (e.g. 1 for deterministic tests). */
  readonly concurrency?: number;
  /**
   * Replaces the default `loadOgImageCache()` snapshot. Tests pass an
   * in-memory cache so they don't need to fake `window.localStorage`.
   */
  readonly loadCache?: () => OgImageCache;
  /**
   * Replaces the default `persistOgImageCache(...)` writer. Tests use
   * this to assert what landed in storage without touching the real
   * `localStorage`.
   */
  readonly persistCache?: (cache: OgImageCache) => void;
}

/**
 * Runs the resolver for every prewarm target in parallel up to
 * `concurrency` at a time. Each resolution writes its outcome (hit or
 * negative) into the cache as soon as it lands so a card render
 * happening mid-prewarm picks up the freshest snapshot.
 *
 * Returns a Promise that resolves once every worker has drained. Per-URL
 * failures are absorbed: `resolveOgImageForUrl` already caches a negative
 * on network errors, and a defence-in-depth `try/catch` here keeps a
 * single buggy resolution from killing the rest of the pool.
 */
export async function runOgImagePrewarm(
  targets: readonly OgImagePrewarmTarget[],
  options: RunOgImagePrewarmOptions = {},
): Promise<void> {
  if (targets.length === 0) return;

  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_PREWARM_CONCURRENCY);
  const loadCache = options.loadCache ?? loadOgImageCache;
  const persistCache = options.persistCache ?? persistOgImageCache;

  // Mutable cache captured by per-iteration closures via a `const` ref
  // box. Stashing in `{ current }` keeps the closures pointing at the
  // same evolving snapshot without making them capture a re-assigned
  // `let` (which the no-loop-func lint flags conservatively even when
  // safe — the pattern here is precisely "all closures see the latest
  // value", which is the intent).
  const cacheRef = { current: loadCache() };
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const target = targets[cursor];
      cursor += 1;
      try {
        // Sequential await is intentional: the worker pool runs N
        // workers in parallel via `Promise.all` below, each draining
        // the shared `targets` queue one at a time. Replacing this
        // with `Promise.all(targets.map(...))` would burn the
        // concurrency cap.
        // eslint-disable-next-line no-await-in-loop
        await resolveOgImageForUrl({
          url: target.url,
          notes: target.notes,
          getCachedEntry: (key) => cacheRef.current[key] ?? null,
          putCachedEntry: (key, entry) => {
            cacheRef.current = setOgImageCacheEntry(cacheRef.current, key, entry);
            persistCache(cacheRef.current);
          },
          fetchImpl: options.fetchImpl,
        });
      } catch {
        // resolveOgImageForUrl already swallows network errors and
        // commits a negative-cache entry. The catch here is a guard
        // against a future code path that throws — losing the pool
        // because one URL blew up would be a worse failure mode than
        // silently skipping it.
      }
    }
  };

  const workers: Promise<void>[] = [];
  const lanes = Math.min(concurrency, targets.length);
  for (let i = 0; i < lanes; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
}
