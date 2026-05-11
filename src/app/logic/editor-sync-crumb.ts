/**
 * Formats the compact "last change" crumb shown at the end of the detail
 * topbar strip — e.g. `synced 22:00` for an edit made earlier today, or
 * `synced 11 May, 22:00` for an older one. Signed-out users see a
 * `local · …` prefix instead, because no Drive round-trip has happened.
 *
 * Lives outside the view as a pure helper so the same-day / cross-day
 * branch is exercisable by node tests without spinning up a DOM. The
 * `now` injection makes the today-check deterministic across timezones.
 *
 * The chrome topbar already shows a sync-state pill (Loading / Saving /
 * Error / Synced), so this crumb deliberately stays state-blind — it's
 * about *when*, not *what's happening right now*.
 */

export interface FormatLastChangeOptions {
  /**
   * Whether the user has a Drive-backed profile. When false, the crumb
   * uses `local · …` to make it clear that the timestamp reflects an
   * in-device edit, not a synced state.
   */
  signedIn: boolean;
  /**
   * Reference point for the "same-day" check. Tests pin this; the call
   * site in render-app passes `new Date()`. Defaulting here lets unit
   * tests skip the option, but production paths should be explicit.
   */
  now?: Date;
}

export function formatLastChange(
  updatedAtIso: string,
  options: FormatLastChangeOptions,
): string {
  const updatedAt = new Date(updatedAtIso);
  const now = options.now ?? new Date();
  const prefix = options.signedIn ? "synced" : "local ·";

  const time = new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(updatedAt);

  if (isSameLocalDay(updatedAt, now)) {
    return `${prefix} ${time}`;
  }

  // Cross-day edits get the date too — `medium` matches the existing
  // `formatDate` helper's date style, so the breadcrumb stays in the
  // same visual register as other date strings in the app.
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(updatedAt);
  return `${prefix} ${date}, ${time}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
