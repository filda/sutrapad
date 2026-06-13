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
import { httpUrlOrNull } from "../../../lib/safe-url";

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
  /**
   * Optional override for the gradient hue seed. The Notes and Tasks
   * grids compute a per-note seed (`pickNoteThumbSeed` in
   * `link-thumb-seed.ts`) so two cards from the same domain can still
   * wear different hues when their tags differ. Links page omits this
   * because its "one card per URL" model wants hostname-based grouping.
   * When omitted the seed falls back to hostname/url, matching the
   * pre-metadata-seed behaviour.
   */
  gradientSeed?: string;
}

export function buildLinkThumb({
  url,
  notes,
  resolver,
  gradientSeed,
}: LinkThumbOptions): HTMLElement {
  const thumb = document.createElement("div");
  thumb.className = "link-thumb";

  // Seed priority:
  //   1. caller-supplied `gradientSeed` — Notes/Tasks plumb a per-note
  //      seed derived from tags / hostname / note.id so cards on a
  //      dense grid don't all collapse into the one shared `"sutrapad"`
  //      olive hue that the URL-less branch produced.
  //   2. hostname — preserved for the Links page (one card per URL).
  //   3. raw `url` string — defensive guard for malformed URLs where
  //      hostname parsing fails; still better than the literal fallback.
  //   4. literal `"sutrapad"` — last-resort. Stable across renders so
  //      a card that somehow lands here doesn't shimmer between paints.
  const hostname = url === null ? null : deriveLinkHostname(url);
  const hueSeed = gradientSeed ?? hostname ?? url ?? "sutrapad";
  const hue = hashStringToHue(hueSeed);
  // Two-colour diagonal gradient + a subtle diagonal stripe overlay
  // (handoff: screen_rest.jsx → `.link-thumb`). Inline because the hue
  // is per-card; CSS variable plumbing would cost one custom property
  // per card with no real benefit. We assign `backgroundImage` directly
  // (rather than the `background` shorthand) so the multi-layer value
  // round-trips through browsers and test environments — the shorthand
  // parser in happy-dom collapses multi-gradient values, which would
  // hide the second hue from any DOM-level assertion.
  //
  // Curve tuned 2026-05-12 (second pass): dropped back into the paper
  // register so the band reads as "tinted paper" rather than a saturated
  // stamp glued on top of the persona body. Stop 1 lands at `35% 75%`
  // (light pastel — top edge of the band, fades into the paper-ish
  // hairline boundary), stop 2 at `55% 50%` (mid saturation, mid
  // lightness — the bottom edge where the domain chip needs enough
  // contrast for its white-on-text-shadow legibility). The earlier
  // 65%/72% saturation lift solved the muddy-olive problem but
  // overshot into "glaring"; this pass keeps the per-tag hue variety
  // while pulling the chroma down so warm-paper bodies (cream/tan)
  // and cool-paper bodies (night grey) both stay in the same family
  // as the band sitting on top of them.
  thumb.style.backgroundImage = `linear-gradient(135deg, hsl(${hue} 35% 75%), hsl(${(hue + 40) % 360} 55% 50%)), repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px)`;

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
  // Final sink gate. The resolved URL may originate from Drive-loaded
  // capture context, the localStorage cache, or a runtime scrape — all
  // attacker-influenceable. Normalise to an http(s) URL (which percent-
  // encodes any quote / space / control char that could otherwise break
  // out of the quoted `url("…")` token below) and bail to the gradient
  // when it isn't one, rather than trusting the upstream layers alone.
  const safeUrl = httpUrlOrNull(imageUrl);
  if (safeUrl === null) return;
  const probe = new Image();
  probe.addEventListener("load", () => {
    if (!thumb.isConnected) return;
    thumb.style.backgroundImage = `url("${safeUrl}"), ${thumb.style.backgroundImage}`;
    thumb.style.backgroundSize = "cover, auto, auto";
    thumb.style.backgroundPosition = "center, 0 0, 0 0";
    thumb.classList.add("has-og-image");
  });
  probe.src = safeUrl;
}
