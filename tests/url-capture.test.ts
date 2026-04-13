import { describe, expect, it } from "vitest";
import {
  clearUrlCaptureFromLocation,
  deriveTitleFromUrl,
  extractHtmlTitle,
  readUrlCapture,
} from "../src/lib/url-capture";

describe("url capture helpers", () => {
  it("reads the capture payload from the query string", () => {
    const payload = readUrlCapture(
      "https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com%2Fhello-world&title=Hello%20World",
    );

    expect(payload).toEqual({
      title: "Hello World",
      url: "https://example.com/hello-world",
    });
  });

  it("clears capture parameters from the location", () => {
    expect(
      clearUrlCaptureFromLocation(
        "https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com&title=Hello&x=1",
      ),
    ).toBe("https://filda.github.io/sutrapad/?x=1");
  });

  it("derives a reasonable fallback title from the captured URL", () => {
    expect(deriveTitleFromUrl("https://example.com/hello-world_post")).toBe(
      "hello world post · example.com",
    );
  });

  it("extracts a title from HTML", () => {
    expect(
      extractHtmlTitle(
        '<html lang="en"><head><title>  Example Page  </title></head></html>',
      ),
    ).toBe("Example Page");
  });
});
