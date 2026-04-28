import { describe, expect, it } from "vitest";
import { isIOS, isSafari, isStandalone } from "../src/lib/browser-env";

describe("isSafari", () => {
  it("matches desktop Safari on Mac", () => {
    expect(
      isSafari(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      ),
    ).toBe(true);
  });

  it("rejects Chrome on macOS (carries 'Safari' for compat)", () => {
    expect(
      isSafari(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("rejects Edge on macOS", () => {
    expect(
      isSafari(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
      ),
    ).toBe(false);
  });

  it("rejects Chrome on iOS (CriOS) and Firefox on iOS (FxiOS)", () => {
    // The relevant question for ITP-driven auth behaviour is "is the
    // engine WebKit", which on iOS is universally true regardless of
    // brand. The auth flow uses `isIOS` for that broader signal;
    // `isSafari` is for narrowing the desktop-Mac case where brand
    // and engine align.
    expect(
      isSafari(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.71 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(
      isSafari(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15",
      ),
    ).toBe(false);
  });

  it("rejects Android Chrome (also carries 'Safari' for compat)", () => {
    expect(
      isSafari(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
  });
});

describe("isIOS", () => {
  it("matches iPhone", () => {
    expect(
      isIOS(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        5,
      ),
    ).toBe(true);
  });

  it("matches iPad in iPad-mode UA", () => {
    expect(
      isIOS(
        "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        5,
      ),
    ).toBe(true);
  });

  it("matches iPadOS 13+ desktop-mode (Macintosh UA + touch points)", () => {
    expect(
      isIOS(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        5,
      ),
    ).toBe(true);
  });

  it("does NOT match a real desktop Mac (Macintosh UA + 0 touch points)", () => {
    expect(
      isIOS(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        0,
      ),
    ).toBe(false);
  });

  it("does NOT match a Macintosh UA with exactly 1 touch point (boundary case)", () => {
    // The iPad-desktop-mode heuristic uses `> 1` not `>= 1` because
    // real iPads/iPhones report at least 5 simultaneous touch points,
    // and a Mac with an external touch peripheral may report 1.
    // Pinning the strict-greater boundary kills the mutant where
    // someone "tightens" or "loosens" the comparison without noticing
    // the spec-defined touch-points minimum on iOS hardware.
    expect(
      isIOS(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        1,
      ),
    ).toBe(false);
  });

  it("does NOT match desktop Chrome on Windows", () => {
    expect(
      isIOS(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        0,
      ),
    ).toBe(false);
  });

  it("does NOT match Android Chrome", () => {
    expect(
      isIOS(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        5,
      ),
    ).toBe(false);
  });
});

describe("isStandalone", () => {
  it("returns true when navigator.standalone is the literal boolean true", () => {
    expect(isStandalone({ standalone: true } as unknown as Navigator)).toBe(
      true,
    );
  });

  it("returns false when navigator.standalone is missing", () => {
    expect(isStandalone({} as unknown as Navigator)).toBe(false);
  });

  it("returns false for non-true truthy values (defensive against monkey patches)", () => {
    // The standard signal is a strict boolean; treating "1" or 1 as
    // standalone would make detection brittle if a polyfill ever set
    // it to a truthy non-boolean.
    expect(
      isStandalone({ standalone: "true" } as unknown as Navigator),
    ).toBe(false);
    expect(isStandalone({ standalone: 1 } as unknown as Navigator)).toBe(
      false,
    );
  });
});
