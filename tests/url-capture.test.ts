import { describe, expect, it } from "vitest";
import {
  buildNoteCaptureTitle,
  clearCaptureParamsFromLocation,
  derivePlaceLabel,
  deriveTitleFromUrl,
  extractHtmlTitle,
  formatCoordinates,
  getDaypart,
  readNoteCapture,
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
      clearCaptureParamsFromLocation(
        "https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com&title=Hello&x=1",
      ),
    ).toBe("https://filda.github.io/sutrapad/?x=1");
  });

  it("reads the note payload from the query string", () => {
    expect(
      readNoteCapture("https://filda.github.io/sutrapad/?note=Remember%20milk"),
    ).toEqual({
      note: "Remember milk",
    });
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

  it("builds a note capture title from date and place", () => {
    expect(buildNoteCaptureTitle(new Date("2026-04-14T00:15:00"), "Libeň")).toBe(
      "14/04/2026 · midnight · Libeň",
    );
  });

  it("detects dayparts and formats coordinates", () => {
    expect(getDaypart(new Date("2026-04-14T00:15:00"))).toBe("midnight");
    expect(getDaypart(new Date("2026-04-14T06:30:00"))).toBe("early morning");
    expect(getDaypart(new Date("2026-04-14T12:00:00"))).toBe("high noon");
    expect(getDaypart(new Date("2026-04-14T16:45:00"))).toBe("late afternoon");
    expect(getDaypart(new Date("2026-04-14T21:15:00"))).toBe("late evening");
    expect(formatCoordinates({ latitude: 50.1034, longitude: 14.4721 })).toBe(
      "50.1034, 14.4721",
    );
  });

  it("derives a place label from reverse geocoding data", () => {
    expect(
      derivePlaceLabel({
        suburb: "Libeň",
        city: "Prague",
      }),
    ).toBe("Libeň");

    expect(
      derivePlaceLabel({
        town: "Říčany",
        country: "Czechia",
      }),
    ).toBe("Říčany");
  });
});
