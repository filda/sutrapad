import type { SutraPadDocument } from "../../types";

/**
 * Pure helpers for the Home / Today page. Splits a workspace's notes into
 * Today / Yesterday / Earlier buckets, derives the greeting based on the
 * current hour, and formats the header date and item time strings used in
 * the timeline.
 *
 * Kept DOM-free so the timeline logic (which is easy to get wrong on
 * day-boundary edges) is unit-testable without spinning up the renderer.
 */

export interface HomeNoteGroups {
  today: SutraPadDocument[];
  yesterday: SutraPadDocument[];
  earlier: SutraPadDocument[];
}

/**
 * Bucket notes by their updatedAt relative to `now`. "Today" means the same
 * local calendar date as `now`; "Yesterday" is the previous local calendar
 * date. Everything else falls into "Earlier". Each bucket is sorted newest
 * first so the timeline reads top-down in recency order within a section.
 */
export function groupNotesByRecency(
  notes: readonly SutraPadDocument[],
  now: Date,
): HomeNoteGroups {
  const todayKey = toLocalDateKey(now);
  const yesterdayKey = toLocalDateKey(previousDay(now));

  const sorted = [...notes].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );

  const today: SutraPadDocument[] = [];
  const yesterday: SutraPadDocument[] = [];
  const earlier: SutraPadDocument[] = [];

  for (const note of sorted) {
    const key = toLocalDateKey(new Date(note.updatedAt));
    if (key === todayKey) today.push(note);
    else if (key === yesterdayKey) yesterday.push(note);
    else earlier.push(note);
  }

  return { today, yesterday, earlier };
}

/**
 * Morning / afternoon / evening, partitioned to match typical greeting
 * usage: 05:00–11:59 morning, 12:00–17:59 afternoon, 18:00–04:59 evening.
 * The small-hours block folds into "evening" rather than a fourth "night"
 * option because "Good night, Filip." reads like a send-off, not a welcome.
 */
export type HomeGreeting = "morning" | "afternoon" | "evening";

export function greetingFor(hour: number): HomeGreeting {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/**
 * Header eyebrow string, e.g. "Monday · 21 April". Uses the runtime locale
 * for the weekday and month names so non-en users see their own language;
 * the separator and ordering stay fixed so the visual rhythm matches the
 * handoff regardless of locale.
 */
export function formatHomeHeaderDate(now: Date): string {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now);
  const dayMonth = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
  }).format(now);
  return `${weekday} · ${dayMonth}`;
}

/**
 * Timeline item time stamp, e.g. "14:02". 24-hour, zero-padded, locale-aware
 * but forced to hour12: false so the monospace column is always the same
 * width — a mix of "2:05 PM" and "14:02" would make the gutter jitter.
 */
export function formatNoteTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function toLocalDateKey(d: Date): string {
  // Local YYYY-MM-DD — not ISO, because ISO uses UTC and would flip
  // buckets at the wrong time for anyone not on UTC.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousDay(d: Date): Date {
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  return prev;
}
