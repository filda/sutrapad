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
    expect(bookmarklet).toContain('window.open(finalUrl, "_blank")');
    expect(bookmarklet).toContain("opened.opener = null");
    expect(bookmarklet).not.toContain("noopener");
  });

  it("removes query and hash fragments from the app URL before building the bookmarklet", () => {
    const bookmarklet = buildBookmarklet("https://filda.github.io/sutrapad/?draft=1#capture");

    expect(bookmarklet).toContain('"https://filda.github.io/sutrapad/"');
    expect(bookmarklet).not.toContain("draft=1");
    expect(bookmarklet).not.toContain("#capture");
    expect(bookmarklet).not.toContain("  ");
  });
});
