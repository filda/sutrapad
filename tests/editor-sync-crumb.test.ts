import { describe, expect, it } from "vitest";
import { formatLastChange } from "../src/app/logic/editor-sync-crumb";

const NOON_TODAY = new Date("2026-05-11T12:00:00Z");

describe("formatLastChange", () => {
  it("uses time-only when the update happened earlier the same day", () => {
    const updatedAt = new Date("2026-05-11T08:30:00Z");
    const text = formatLastChange(updatedAt.toISOString(), {
      signedIn: true,
      now: NOON_TODAY,
    });
    const expectedTime = new Intl.DateTimeFormat(undefined, {
      timeStyle: "short",
    }).format(updatedAt);
    // The crumb is `<prefix> <short-time>` — equality on the whole
    // string pins both the option object (an ObjectLiteral mutant that
    // strips `timeStyle: "short"` produces a long-form time and breaks
    // this) and the absence of a date component (same-day branch).
    expect(text).toBe(`synced ${expectedTime}`);
  });

  it("includes a date component for cross-day edits", () => {
    const updatedAt = new Date("2026-04-30T08:30:00Z");
    const text = formatLastChange(updatedAt.toISOString(), {
      signedIn: true,
      now: NOON_TODAY,
    });
    const expectedDate = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(updatedAt);
    const expectedTime = new Intl.DateTimeFormat(undefined, {
      timeStyle: "short",
    }).format(updatedAt);
    // Full-string equality kills the ObjectLiteral mutant on
    // `{ dateStyle: "medium" }` too — `{}` produces a numeric short
    // form that doesn't match `expectedDate`.
    expect(text).toBe(`synced ${expectedDate}, ${expectedTime}`);
  });

  it("uses the `local ·` prefix when the user is signed out", () => {
    const updatedAt = new Date("2026-05-11T08:30:00Z").toISOString();
    const text = formatLastChange(updatedAt, { signedIn: false, now: NOON_TODAY });
    expect(text.startsWith("local · ")).toBe(true);
  });

  it("keeps the `local ·` prefix on cross-day edits too", () => {
    const updatedAt = new Date("2025-12-31T23:59:00Z").toISOString();
    const text = formatLastChange(updatedAt, { signedIn: false, now: NOON_TODAY });
    expect(text.startsWith("local · ")).toBe(true);
    expect(text).toContain(",");
  });

  it("checks same-day by local calendar date, not UTC", () => {
    // Pick two instants whose UTC days differ by one (23:00 UTC vs 01:00
    // UTC next day) but whose *local* day depends on TZ. We pin a single
    // ISO timestamp and confirm the helper consults the local-date getters
    // (getFullYear / getMonth / getDate) so it tracks the user's calendar,
    // not UTC midnight — a Math.floor on epoch / 86400000 would slip here.
    const updatedAt = new Date(2026, 4, 11, 8, 30).toISOString();
    const sameLocalDay = new Date(2026, 4, 11, 23, 59);
    const text = formatLastChange(updatedAt, { signedIn: true, now: sameLocalDay });
    expect(text).not.toContain(",");
  });

  it("flips to the cross-day branch one local day apart", () => {
    const updatedAt = new Date(2026, 4, 10, 23, 59).toISOString();
    const nextLocalDay = new Date(2026, 4, 11, 0, 0, 1);
    const text = formatLastChange(updatedAt, { signedIn: true, now: nextLocalDay });
    expect(text).toContain(",");
  });

  it("treats same day-of-month in a different month as cross-day", () => {
    // 11 April vs 11 May share `getDate() === 11`. The function must
    // also compare months — a mutant that replaces the month check
    // with `true` would treat these as the same day and drop the date
    // component. We pin the cross-day shape by asserting the comma.
    const updatedAt = new Date(2026, 3, 11, 12, 0).toISOString();
    const nextMonth = new Date(2026, 4, 11, 12, 0);
    const text = formatLastChange(updatedAt, { signedIn: true, now: nextMonth });
    expect(text).toContain(",");
  });

  it("treats same date in a different year as cross-day", () => {
    // 11 May 2025 vs 11 May 2026 share month + date. The function must
    // also compare years — a mutant that replaces the year check with
    // `true` (or short-circuits on `getMonth` alone) would treat these
    // as the same day. Year-bracketing keeps long-running notes from
    // looking like they were edited "today" months after the fact.
    const updatedAt = new Date(2025, 4, 11, 12, 0).toISOString();
    const nextYear = new Date(2026, 4, 11, 12, 0);
    const text = formatLastChange(updatedAt, { signedIn: true, now: nextYear });
    expect(text).toContain(",");
  });

  it("defaults `now` to wall-clock when not provided", () => {
    // We can't pin formatted output without controlling `now`, but we can
    // assert the function still returns a non-empty `synced …` string —
    // i.e. the default-`now` branch executes. A regression that dropped
    // the default would throw a TypeError before reaching the formatter.
    const updatedAt = new Date().toISOString();
    expect(() => formatLastChange(updatedAt, { signedIn: true })).not.toThrow();
    expect(formatLastChange(updatedAt, { signedIn: true })).toMatch(/^synced /);
  });
});
