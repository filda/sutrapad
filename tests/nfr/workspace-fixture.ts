/**
 * Seeded synthetic workspace in the shape of the real one (~6 470 notes as of
 * 2026-09): a long tail of imported notes — untagged or carrying a single
 * import tag, roughly a fifth with a URL, bodies from one character to a
 * paragraph, dated 2009–2017 — and a few hundred hand-written notes with
 * tags, task lines and a capture context. That mix is what tripped every
 * incident bug: a placeholder with no tags and an empty body *is* the shape
 * of most of the workspace.
 *
 * Pure and deterministic for a given seed, so a failing property reproduces.
 */
import type { SutraPadDocument, SutraPadWorkspace } from "../../src/types";

export interface WorkspaceShape {
  /** Imported notes (the long tail). */
  imported: number;
  /** Hand-written notes (tags, tasks, capture context). */
  handwritten: number;
  seed?: number;
}

/** Roughly the real workspace. */
export const REAL_SHAPE: WorkspaceShape = { imported: 6000, handwritten: 470, seed: 1 };

/** Small enough for a quick check, same proportions. */
export const SMALL_SHAPE: WorkspaceShape = { imported: 180, handwritten: 20, seed: 1 };

function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

const IMPORT_BODIES = ["!", "ok", "See you there", "Shared a link", ""];
const WORDS = ["meeting", "idea", "garden", "book", "trip", "invoice", "call", "recipe"];

export function generateWorkspace(shape: WorkspaceShape): SutraPadWorkspace {
  const random = lcg(shape.seed ?? 1);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const notes: SutraPadDocument[] = [];

  const importStart = Date.parse("2009-01-01T00:00:00.000Z");
  const importSpan = Date.parse("2017-12-31T00:00:00.000Z") - importStart;
  for (let i = 0; i < shape.imported; i += 1) {
    const at = importStart + Math.floor(random() * importSpan);
    const hasUrl = random() < 0.18;
    const url = hasUrl ? `https://example.test/${i}` : null;
    const body = hasUrl ? `Look: ${url}` : pick(IMPORT_BODIES);
    notes.push({
      id: `imp-${i.toString(36).padStart(6, "0")}`,
      title: random() < 0.7 ? "" : `Import ${i}`,
      body,
      urls: url ? [url] : [],
      tags: random() < 0.4 ? ["facebook-import"] : [],
      createdAt: isoAt(at),
      updatedAt: isoAt(at),
    });
  }

  const handStart = Date.parse("2026-01-01T00:00:00.000Z");
  const handSpan = Date.parse("2026-09-01T00:00:00.000Z") - handStart;
  for (let i = 0; i < shape.handwritten; i += 1) {
    const at = handStart + Math.floor(random() * handSpan);
    const tasks =
      random() < 0.3 ? `\n- [ ] ${pick(WORDS)} follow-up\n- [x] ${pick(WORDS)} done` : "";
    const url = random() < 0.25 ? `https://hand.test/${i}` : null;
    notes.push({
      id: `hand-${i.toString(36).padStart(4, "0")}`,
      title: `${pick(WORDS)} ${pick(WORDS)}`,
      body: `${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)}${url ? ` ${url}` : ""}${tasks}`,
      urls: url ? [url] : [],
      tags: random() < 0.6 ? [pick(WORDS)] : [],
      location: random() < 0.5 ? "Praha" : undefined,
      captureContext: { source: "new-note", deviceType: random() < 0.5 ? "mobile" : "desktop" },
      createdAt: isoAt(at),
      updatedAt: isoAt(at + 60_000),
    });
  }

  notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { notes, activeNoteId: notes[0]?.id ?? null };
}
