export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

export function formatBuildStamp(
  version: string,
  commitHash: string,
  buildTime: string,
): string {
  const builtAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(buildTime));

  return `v${version} · ${commitHash} · built ${builtAt}`;
}
