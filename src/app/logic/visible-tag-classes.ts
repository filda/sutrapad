import {
  TAG_CLASS_IDS,
  type TagClassId,
} from "./tag-class";

/**
 * Persisted visibility toggles for the seven tag classes on the Tags page.
 *
 * The handoff's Classes panel (`docs/design_handoff_sutrapad2/src/screen_tags.jsx`
 * lines 181–192) lets the user dim individual classes out of the list view — a
 * hidden class stops contributing tags to the main cloud without clearing the
 * underlying data. We store the visibility set in `localStorage` rather than
 * on the URL, in line with every other Tags-page view preference: it's a
 * device-local stance ("I never want to see `device` tags in the cloud"), not
 * shareable view-state.
 *
 * Storage format is a CSV of visible class ids (`"topic,place,when"`). This
 * keeps the round-trip human-legible for debugging and lets us drop an unknown
 * class without having to JSON-decode + type-guard. On load, unknown ids are
 * culled; if the stored set drifts out of sync with the code (a class was
 * renamed or removed), the cull keeps the UI paintable.
 *
 * Default on first run is "all seven visible". An empty stored set is a
 * deliberate user choice (they unchecked everything) and is preserved as-is,
 * so returning to the page the next day doesn't silently re-enable classes
 * the user chose to hide.
 */

const STORAGE_KEY = "sutrapad-visible-tag-classes";

const ALL_IDS: ReadonlySet<TagClassId> = new Set<TagClassId>(TAG_CLASS_IDS);

/**
 * Structural guard. Accepts any value shape and narrows to `TagClassId`.
 * Rejects strings that aren't one of the seven known ids, plus nulls,
 * numbers, and objects — belt-and-braces for the CSV parse path where we
 * don't know what's been wedged into the slot.
 */
export function isTagClassId(value: unknown): value is TagClassId {
  return typeof value === "string" && ALL_IDS.has(value as TagClassId);
}

/**
 * Default first-run set: every class is visible. Returned as a fresh `Set`
 * so callers that mutate it (adding/removing class ids) don't corrupt the
 * shared template.
 */
export function defaultVisibleTagClasses(): Set<TagClassId> {
  return new Set<TagClassId>(TAG_CLASS_IDS);
}

/**
 * Parses the stored CSV, drops unknown ids, and returns the resulting set.
 * Returns `null` when the slot is empty so callers can distinguish "first
 * run / nothing persisted" (→ fall back to `defaultVisibleTagClasses`) from
 * "user persisted an empty set" (→ honour it, render no classes). The
 * distinction matters: an empty CSV (`""`) round-trips to the empty set.
 */
export function loadStoredVisibleTagClasses(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): Set<TagClassId> | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return new Set();
  const ids = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is TagClassId => isTagClassId(part));
  return new Set(ids);
}

/**
 * Writes the set as a CSV of class ids in canonical `TAG_CLASS_IDS` order,
 * so an empty set persists as `""` and the human-legible dump matches the
 * code's ordering. The canonical order also means the stored value is
 * stable across sessions — toggling topic off-on-off doesn't rearrange the
 * other ids in the serialized form.
 */
export function persistVisibleTagClasses(
  classes: ReadonlySet<TagClassId>,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  const serialized = TAG_CLASS_IDS.filter((id) => classes.has(id)).join(",");
  storage.setItem(STORAGE_KEY, serialized);
}

/**
 * Resolves the initial set from storage, falling back to the default "all
 * visible" template when nothing is stored. A persisted empty set is
 * returned as-is — see `loadStoredVisibleTagClasses` for the rationale.
 */
export function resolveInitialVisibleTagClasses(
  storage?: Pick<Storage, "getItem">,
): Set<TagClassId> {
  return loadStoredVisibleTagClasses(storage) ?? defaultVisibleTagClasses();
}

/**
 * Pure toggle helper. Returns a new set (never mutates `current`) with
 * `classId` flipped. Written as a pure function so the reducer-style call
 * site in `app.ts` can be unit-tested without touching localStorage.
 */
export function toggleTagClassVisibility(
  current: ReadonlySet<TagClassId>,
  classId: TagClassId,
): Set<TagClassId> {
  const next = new Set(current);
  if (next.has(classId)) {
    next.delete(classId);
  } else {
    next.add(classId);
  }
  return next;
}
