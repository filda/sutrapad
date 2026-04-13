import { describe, expect, it } from "vitest";
import { buildBookmarklet } from "../src/lib/bookmarklet";

describe("bookmarklet", () => {
  it("builds a bookmarklet that targets the current app root", () => {
    const bookmarklet = buildBookmarklet("https://filda.github.io/sutrapad/");

    expect(bookmarklet.startsWith("javascript:")).toBe(true);
    expect(bookmarklet).toContain("https://filda.github.io/sutrapad/");
    expect(bookmarklet).toContain('searchParams.set("url", window.location.href)');
    expect(bookmarklet).toContain('searchParams.set("title", document.title)');
  });
});
