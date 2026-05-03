/**
 * Shared link-thumb builder used by the Notes, Links and Tasks card
 * surfaces. Renders a gradient placeholder with a hostname chip stamped
 * over it, then asynchronously swaps the gradient for an og:image when
 * the resolver returns one. The gradient hue is hashed off the hostname
 * so a single domain reads with the same colour everywhere it appears
 * in the workspace.
 *
 * Originally lived inside `links-page.ts`; lifted here so the Notes
 * grid (one card per note → one thumb per primary URL) and the Tasks
 * grid (one card per source note → same primary URL) can reuse the
 * exact same render path. Keeping a single implementation means a
 * future tweak (e.g. a different proxy or a new fallback) only has to
 * land once.
 *
 * The resolver object is passed in by the caller so a single page
 * render can share one localStorage cache snapshot across every thumb
 * — see `createOgImageResolver` in `og-image-resolver.ts`.
 */
import type { SutraPadDocument } from "../../../types";
import { deriveLinkHostname, hashStringToHue } from "../../logic/link-card";
import type { OgImageResolver } from "../../logic/og-image-resolver";

export interface LinkThumbOptions {
  /**
   * Primary URL for this card. When `null`, the thumb still renders so
   * cards stay visually consistent — but the hostname chip is omitted
   * and no og:image resolution is attempted (cheap render path).
   */
  url: string | null;
  /**
   * Notes that the resolver should walk for a capture-time `og:image`.
   * Pass an empty array on the no-URL branch; ignored anyway.
   */
  notes: readonly SutraPadDocument[];
  resolver: OgImageResolver;
}

export function buildLinkThumb({
  url,
  notes,
  resolver,
}: LinkThumbOptions): HTMLElement {
  const thumb = document.createElement("div");
  thumb.className = "link-thumb";

  // Fall back to a neutral seed when the card has no URL: keeps the
  // gradient deterministic across renders without leaning on `Math.random`,
  // and the same note id always produces the same hue if the caller
  // wants to thread one in later. For now we stamp a single seed so
  // every URL-less card reads as the same calm placeholder; persona
  // colours layer on top via `applyPersonaStyles` on the parent card.
  const hostname = url === null ? null : deriveLinkHostname(url);
  const hueSeed = hostname ?? url ?? "sutrapad";
  const hue = hashStringToHue(hueSeed);
  // Two-colour diagonal gradient + a subtle diagonal stripe overlay
  // (handoff: screen_rest.jsx → `.link-thumb`). Inline because the hue
  // is per-card; CSS variable plumbing would cost one custom property
  // per card with no real benefit. We assign `backgroundImage` directly
  // (rather than the `background` shorthand) so the multi-layer value
  // round-trips through browsers and test environments — the shorthand
  // parser in happy-dom collapses multi-gradient values, which would
  // hide the second hue from any DOM-level assertion.
  thumb.style.backgroundImage = `linear-gradient(135deg, hsl(${hue} 42% 52%), hsl(${(hue + 40) % 360} 60% 38%)), repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px)`;

  if (hostname !== null) {
    const domainLabel = document.createElement("span");
    domainLabel.className = "link-thumb-domain";
    domainLabel.textContent = hostname;
    thumb.append(domainLabel);
  }

  // Skip the async fetch when there's no URL — no point spinning up a
  // resolver round-trip for a card that's just decorative.
  if (url !== null) {
    void (async () => {
      let imageUrl: string | null = null;
      try {
        imageUrl = await resolver.resolve(url, notes);
      } catch {
        // Resolver promises don't throw in the happy path; if a future
        // code path does, leave `imageUrl` at its initial null and the
        // next guard bails. No explicit `return` here — it would be
        // an equivalent mutation surface (the `if (!imageUrl) return`
        // immediately below catches the same control-flow exit).
      }
      if (!imageUrl) return;
      if (!thumb.isConnected) return;
      applyOgImageToThumb(thumb, imageUrl);
    })();
  }

  return thumb;
}

/**
 * Swaps the thumb's background from gradient to a real og:image while
 * keeping the gradient as a secondary background — so a semi-transparent
 * scrape still reads as a SutraPad card rather than a raw screenshot.
 *
 * Uses an `Image()` pre-load so a 404/CORS-blocked og:image silently
 * keeps the gradient instead of flashing a broken-image icon.
 */
function applyOgImageToThumb(thumb: HTMLElement, imageUrl: string): void {
  const probe = new Image();
  probe.addEventListener("load", () => {
    if (!thumb.isConnected) return;
    thumb.style.backgroundImage = `url("${imageUrl}"), ${thumb.style.backgroundImage}`;
    thumb.style.backgroundSize = "cover, auto, auto";
    thumb.style.backgroundPosition = "center, 0 0, 0 0";
    thumb.classList.add("has-og-image");
  });
  probe.src = imageUrl;
}
