import type { SutraPadTagFilterMode } from "../../types";

export function readTagFiltersFromLocation(url: string): string[] {
  const filters = new URL(url).searchParams.get("tags");
  if (!filters) {
    return [];
  }

  return [...new Set(
    filters
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  )].toSorted((left, right) => left.localeCompare(right));
}

/**
 * Reads the `tagsMode=any|all` query parameter. Unknown or missing values
 * collapse to `"all"`, which is both the historical default (before the
 * parameter existed) and the mode users are most likely to mean when they
 * share a URL without thinking about the combination rule. This keeps every
 * pre-existing share link rendering exactly as it used to.
 */
export function readTagFilterModeFromLocation(url: string): SutraPadTagFilterMode {
  const raw = new URL(url).searchParams.get("tagsMode");
  return raw === "any" ? "any" : "all";
}

export function writeTagFiltersToLocation(url: string, tags: string[]): string {
  const nextUrl = new URL(url);
  const canonicalTags = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
    .toSorted((left, right) => left.localeCompare(right));
  if (canonicalTags.length === 0) {
    nextUrl.searchParams.delete("tags");
  } else {
    nextUrl.searchParams.set("tags", canonicalTags.join(","));
  }

  return nextUrl.toString();
}

/**
 * Writes the `tagsMode` query parameter, omitting it when the value is the
 * default (`"all"`). Keeping the default implicit means the URL stays tidy
 * for the majority case and every shared link from before this parameter
 * existed round-trips to itself verbatim.
 */
export function writeTagFilterModeToLocation(
  url: string,
  mode: SutraPadTagFilterMode,
): string {
  const nextUrl = new URL(url);
  if (mode === "all") {
    nextUrl.searchParams.delete("tagsMode");
  } else {
    nextUrl.searchParams.set("tagsMode", mode);
  }
  return nextUrl.toString();
}
