import { describe, expect, it } from "vitest";
import {
  LOW_CONFIDENCE_THRESHOLD,
  UNKNOWN_FACET_CONFIDENCE,
  confidenceForAutoTag,
} from "../src/app/logic/auto-tag-confidence";

/**
 * `confidenceForAutoTag` is a table lookup behind a parser. The tests pin the
 * public contract (known facets, fallbacks, threshold semantics) so that
 * view-layer code rendering the `NN%` badge can rely on stable categorisation.
 */

describe("confidenceForAutoTag", () => {
  describe("authoritative timestamp/structural facets", () => {
    it("returns 1.0 for date-family facets", () => {
      expect(confidenceForAutoTag("date:today")).toBe(1);
      expect(confidenceForAutoTag("date:this-week")).toBe(1);
      expect(confidenceForAutoTag("month:2026-04")).toBe(1);
      expect(confidenceForAutoTag("year:2026")).toBe(1);
    });

    it("returns 1.0 for edit and tasks facets (deterministic parse)", () => {
      expect(confidenceForAutoTag("edit:fresh")).toBe(1);
      expect(confidenceForAutoTag("edit:revised")).toBe(1);
      expect(confidenceForAutoTag("tasks:open")).toBe(1);
      expect(confidenceForAutoTag("tasks:done")).toBe(1);
      expect(confidenceForAutoTag("tasks:none")).toBe(1);
    });

    it("returns 1.0 for source facet (set at capture time)", () => {
      expect(confidenceForAutoTag("source:bookmarklet")).toBe(1);
      expect(confidenceForAutoTag("source:new-note")).toBe(1);
    });
  });

  describe("platform self-report facets", () => {
    it("treats device / orientation as high but not perfect (0.95)", () => {
      expect(confidenceForAutoTag("device:mobile")).toBe(0.95);
      expect(confidenceForAutoTag("orientation:portrait")).toBe(0.95);
    });

    it("dips slightly on os / browser / network / battery (0.9)", () => {
      expect(confidenceForAutoTag("os:macos")).toBe(0.9);
      expect(confidenceForAutoTag("browser:safari")).toBe(0.9);
      expect(confidenceForAutoTag("network:online")).toBe(0.9);
      expect(confidenceForAutoTag("battery:low")).toBe(0.9);
    });
  });

  describe("page-metadata facets", () => {
    it("keeps lang and author just above the display threshold", () => {
      expect(confidenceForAutoTag("lang:en")).toBe(0.8);
      expect(confidenceForAutoTag("author:jan-novak")).toBe(0.75);
      expect(confidenceForAutoTag("lang:en")).toBeGreaterThanOrEqual(
        LOW_CONFIDENCE_THRESHOLD,
      );
      expect(confidenceForAutoTag("author:jan-novak")).toBeGreaterThanOrEqual(
        LOW_CONFIDENCE_THRESHOLD,
      );
    });
  });

  describe("heuristic/threshold facets flag as low-confidence", () => {
    it("returns values below the display threshold", () => {
      expect(confidenceForAutoTag("location:prague")).toBe(0.7);
      expect(confidenceForAutoTag("scroll:middle")).toBe(0.65);
      expect(confidenceForAutoTag("engagement:deep-dive")).toBe(0.6);
      expect(confidenceForAutoTag("weather:warm")).toBe(0.6);
    });

    it("`location` is marginal — at the threshold, not below it", () => {
      // Kept as its own assertion so a future re-tune one way or the
      // other makes it explicit whether `location:*` shows a badge.
      expect(confidenceForAutoTag("location:prague")).toBe(
        LOW_CONFIDENCE_THRESHOLD,
      );
    });

    it("scroll, engagement, weather land strictly below the display threshold", () => {
      expect(confidenceForAutoTag("scroll:top")).toBeLessThan(
        LOW_CONFIDENCE_THRESHOLD,
      );
      expect(confidenceForAutoTag("engagement:skimmed")).toBeLessThan(
        LOW_CONFIDENCE_THRESHOLD,
      );
      expect(confidenceForAutoTag("weather:rain")).toBeLessThan(
        LOW_CONFIDENCE_THRESHOLD,
      );
    });
  });

  describe("fallbacks", () => {
    it("returns UNKNOWN_FACET_CONFIDENCE for an unmapped facet", () => {
      expect(confidenceForAutoTag("mood:curious")).toBe(UNKNOWN_FACET_CONFIDENCE);
      expect(confidenceForAutoTag("altitude:above-1000m")).toBe(
        UNKNOWN_FACET_CONFIDENCE,
      );
    });

    it("returns UNKNOWN_FACET_CONFIDENCE for a non-namespaced string", () => {
      // Auto-tags normally arrive namespaced, but a stray plain word
      // shouldn't crash the caller — fall back to the same low-confidence
      // bucket as unknown facets.
      expect(confidenceForAutoTag("undecided")).toBe(UNKNOWN_FACET_CONFIDENCE);
      expect(confidenceForAutoTag("")).toBe(UNKNOWN_FACET_CONFIDENCE);
    });

    it("ignores content after the first colon (multiple colons)", () => {
      // `date:this-week` has one colon; a value that itself contains a
      // colon (e.g. a synthetic tag like `lang:zh:tw`) should still
      // classify by the first segment.
      expect(confidenceForAutoTag("lang:zh:tw")).toBe(0.8);
    });

    it("empty facet (leading colon) falls back to unknown", () => {
      // `parseTagName(":value")` returns `{facet: null, value: ":value"}`
      // because an empty facet is explicitly treated as no facet.
      expect(confidenceForAutoTag(":foo")).toBe(UNKNOWN_FACET_CONFIDENCE);
    });
  });

  describe("UNKNOWN_FACET_CONFIDENCE is below the display threshold", () => {
    it("so new/unmapped facets surface the NN% badge in the UI", () => {
      expect(UNKNOWN_FACET_CONFIDENCE).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    });
  });

  describe("LOW_CONFIDENCE_THRESHOLD", () => {
    it("matches the handoff's 0.7 cutoff", () => {
      expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.7);
    });
  });
});
