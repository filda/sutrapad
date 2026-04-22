/**
 * Global keyboard-shortcut reducer.
 *
 * This module exists so the sequential G-prefix logic (`G T` → Today,
 * `G N` → Notes, etc.) can be unit-tested without a DOM — every
 * browser-specific concern (the event target, modifier keys, the current
 * timestamp, whether we're on the detail route) is passed in as a plain
 * field on `ShortcutEvent`. The reducer returns what *should* happen
 * (`ShortcutAction`) plus the new state; the caller in `app.ts` is the one
 * that actually dispatches the side effect and calls `preventDefault()` on
 * the native event.
 *
 * Single-key shortcuts supported:
 *   - `N`       → open the Add flow (new note + detail editor)
 *   - `Escape`  → leave the detail editor back to the notes list
 *   - `G`       → starts the sequential prefix (see below)
 *
 * Sequential `G …` shortcuts:
 *   - `G T`     → go to Today (home)
 *   - `G N`     → go to Notes
 *   - `G L`     → go to Links
 *   - `G K`     → go to Tasks
 *
 * The `G` prefix stays live for `G_PREFIX_TIMEOUT_MS`; any unrelated key
 * after `G` resets the state without firing. This is the same interaction
 * pattern GitHub / Gmail use. We keep the exact number hard-coded because
 * it's tuned for "deliberate two-key press" (1 s is long enough to be
 * chainable, short enough that a stray `G` doesn't linger).
 *
 * The `/` shortcut for opening the palette is intentionally *not* routed
 * through here — it's owned by `wirePaletteAccess` in `app.ts`, which needs
 * the palette handle anyway. Keeping `/` separate also means the palette
 * can keep living or dying without touching this reducer's tests.
 */

/** Target pages for `G …` sequences, in the same id space as `MenuItemId`. */
export type ShortcutMenuTarget = "home" | "notes" | "links" | "tasks";

export type ShortcutAction =
  | { kind: "new-note" }
  | { kind: "goto"; menu: ShortcutMenuTarget }
  | { kind: "escape" };

export interface ShortcutState {
  /** `"g"` while the G-prefix is live, otherwise `null`. */
  pending: "g" | null;
  /**
   * Absolute timestamp (ms since epoch) at which the live G-prefix expires
   * and falls back to `pending: null`. Kept here (rather than started with
   * a `setTimeout`) so the reducer stays pure — the caller supplies `now`
   * on every event.
   */
  pendingExpiresAt: number | null;
}

export const initialShortcutState: ShortcutState = {
  pending: null,
  pendingExpiresAt: null,
};

/**
 * How long a live G-prefix stays armed before it auto-resets. 1000 ms
 * matches GitHub; longer makes the shortcut feel sloppy on purpose
 * (stray `g`s outside the editor are rare enough that the window is
 * forgiving without being pedantic).
 */
export const G_PREFIX_TIMEOUT_MS = 1000;

export interface ShortcutEvent {
  /** `KeyboardEvent.key` verbatim. Case matters for `Escape`; letter keys are lowered inside the reducer. */
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /**
   * `true` when the event target is something the user is typing into
   * (`<input>`, `<textarea>`, `<select>`, or a `contenteditable` element).
   * In that case all shortcuts are suppressed so `N` / `G` / `Esc` never
   * steal a keystroke from a note body or a tag input.
   */
  isEditingTarget: boolean;
  /**
   * `true` when the app is currently showing the detail editor
   * (`activeMenuItem === "notes" && detailNoteId !== null`). The reducer
   * only emits `escape` when this is true — elsewhere `Esc` does nothing,
   * so the shortcut can't accidentally blow away an unrelated view.
   */
  isDetailRoute: boolean;
  /** Current timestamp in ms. Compared to `state.pendingExpiresAt`. */
  now: number;
}

export interface ShortcutResult {
  /** The new state. The caller stores this and hands it back on the next event. */
  state: ShortcutState;
  /** The side effect to dispatch, or `null` if nothing should happen. */
  action: ShortcutAction | null;
  /**
   * Whether the caller should call `event.preventDefault()` on the native
   * event. Only `true` when we actually claim the keystroke — arming the
   * G-prefix preventDefaults too, otherwise `G` would type a `g` into the
   * focused element before we can intercept the second letter.
   */
  preventDefault: boolean;
}

/**
 * Normalises a single letter/`Escape` key to its canonical form.
 * Non-letter keys are returned as-is so `Escape` stays `Escape` and any
 * other key we don't care about falls through untouched.
 */
function normaliseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Menu targets keyed by the letter that follows `G`. */
const G_TARGETS: Readonly<Record<string, ShortcutMenuTarget>> = {
  t: "home",
  n: "notes",
  l: "links",
  k: "tasks",
};

/**
 * Pure reducer for global keydowns. See the module docstring for what it
 * does; behavioural contract in one paragraph:
 *
 * - Any modifier key (ctrl/meta/alt) aborts — we don't want to clash with
 *   browser or OS shortcuts.
 * - Any event whose target is editable aborts — the user is typing, not
 *   navigating.
 * - A live G-prefix that has expired is reset *before* the current event
 *   is evaluated, so a stale prefix can't leak into the next decision.
 */
export function reduceShortcut(
  state: ShortcutState,
  event: ShortcutEvent,
): ShortcutResult {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return { state, action: null, preventDefault: false };
  }
  if (event.isEditingTarget) {
    return { state, action: null, preventDefault: false };
  }

  // Lapsed G-prefix → discard before reading the new key. This is a
  // cheap expiration: we only check on the next event rather than
  // running a timer, which keeps the reducer pure and the caller
  // free of cleanup bookkeeping.
  const activeState: ShortcutState =
    state.pending === "g" &&
    state.pendingExpiresAt !== null &&
    event.now > state.pendingExpiresAt
      ? initialShortcutState
      : state;

  const key = normaliseKey(event.key);

  if (activeState.pending === "g") {
    const target = Object.hasOwn(G_TARGETS, key) ? G_TARGETS[key] : undefined;
    if (target !== undefined) {
      return {
        state: initialShortcutState,
        action: { kind: "goto", menu: target },
        preventDefault: true,
      };
    }
    // Any non-target key after G drops the prefix. We don't preventDefault
    // on the second keystroke — it wasn't part of a recognised shortcut,
    // so the user's `a` (or whatever) should still behave normally.
    return {
      state: initialShortcutState,
      action: null,
      preventDefault: false,
    };
  }

  if (key === "g") {
    return {
      state: {
        pending: "g",
        pendingExpiresAt: event.now + G_PREFIX_TIMEOUT_MS,
      },
      action: null,
      // preventDefault here keeps the `g` out of the page — otherwise it
      // would land wherever focus was *if* the subsequent isEditingTarget
      // check hadn't already excluded that case. In practice this is a
      // belt-and-braces guard for layouts that put focus on a button.
      preventDefault: true,
    };
  }

  if (key === "n") {
    return {
      state: initialShortcutState,
      action: { kind: "new-note" },
      preventDefault: true,
    };
  }

  if (event.key === "Escape" && event.isDetailRoute) {
    return {
      state: initialShortcutState,
      action: { kind: "escape" },
      preventDefault: true,
    };
  }

  return { state: activeState, action: null, preventDefault: false };
}

/**
 * DOM-level helper: returns `true` when the event target is a place the
 * user is typing into. Extracted so the palette's `/` listener and the
 * shortcut wiring share the same predicate — originally lived inside
 * `view/palette.ts` under the name `shouldOpenPaletteForSlash`, but the
 * logic is identical for every global key shortcut so it belongs in the
 * shared lib.
 *
 * Duck-typed on purpose: instead of `target instanceof HTMLElement` we
 * check for the two fields we actually care about. The result is a
 * runtime that works without a DOM (so vitest tests stay in the "node"
 * environment, in line with the project's DOM-free test strategy) and
 * that doesn't care whether the browser hands us an `HTMLElement` vs
 * another DOM node kind — a `Document` or `window` target has neither
 * `tagName` nor `isContentEditable` matching any of the typing cases,
 * so the function falls through to `false` as intended.
 */
export function isEditingTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const maybe = target as Partial<HTMLElement>;
  if (maybe.isContentEditable === true) return true;
  const tag = maybe.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
