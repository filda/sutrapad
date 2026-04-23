import { describe, expect, it } from "vitest";

import { buildPwaManifest } from "../src/lib/pwa-manifest";

describe("buildPwaManifest", () => {
  it("exposes an Android share target that reuses the capture query parameters", () => {
    expect(buildPwaManifest("/sutrapad/")).toMatchObject({
      start_url: "/sutrapad/",
      scope: "/sutrapad/",
      share_target: {
        action: "/sutrapad/",
        method: "GET",
        enctype: "application/x-www-form-urlencoded",
        params: {
          title: "title",
          text: "note",
          url: "url",
        },
      },
    });
  });
});
