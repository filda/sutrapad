/**
 * Runtime diagnostics model — what the Settings → Diagnostics card shows and
 * what `console.warn` speaks from. Pure: a snapshot plus reducers that
 * return a new snapshot, so every rule is unit-testable and mutation-tested
 * without a DOM or a clock.
 *
 * Three sources feed it (`docs/nfr-testing-plan.md`, layer 2):
 *
 *   - Drive operations (`recordOperation`) — one record per load / save /
 *     refresh / rebuild / hydrate, with the `DriveMeter` counts and wall
 *     time. The last record per kind is kept, plus session totals.
 *   - Soft-budget overruns (`recordOverrun`) from `save-policy.ts`.
 *   - Main-thread observers (`recordLongTask`, `recordInteraction`,
 *     `recordHeapSample`) — counts and worst cases, never raw entries.
 *
 * Nothing here is persisted; the snapshot lives for the session.
 */
import type { BudgetOverrun } from "../../services/drive/save-policy";
import { catalogFor, formatPlural, getActiveLocale, type Locale } from "../../lib/i18n";
import type { PluralForms } from "../../lib/i18n/plural";
import {
  addDriveCounts,
  emptyDriveCounts,
  type DriveMeterCounts,
} from "../../services/drive/drive-meter";

export type DriveOperationKind = "load" | "save" | "restore" | "refresh" | "rebuild" | "hydrate";

export const DRIVE_OPERATION_KINDS: readonly DriveOperationKind[] = [
  "load",
  "save",
  "restore",
  "refresh",
  "rebuild",
  "hydrate",
];

export interface DriveOperationRecord {
  readonly kind: DriveOperationKind;
  /** ISO timestamp of completion. */
  readonly at: string;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly counts: DriveMeterCounts;
}

export interface MainThreadStats {
  /** Blocks of main-thread work over 50 ms (Long Tasks API). */
  readonly longTasks: { count: number; maxMs: number };
  /** Discrete input interactions (Event Timing API `event` entries). */
  readonly interactions: { count: number; maxMs: number };
  /** `performance.memory.usedJSHeapSize` in bytes; null where unavailable. */
  readonly heapUsedBytes: number | null;
}

export interface DiagnosticsSnapshot {
  readonly lastOperation: Readonly<Record<DriveOperationKind, DriveOperationRecord | null>>;
  readonly sessionCounts: DriveMeterCounts;
  readonly operationCount: number;
  /** Most recent overruns, newest first, capped at `MAX_OVERRUNS_KEPT`. */
  readonly overruns: readonly BudgetOverrun[];
  readonly mainThread: MainThreadStats;
}

export const MAX_OVERRUNS_KEPT = 10;

/**
 * An interaction slower than this is reported to the console. Same
 * threshold the web-vitals "needs improvement" band uses for INP.
 */
export const INTERACTION_WARN_MS = 200;

/** A long task at least this long is reported to the console. */
export const LONG_TASK_WARN_MS = 200;

export function createEmptyDiagnostics(): DiagnosticsSnapshot {
  return {
    lastOperation: {
      load: null,
      save: null,
      restore: null,
      refresh: null,
      rebuild: null,
      hydrate: null,
    },
    sessionCounts: emptyDriveCounts(),
    operationCount: 0,
    overruns: [],
    mainThread: {
      longTasks: { count: 0, maxMs: 0 },
      interactions: { count: 0, maxMs: 0 },
      heapUsedBytes: null,
    },
  };
}

export function recordOperation(
  snapshot: DiagnosticsSnapshot,
  record: DriveOperationRecord,
): DiagnosticsSnapshot {
  return {
    ...snapshot,
    lastOperation: { ...snapshot.lastOperation, [record.kind]: record },
    sessionCounts: addDriveCounts(snapshot.sessionCounts, record.counts),
    operationCount: snapshot.operationCount + 1,
  };
}

export function recordOverrun(
  snapshot: DiagnosticsSnapshot,
  overrun: BudgetOverrun,
): DiagnosticsSnapshot {
  return {
    ...snapshot,
    overruns: [overrun, ...snapshot.overruns].slice(0, MAX_OVERRUNS_KEPT),
  };
}

export function recordLongTask(snapshot: DiagnosticsSnapshot, durationMs: number): DiagnosticsSnapshot {
  const { longTasks } = snapshot.mainThread;
  return {
    ...snapshot,
    mainThread: {
      ...snapshot.mainThread,
      longTasks: { count: longTasks.count + 1, maxMs: Math.max(longTasks.maxMs, durationMs) },
    },
  };
}

export function recordInteraction(
  snapshot: DiagnosticsSnapshot,
  durationMs: number,
): DiagnosticsSnapshot {
  const { interactions } = snapshot.mainThread;
  return {
    ...snapshot,
    mainThread: {
      ...snapshot.mainThread,
      interactions: {
        count: interactions.count + 1,
        maxMs: Math.max(interactions.maxMs, durationMs),
      },
    },
  };
}

export function recordHeapSample(snapshot: DiagnosticsSnapshot, usedBytes: number): DiagnosticsSnapshot {
  return {
    ...snapshot,
    mainThread: { ...snapshot.mainThread, heapUsedBytes: usedBytes },
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** `1234` → `"1.2 s"`, `87.4` → `"87 ms"`. */
export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

/** Bytes → `"12.3 MB"`. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One line per Drive operation, in the fixed `[budget]`-style shape the
 * console gets: kind, request total, note uploads, duration, failure flag.
 * Locale-independent — this is telemetry, not UI copy.
 */
export function describeOperationForConsole(record: DriveOperationRecord): string {
  const parts = [
    `[drive] ${record.kind}`,
    `${record.counts.total} requests`,
    `${record.counts.noteUploads} note uploads`,
    `peak ${record.counts.peakInFlight}`,
    formatDuration(record.durationMs),
  ];
  if (!record.ok) parts.push("FAILED");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Settings card rows
// ---------------------------------------------------------------------------

export interface DiagnosticsRow {
  readonly id:
    | "lastLoad"
    | "lastRestore"
    | "lastSave"
    | "lastRefresh"
    | "lastRebuild"
    | "lastHydrate"
    | "session"
    | "overruns"
    | "mainThread"
    | "memory";
  readonly label: string;
  readonly value: string;
}

/**
 * The Diagnostics card as label/value rows, localised. Takes the locale
 * rather than a catalog for the same reason `describeRebuildStatus` does:
 * the counted messages need `Intl.PluralRules` for that locale.
 */
export function describeDiagnostics(
  snapshot: DiagnosticsSnapshot,
  locale: Locale = getActiveLocale(),
): DiagnosticsRow[] {
  const copy = catalogFor(locale).settings.diagnostics;
  const plural = (count: number, forms: PluralForms): string => formatPlural(locale, count, forms);

  const operation = (record: DriveOperationRecord | null): string => {
    if (record === null) return copy.none;
    const parts = [plural(record.counts.total, copy.requests)];
    if (record.counts.noteUploads > 0) parts.push(plural(record.counts.noteUploads, copy.noteUploads));
    parts.push(formatDuration(record.durationMs));
    if (!record.ok) parts.push(copy.failed);
    return parts.join(" · ");
  };

  const session =
    snapshot.operationCount === 0
      ? copy.none
      : [
          plural(snapshot.operationCount, copy.operations),
          plural(snapshot.sessionCounts.total, copy.requests),
          plural(snapshot.sessionCounts.noteUploads, copy.noteUploads),
        ].join(" · ");

  const overruns =
    snapshot.overruns.length === 0
      ? copy.noOverruns
      : `${plural(snapshot.overruns.length, copy.overrunCount)} · ${snapshot.overruns[0].message}`;

  const { longTasks, interactions, heapUsedBytes } = snapshot.mainThread;
  const mainThread =
    longTasks.count === 0 && interactions.count === 0
      ? copy.none
      : [
          copy.longTasks(longTasks.count, formatDuration(longTasks.maxMs)),
          copy.interactions(interactions.count, formatDuration(interactions.maxMs)),
        ].join(" · ");

  return [
    { id: "lastLoad", label: copy.rows.lastLoad, value: operation(snapshot.lastOperation.load) },
    { id: "lastRestore", label: copy.rows.lastRestore, value: operation(snapshot.lastOperation.restore) },
    { id: "lastSave", label: copy.rows.lastSave, value: operation(snapshot.lastOperation.save) },
    { id: "lastRefresh", label: copy.rows.lastRefresh, value: operation(snapshot.lastOperation.refresh) },
    { id: "lastRebuild", label: copy.rows.lastRebuild, value: operation(snapshot.lastOperation.rebuild) },
    { id: "lastHydrate", label: copy.rows.lastHydrate, value: operation(snapshot.lastOperation.hydrate) },
    { id: "session", label: copy.rows.session, value: session },
    { id: "overruns", label: copy.rows.overruns, value: overruns },
    { id: "mainThread", label: copy.rows.mainThread, value: mainThread },
    {
      id: "memory",
      label: copy.rows.memory,
      value: heapUsedBytes === null ? copy.notAvailable : formatMegabytes(heapUsedBytes),
    },
  ];
}
