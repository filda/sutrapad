// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { buildLinkThumb } from "../src/app/view/shared/link-thumb";
import type { OgImageResolver } from "../src/app/logic/og-image-resolver";

function makeResolver(impl: OgImageResolver["resolve"]): OgImageResolver {
  return { resolve: impl };
}

const NOOP_RESOLVER = makeResolver(() => Promise.resolve(null));

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
    // Gradient still lands on `background` so the thumb is never blank.
    expect(thumb.style.background).toContain("linear-gradient");
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

  it("does nothing when the thumb has been detached before the resolver settles", async () => {
    // Cards re-render aggressively (every workspace mutation); a card
    // that's detached before its og:image promise resolves must not
    // touch the no-longer-mounted node.
    // Held inside an object so TS doesn't narrow the captured `resolve`
    // back to `null` after the Promise executor closure assigns it —
    // closure assignments to a bare `let` aren't tracked by control-flow
    // analysis, which collapses the call site type to `never`.
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
    expect(thumb.classList.contains("has-og-image")).toBe(false);
  });
});
