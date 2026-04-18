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
  )].sort((left, right) => left.localeCompare(right));
}

export function writeTagFiltersToLocation(url: string, tags: string[]): string {
  const nextUrl = new URL(url);
  const canonicalTags = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  if (canonicalTags.length === 0) {
    nextUrl.searchParams.delete("tags");
  } else {
    nextUrl.searchParams.set("tags", canonicalTags.join(","));
  }

  return nextUrl.toString();
}
