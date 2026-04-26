import { describe, expect, it } from "vitest";

import { buildPwaManifest } from "../src/lib/pwa-manifest";

describe("buildPwaManifest", () => {
  it("populates every user-visible identity field with its exact pinned value", () => {
    // Each field is asserted via `toBe` rather than shape — a silent
    // typo in the manifest (or a future refactor that swaps the value
    // for a placeholder) would otherwise ship to install-prompt UIs
    // and the OS-level app drawer without warning.
    const manifest = buildPwaManifest("/sutrapad/");
    expect(manifest.name).toBe("SutraPad");
    expect(manifest.short_name).toBe("SutraPad");
    expect(manifest.description).toBe(
      "Store and manage your Gerumpel on Google Drive - powered entirely by browser magic, questionable decisions, and multiple JSON files.",
    );
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#f5f0e8");
    expect(manifest.theme_color).toBe("#e7dfcf");
    expect(manifest.lang).toBe("en");
  });

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

  it("declares exactly one icon entry — a maskable SVG at ./icon.svg", () => {
    // Pinned shape: a stray duplicate or a swap from `any maskable` to
    // `any` would silently disable the maskable rendering pipeline on
    // Android (icons clipped to a circle without our safe-zone padding).
    expect(buildPwaManifest("/sutrapad/").icons).toEqual([
      {
        src: "./icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ]);
  });

  it("threads the caller-provided base through every URL slot", () => {
    // `start_url`, `scope`, and `share_target.action` must always agree
    // — a divergence would cause the installed PWA to launch into a
    // different scope than its share target, producing a fresh tab on
    // every share invocation instead of resuming the existing window.
    const manifest = buildPwaManifest("/foo/");
    expect(manifest.start_url).toBe("/foo/");
    expect(manifest.scope).toBe("/foo/");
    expect(manifest.share_target?.action).toBe("/foo/");
  });
});
