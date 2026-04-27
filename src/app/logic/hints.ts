/**
 * Home-page hint engine — picks one rotating tip out of a registered set.
 *
 * Hints are short banners that nudge the user toward a useful next step:
 * "install a capture button," "merge these duplicate tags," "pick today's
 * one thing." Only one is shown at a time, even when several would
 * theoretically apply, so the home page never reads as a checklist of
 * unfinished housework.
 *
 * Selection rule:
 *   1. Candidate is **applicable** — its gate function returns true. Each
 *      candidate decides what "applicable" means (signed in? has duplicate
 *      tags? has open tasks but no pin?). Candidates are pure functions of
 *      a single shared {@link HintContext} so the same workspace snapshot
 *      drives every gate.
 *   2. Candidate is **not in cooldown** — the user dismissed it less than
 *      `cooldownDays` ago. A dismiss isn't permanent: the user said "not
 *      now," not "never." Each candidate sets its own cooldown (one day
 *      for a daily nudge, thirty days for an onboarding bumper).
 *   3. Among the survivors, **highest `priority` wins**. An onboarding
 *      install hint outranks a hygiene nudge.
 *   4. Within a priority tier, the **least-recently-shown** candidate
 *      wins. That's the rotation Filip asked for: when tag-merge and
 *      one-thing both apply at priority 50, they alternate across visits
 *      instead of one starving the other forever.
 *
 * State is persisted to `localStorage["sp.hints.v1"]` as
 * `Record<id, { lastShownAt, dismissedAt }>` (ms epochs; 0 means never).
 * Tampered storage falls back to the empty store — a hint slot is
 * cosmetic, never load-bearing.
 *
 * The engine knows nothing about specific hints, route names, or DOM. The
 * concrete candidates live in `hint-candidates.ts` so they can change
 * without touching this file, and the view layer turns the chosen
 * candidate's {@link HintContent} into a banner element.
 */
import type { SutraPadWorkspace, UserProfile } from "../../types";
import type { AliasSuggestion } from "./tag-aliases";

const STORAGE_KEY = "sp.hints.v1";

/**
 * Stable identifier per hint. Matches the candidate constant exported from
 * `hint-candidates.ts`. Strings are used directly as object keys in the
 * persisted store, so renaming one breaks dismiss memory for users who
 * already saw it — bump a version segment if you ever need to reset.
 */
export type HintId = string;

/** Per-hint memory. Both timestamps are ms-since-epoch; 0 means never. */
export interface HintEntry {
  /** Last time this hint was rendered. Drives the round-robin tie-break. */
  lastShownAt: number;
  /** Last time the user dismissed (or acted on) this hint. Drives cooldown. */
  dismissedAt: number;
}

/** Per-id record. Missing ids are treated as fresh entries. */
export type HintStore = Record<HintId, HintEntry>;

/**
 * Read-only snapshot of app state passed into every candidate's gate and
 * builder. Adding a field here is a coordinated change — every candidate
 * compiles against the same shape, so a new gate input shows up at every
 * site that might want to use it. Callbacks are wired by the caller (the
 * render-app composer) and bound to the same set of routes the topbar
 * uses, so a hint CTA navigates the user identically to clicking a tab.
 *
 * Derived fields (`tagAliasSuggestions`, `openTaskCount`, `…CapturedExternally`)
 * are pre-computed by the composer once per render so multiple candidates
 * that look at the same signal don't re-walk the workspace each time.
 * Adding a new derived field is a couple of lines in one place; keeping
 * candidates pure functions of `ctx` is worth the small data-shape
 * coupling.
 */
export interface HintContext {
  readonly workspace: SutraPadWorkspace;
  readonly profile: UserProfile | null;
  readonly dismissedTagAliases: ReadonlySet<string>;
  readonly tasksOneThingKey: string | null;
  /** Output of `suggestTagAliases` against the user-tag index. */
  readonly tagAliasSuggestions: readonly AliasSuggestion[];
  /** How many open `- [ ]` tasks exist across all notes. */
  readonly openTaskCount: number;
  /** True iff at least one note was created via bookmarklet / iOS share. */
  readonly hasEverCapturedExternally: boolean;
  readonly callbacks: HintCallbacks;
}

/**
 * Callback bag a hint's `onCta` may invoke. Each one is a fire-and-forget
 * navigation — no return value, no async chain, no error path. Hints
 * never produce destructive side-effects directly; the worst they do is
 * route the user somewhere they could have clicked themselves.
 */
export interface HintCallbacks {
  openCapture: () => void;
  openSettings: () => void;
  openTasks: () => void;
}

/** What a candidate produces once it has decided to render. */
export interface HintContent {
  /** Small accent label above the title (e.g. "Capture · 1 step"). */
  eyebrow: string;
  /** One-line headline. */
  title: string;
  /** Sub-line explaining what clicking the CTA does. */
  body: string;
  /** Primary action label. */
  ctaLabel: string;
  /** Click handler — usually one of {@link HintCallbacks}. */
  onCta: () => void;
}

/**
 * A registered hint. The engine never looks inside `build`'s return value;
 * it just selects the candidate and the view layer calls `build(ctx)` to
 * get the banner content. Pure functions of `ctx` keep the rotation logic
 * deterministic — no candidate may stash state outside the store.
 */
export interface HintCandidate {
  readonly id: HintId;
  /** Higher beats lower. Ties go to round-robin via `lastShownAt`. */
  readonly priority: number;
  /** Days a dismiss suppresses this hint. Floats are fine (e.g. 0.04 ≈ 1h). */
  readonly cooldownDays: number;
  /** Pure gate. False keeps the candidate out of consideration entirely. */
  isApplicable(ctx: HintContext): boolean;
  /** Builds the banner content. Called only after `isApplicable` returned true. */
  build(ctx: HintContext): HintContent;
}

/** Number of milliseconds in a day. Centralised so the cooldown math is obvious. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns true when the entry's dismiss timestamp is still inside the
 * configured cooldown window. A `dismissedAt` of 0 means "never dismissed"
 * — that's not in cooldown by definition, so always returns false.
 *
 * Pure: no `Date.now()` reads — the caller passes the reference time so
 * the function is straightforward to unit-test with frozen clocks.
 */
export function isWithinCooldown(
  entry: HintEntry | undefined,
  cooldownDays: number,
  now: number,
): boolean {
  if (!entry || entry.dismissedAt === 0) return false;
  return now - entry.dismissedAt < cooldownDays * MS_PER_DAY;
}

/**
 * Picks the candidate the home page should show right now (or `null` when
 * nothing applies). Pure: same inputs always produce the same output.
 *
 * Candidates with the same priority are rotated by least-recently-shown:
 * the one with the smaller `lastShownAt` wins, so a fresh hint (zero) is
 * always picked first, and after that the two trade visits one render
 * each. We use `toSorted` rather than `sort` so the input array stays
 * untouched (`selectHint` is contracted as pure); the comparator is
 * total (priority then lastShownAt) so the result is stable regardless
 * of engine sort behaviour.
 */
export function selectHint(
  candidates: readonly HintCandidate[],
  ctx: HintContext,
  store: HintStore,
  now: number,
): HintCandidate | null {
  const live = candidates.filter((candidate) => {
    if (!candidate.isApplicable(ctx)) return false;
    return !isWithinCooldown(store[candidate.id], candidate.cooldownDays, now);
  });
  if (live.length === 0) return null;

  const sorted = live.toSorted((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aShown = store[a.id]?.lastShownAt ?? 0;
    const bShown = store[b.id]?.lastShownAt ?? 0;
    return aShown - bShown;
  });
  return sorted[0];
}

/**
 * Bumps the hint's `lastShownAt` to `now`. Pure — returns a new store; the
 * caller persists it. Called once per hint render so the rotation
 * tie-breaker stays current. Existing `dismissedAt` is preserved (a hint
 * that's still in cooldown wouldn't be re-shown anyway, but if a future
 * candidate definition shortens its own cooldown, the old dismiss
 * timestamp must still gate the next decision correctly).
 */
export function recordShown(
  store: HintStore,
  id: HintId,
  now: number,
): HintStore {
  const previous = store[id];
  return {
    ...store,
    [id]: {
      lastShownAt: now,
      dismissedAt: previous?.dismissedAt ?? 0,
    },
  };
}

/**
 * Records a dismiss (or "I acted on it" — same effect for the cooldown
 * gate). Bumps both timestamps so the rotation also forgets this hint as
 * "recently shown" — when the cooldown ends and it becomes eligible
 * again, it competes with peers from a fair starting point.
 */
export function recordDismissed(
  store: HintStore,
  id: HintId,
  now: number,
): HintStore {
  return {
    ...store,
    [id]: {
      lastShownAt: now,
      dismissedAt: now,
    },
  };
}

/**
 * Structural guard for a single entry. Defensive against tampered storage:
 * non-object, missing fields, non-finite numbers, negatives — all rejected.
 * Mirrors the pattern in `page-intro.ts` so corrupt data heals on the next
 * write rather than crashing the home render.
 */
function isHintEntry(value: unknown): value is HintEntry {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.lastShownAt === "number" &&
    Number.isFinite(v.lastShownAt) &&
    v.lastShownAt >= 0 &&
    typeof v.dismissedAt === "number" &&
    Number.isFinite(v.dismissedAt) &&
    v.dismissedAt >= 0
  );
}

/**
 * Loads the persisted store. Returns an empty store on first run, parse
 * error, or any non-object top-level shape. Per-key entries that fail the
 * structural guard are dropped; the rest survive — partial recovery is
 * better than nuking the whole rotation memory over one bad key.
 */
export function loadHintStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): HintStore {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fall through — the type guard below sends null + arrays + primitives
    // to the empty-store path with the same single exit, no second branch.
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: HintStore = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isHintEntry(value)) out[key] = value;
  }
  return out;
}

/**
 * Persists the store. Wrapped in try/catch — `setItem` can throw on quota
 * overflow or in a private-browsing slot that's read-only. Failure is
 * silent; the worst case is the rotation forgetting itself for the
 * session, which is acceptable for a cosmetic feature.
 */
export function persistHintStore(
  store: HintStore,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Intentionally silent — see doc comment.
  }
}

/**
 * Wipes the entire hint memory. Used by a future Settings "Reset hints"
 * affordance so a user who dismissed everything can get the rotation
 * back from scratch.
 */
export function resetAllHints(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // See persistHintStore — silent failure is the right behaviour.
  }
}
