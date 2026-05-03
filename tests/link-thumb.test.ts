// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLinkThumb } from "../src/app/view/shared/link-thumb";
import { hashStringToHue } from "../src/app/logic/link-card";
import type { OgImageResolver } from "../src/app/logic/og-image-resolver";

function makeResolver(impl: OgImageResolver["resolve"]): OgImageResolver {
  return { resolve: impl };
}

const NOOP_RESOLVER = makeResolver(() => Promise.resolve(null));

/**
 * Drives the og:image probe under test. happy-dom's `Image` constructor
 * doesn't fire `load` on `src` assignment (no real network), so we
 * monkey-patch the global with a tiny stand-in: setting `src` schedules
 * either a synthetic `load` or `error` depending on the configured mode.
 * Returns a teardown that restores the previous global.
 */
function stubImageLoader(
  mode: "load" | "error",
): { restore: () => void; constructed: () => number } {
  const original = (globalThis as { Image: typeof Image }).Image;
  let constructed = 0;
  // No `src` field declaration — a class field would shadow the prototype
  // setter we install below, and `probe.src = imageUrl` would silently
  // write through to the field instead of triggering the synthetic event.
  class StubImage extends EventTarget {
    constructor() {
      super();
      constructed += 1;
    }
  }
  Object.defineProperty(StubImage.prototype, "src", {
    configurable: true,
    set(this: EventTarget & { _src?: string }, value: string) {
      this._src = value;
      // Microtask so the consumer's `addEventListener` registration
      // (which runs synchronously before this assignment) is in place
      // when the dispatch fires — mirrors real-browser load timing.
      queueMicrotask(() => this.dispatchEvent(new Event(mode)));
    },
    get(this: { _src?: string }) {
      return this._src ?? "";
    },
  });
  (globalThis as unknown as { Image: typeof StubImage }).Image = StubImage;
  return {
    restore: () => {
      (globalThis as { Image: typeof Image }).Image = original;
    },
    constructed: () => constructed,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("buildLinkThumb", () => {
  it("renders a domain chip with the trimmed hostname when a URL is provided", () => {
    const thumb = buildLinkThumb({
      url: "https://www.nytimes.com/article",
      notes: [],
      resolver: NOOP_RESOLVER,
    });
    const chip = thumb.querySelector(".link-thumb-domain");
    expect(chip?.textContent).toBe("nytimes.com");
  });

  it("omits the domain chip when no URL is provided", () => {
    // Notes/Tasks cards for hand-typed (URL-less) notes still render a
    // gradient thumb so the grid keeps a consistent rhythm — but no
    // domain chip should render, since there's no domain to label.
    const thumb = buildLinkThumb({
      url: null,
      notes: [],
      resolver: NOOP_RESOLVER,
    });
    expect(thumb.querySelector(".link-thumb-domain")).toBeNull();
    // Gradient still lands on `backgroundImage` so the thumb is never blank.
    expect(thumb.style.backgroundImage).toContain("linear-gradient");
  });

  it("does not invoke the resolver when URL is null", async () => {
    // Any resolver call on a URL-less card would be wasteful — `notes` is
    // empty so the resolver couldn't return anything useful, and we
    // already know there's no og:image to look up.
    const resolver = makeResolver(vi.fn(() => Promise.resolve(null)));
    buildLinkThumb({ url: null, notes: [], resolver });
    // Allow microtasks to drain in case any future regression schedules
    // an async path on this branch.
    await Promise.resolve();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("invokes the resolver with the URL and notes when a URL is present", async () => {
    const resolver = makeResolver(vi.fn(() => Promise.resolve(null)));
    const thumb = buildLinkThumb({
      url: "https://example.com",
      notes: [],
      resolver,
    });
    document.body.append(thumb);
    await Promise.resolve();
    await Promise.resolve();
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith("https://example.com", []);
  });

  it("keeps the gradient when the resolver throws", async () => {
    // The resolver itself normalises proxy failures to a cached null, but
    // a future code path might throw. The thumb must never let that nuke
    // the card — gradient stays, no `has-og-image` class lands.
    const resolver = makeResolver(() => Promise.reject(new Error("boom")));
    const thumb = buildLinkThumb({
      url: "https://example.com",
      notes: [],
      resolver,
    });
    document.body.append(thumb);
    await Promise.resolve();
    await Promise.resolve();
    expect(thumb.classList.contains("has-og-image")).toBe(false);
  });

  it("stamps the `link-thumb` className on the root element so card grids can layer styles on top", () => {
    const thumb = buildLinkThumb({
      url: "https://example.com",
      notes: [],
      resolver: NOOP_RESOLVER,
    });
    expect(thumb.classList.contains("link-thumb")).toBe(true);
  });

  it("seeds the gradient from a stable fallback string when neither url nor hostname is present", () => {
    // Without a deterministic seed every URL-less card would randomise a
    // hue and the grid would shimmer between renders. The fallback string
    // is `"sutrapad"` — pin its hash so a future tweak that loses the
    // fallback (or swaps it) gets caught.
    const thumb = buildLinkThumb({
      url: null,
      notes: [],
      resolver: NOOP_RESOLVER,
    });
    const expected = hashStringToHue("sutrapad");
    expect(thumb.style.backgroundImage).toContain(`hsl(${expected} 42% 52%)`);
  });

  it("computes the second gradient stop as `(hue + 40) % 360` so the two stops always fall under 360°", () => {
    // Pinning the second stop kills two ArithmeticOperator mutants
    // simultaneously: `(hue + 40) * 360` (huge number, never matches a
    // real `hsl()`) and `hue - 40` (off by 80°). The wrap matters when
    // the seed lands near the top of the range — `nytimes.com` happens
    // to hash to a hue where +40 still fits under 360, which is the
    // common case; the explicit modulo is what guards the wrap edge.
    const url = "https://www.nytimes.com/article";
    const thumb = buildLinkThumb({
      url,
      notes: [],
      resolver: NOOP_RESOLVER,
    });
    const hue = hashStringToHue("nytimes.com");
    const second = (hue + 40) % 360;
    expect(thumb.style.backgroundImage).toContain(`hsl(${hue} 42% 52%)`);
    expect(thumb.style.backgroundImage).toContain(`hsl(${second} 60% 38%)`);
    // Sanity: `hue - 40` would be a different number, and `(hue + 40) * 360`
    // would explode out of any HSL-range value.
    expect(thumb.style.backgroundImage).not.toContain(`hsl(${hue - 40} 60% 38%)`);
  });

  it("paints the og:image into background-image / size / position and stamps `has-og-image` once the probe loads", async () => {
    const stub = stubImageLoader("load");
    try {
      const resolver = makeResolver(() =>
        Promise.resolve("https://img.example.com/og.png"),
      );
      const thumb = buildLinkThumb({
        url: "https://example.com",
        notes: [],
        resolver,
      });
      document.body.append(thumb);
      // Two microtask flushes: one for the resolver's promise, one for
      // the synthetic Image `load` event dispatched via queueMicrotask.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(thumb.classList.contains("has-og-image")).toBe(true);
      expect(thumb.style.backgroundImage).toContain(
        'url("https://img.example.com/og.png")',
      );
      expect(thumb.style.backgroundSize).toBe("cover, auto, auto");
      // happy-dom canonicalises shorthand position values: `center` → `center
      // center`, `0 0` → `0px 0px`. Real browsers preserve the source form,
      // so both renderings of the same logical value are acceptable here.
      expect(thumb.style.backgroundPosition).toMatch(
        /^center( center)?, 0(?:px)? 0(?:px)?, 0(?:px)? 0(?:px)?$/,
      );
    } finally {
      stub.restore();
    }
  });

  it("leaves the gradient untouched if the og:image probe errors (404 / CORS / dead host)", async () => {
    // The probe is the safety net that prevents a broken-image icon from
    // landing on the card. Even when the resolver hands over a URL, an
    // error during preload must abort cleanly with no class, no style
    // overrides — gradient stays.
    const stub = stubImageLoader("error");
    try {
      const resolver = makeResolver(() =>
        Promise.resolve("https://img.example.com/missing.png"),
      );
      const thumb = buildLinkThumb({
        url: "https://example.com",
        notes: [],
        resolver,
      });
      document.body.append(thumb);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(thumb.classList.contains("has-og-image")).toBe(false);
      // Original gradient stays put — no `url(...)` was prepended.
      expect(thumb.style.backgroundImage).not.toContain("url(");
      expect(thumb.style.backgroundImage).toContain("linear-gradient");
    } finally {
      stub.restore();
    }
  });

  it("skips the og:image swap when the thumb has been detached between probe load and assignment", async () => {
    // Same race as the resolver-detach test, but for the inner Image
    // probe path: the load event arrives after the card was unmounted;
    // touching styles on a detached node would be a wasted write at
    // best and a memory leak at worst.
    const stub = stubImageLoader("load");
    try {
      const resolver = makeResolver(() =>
        Promise.resolve("https://img.example.com/og.png"),
      );
      const thumb = buildLinkThumb({
        url: "https://example.com",
        notes: [],
        resolver,
      });
      document.body.append(thumb);
      // Wait for the resolver's promise but unmount before the Image
      // load event fires.
      await Promise.resolve();
      thumb.remove();
      await Promise.resolve();
      await Promise.resolve();

      expect(thumb.classList.contains("has-og-image")).toBe(false);
      expect(thumb.style.backgroundImage).not.toContain("url(");
    } finally {
      stub.restore();
    }
  });

  it("does nothing — and skips the Image preload entirely — when the thumb has been detached before the resolver settles", async () => {
    // Cards re-render aggressively (every workspace mutation); a card
    // that's detached before its og:image promise resolves must not
    // touch the no-longer-mounted node, and shouldn't even kick off the
    // Image-preload network round-trip (the resolved URL points at a
    // proxy we don't want to hit unnecessarily).
    //
    // Held inside an object so TS doesn't narrow the captured `resolve`
    // back to `null` after the Promise executor closure assigns it —
    // closure assignments to a bare `let` aren't tracked by control-flow
    // analysis, which collapses the call site type to `never`.
    const stub = stubImageLoader("load");
    try {
      const resolveBox: { fn: ((value: string) => void) | null } = { fn: null };
      const resolver = makeResolver(
        () =>
          new Promise<string>((resolve) => {
            resolveBox.fn = resolve;
          }),
      );
      const thumb = buildLinkThumb({
        url: "https://example.com",
        notes: [],
        resolver,
      });
      document.body.append(thumb);
      thumb.remove();
      resolveBox.fn?.("https://img.example.com/og.png");
      await Promise.resolve();
      await Promise.resolve();
      expect(thumb.classList.contains("has-og-image")).toBe(false);
      // The pre-mount `if (!thumb.isConnected) return` guard kept us out of
      // `applyOgImageToThumb` entirely — no `new Image()` was constructed,
      // so we never even attempted the preload. Without this assertion the
      // outer guard's mutant survives via the inner `if (!thumb.isConnected)`
      // backstop inside `applyOgImageToThumb`.
      expect(stub.constructed()).toBe(0);
    } finally {
      stub.restore();
    }
  });
});
