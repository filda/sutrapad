import type { ManifestOptions } from "vite-plugin-pwa";

export function buildPwaManifest(base: string): Partial<ManifestOptions> {
  return {
    name: "SutraPad",
    short_name: "SutraPad",
    description:
      "Store and manage your Gerumpel on Google Drive - powered entirely by browser magic, questionable decisions, and multiple JSON files.",
    start_url: base,
    scope: base,
    display: "standalone",
    background_color: "#f5f0e8",
    theme_color: "#e7dfcf",
    lang: "en",
    share_target: {
      action: base,
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: {
        title: "title",
        text: "note",
        url: "url",
      },
    },
    icons: [
      {
        src: "./icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };
}
