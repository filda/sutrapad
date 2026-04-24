import { describe, expect, it } from "vitest";
import { buildBookmarklet } from "../src/lib/bookmarklet";

describe("bookmarklet", () => {
  it("builds a bookmarklet that targets the current app root", () => {
    const bookmarklet = buildBookmarklet("https://filda.github.io/sutrapad/");

    expect(bookmarklet.startsWith("javascript:")).toBe(true);
    expect(bookmarklet).toContain("https://filda.github.io/sutrapad/");
    expect(bookmarklet).toContain('searchParams.set("url", window.location.href)');
    expect(bookmarklet).toContain('searchParams.set("title", document.title)');
    expect(bookmarklet).toContain('searchParams.set("capture", JSON.stringify(capture))');
    expect(bookmarklet).toContain("document.referrer");
    expect(bookmarklet).toContain("performance.now()");
  });

  it("captures the current text selection when one is present", () => {
    // Pin: the bookmarklet reads `window.getSelection()` and writes a
    // `selection` query param when the user has highlighted text.
    // The silent runner picks it up via `extractSelectionFromUrl`
    // and promotes it into the note body.
    const bookmarklet = buildBookmarklet("https://app/");
    expect(bookmarklet).toContain("window.getSelection");
    expect(bookmarklet).toContain('searchParams.set("selection", selection)');
  });

  it("flags the open with `silent=1` so the runner closes itself after save", () => {
    // The silent flag tells `main.ts` to fork into `runSilentCapture`
    // instead of mounting the regular UI. After a successful save the
    // runner calls `window.close()` and the user's source page keeps
    // focus (browsers return focus to the opener tab on close).
    const bookmarklet = buildBookmarklet("https://app/");
    expect(bookmarklet).toContain('searchParams.set("silent", "1")');
  });

  it("opens the app in a new tab and keeps the opener relationship intact for window.close", () => {
    // `window.open` is the only side-effect — no iframe, no
    // postMessage, no toast. The popup-blocked branch falls back to
    // `location.href` so capture still works on browsers / sites
    // where popups are forbidden.
    //
    // The opener relationship is *deliberately not nulled* here.
    // Per the HTML spec, a script-opened tab can only call
    // `window.close()` on itself when its opener is non-null — and
    // the silent runner relies on that close. The old precaution of
    // `opened.opener = null` (reverse-tabnabbing guard) was the bug
    // that broke auto-close after a successful save.
    const bookmarklet = buildBookmarklet("https://app/");
    expect(bookmarklet).toContain('window.open(finalUrl, "_blank")');
    expect(bookmarklet).not.toContain("opener = null");
    expect(bookmarklet).toContain("window.location.href = finalUrl");
  });

  it("removes query and hash fragments from the app URL before building the bookmarklet", () => {
    const bookmarklet = buildBookmarklet("https://filda.github.io/sutrapad/?draft=1#capture");

    expect(bookmarklet).toContain('"https://filda.github.io/sutrapad/"');
    expect(bookmarklet).not.toContain("draft=1");
    expect(bookmarklet).not.toContain("#capture");
    expect(bookmarklet).not.toContain("  ");
    expect(bookmarklet).toBe(bookmarklet.trim());
  });

  it("produces a body that parses as syntactically valid JavaScript", () => {
    // Regression: the build step collapses every whitespace run to a
    // single space, which silently turns a `//` line comment in the
    // template literal into a comment that eats the rest of the
    // file — including the closing `})();` of the IIFE — and the
    // browser surfaces it as "Uncaught SyntaxError: Unexpected end
    // of input" only when the user clicks the bookmarklet. The build
    // / typecheck / vitest pipeline never touches the inlined string
    // form, so we have to parse it explicitly here.
    const bookmarklet = buildBookmarklet("https://app/");
    const body = bookmarklet.replace(/^javascript:/, "");
    expect(() => new Function(body)).not.toThrow();
  });

  it("does not contain `//` line comments inside the bookmarklet body", () => {
    // Belt-and-braces guard: even if the parse test above ever
    // passes for a degenerate input where the comment happens to
    // chew up something benign, this catches the fundamental
    // "no line comments allowed" rule head-on. Every `//` inside
    // the inlined body must be inside a string literal (e.g.
    // protocol prefixes in URLs).
    const bookmarklet = buildBookmarklet("https://app/");
    const body = bookmarklet.replace(/^javascript:/, "");
    // Strip every quoted string so we don't false-positive on
    // `https://`. Templating + meta-regex inside JS is fragile but
    // good enough for our generated bookmarklet, which doesn't use
    // template literals or regex literals.
    const withoutStrings = body
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    expect(withoutStrings).not.toMatch(/\/\//);
  });
});
