/**
 * Dresses the detail-route `.editor-stage` with the active note's
 * persona: paper-coloured surface across the whole shell + a banner
 * thumb directly under the topbar that mirrors the grid card's
 * `.link-thumb` (same gradient seed → same hue; same OG-image
 * resolver → same image when one exists).
 *
 * Why a separate helper (rather than inlining in `render-app.ts`):
 *   - The detail route already mixes ~20 imports; this keeps the
 *     persona-decor / link-thumb / og-image plumbing out of that
 *     import surface.
 *   - The behaviour is testable in isolation under happy-dom: feed it
 *     a stage + a note, assert the inline custom properties land and
 *     the banner thumb shows up.
 *   - Both `loadWorkspace`'s prewarm and this helper consume the same
 *     `createOgImageResolver()` shape, so the banner's og:image lookup
 *     hits the warm cache without us threading the resolver instance
 *     across files.
 *
 * No-op semantics aren't built in — the caller is expected to gate on
 * "persona enabled" and "subject note exists" before calling. Keeping
 * the helper precondition-free makes its single responsibility clearer
 * (apply the persona; never decide whether to).
 */
import { deriveNotebookPersona } from "../../../lib/notebook-persona";
import { pickNoteThumbSeed } from "../../logic/link-thumb-seed";
import { deriveNotePrimaryUrl } from "../../logic/note-primary-url";
import {
  createOgImageResolver,
  type OgImageResolver,
} from "../../logic/og-image-resolver";
import type { SutraPadDocument } from "../../../types";
import { buildLinkThumb } from "./link-thumb";
import { applyPersonaStyles } from "./persona-decor";

export interface DetailStagePersonaOptions {
  /** Notes from the workspace, used by `deriveNotebookPersona` for
   *  facet-based stickers / counts. Pass the same value the notes-grid
   *  uses so a note's persona reads the same on both surfaces. */
  allNotes: readonly SutraPadDocument[];
  /** `true` when the resolved theme is a dark palette — flips the
   *  paper-palette pick to its dark variant. */
  dark: boolean;
  /** Optional resolver injection. Production callers omit and get a
   *  fresh per-render resolver (matching how notes-list / tasks-page
   *  treat it). Tests pass a stub so they can assert the banner builds
   *  without spinning up an allorigins round-trip. */
  resolver?: OgImageResolver;
}

/**
 * Applies the persona styles to `stage` and prepends a banner thumb
 * built off `subject`. Mutates `stage` in place; returns the banner
 * element so the caller can keep a reference if it wants to (e.g.
 * for a future "swap the banner when the user clicks a different
 * note in the workspace switcher" UX).
 */
export function applyDetailStagePersona(
  stage: HTMLElement,
  subject: SutraPadDocument,
  options: DetailStagePersonaOptions,
): HTMLElement {
  const persona = deriveNotebookPersona(subject, {
    allNotes: options.allNotes,
    dark: options.dark,
  });
  // `rotationFactor: 0` — a 920 px writing surface with even a 0.8°
  // tilt would shimmy the ruled-line background against the textarea
  // content and rotate the IME caret out of place. Same reason the
  // grid cards opted out earlier; the detail surface is even less
  // forgiving.
  applyPersonaStyles(stage, persona, { rotationFactor: 0 });
  stage.classList.add("has-persona");

  const banner = buildLinkThumb({
    url: deriveNotePrimaryUrl(subject),
    notes: [subject],
    resolver: options.resolver ?? createOgImageResolver(),
    gradientSeed: pickNoteThumbSeed(subject),
  });
  banner.classList.add("detail-banner");
  // Prepend so the banner lands as the FIRST child of the stage —
  // sits at the top of the grid, directly under the page topbar. Any
  // children already on the stage (none today, but a future refactor
  // might pre-seed the grid) slide down a row.
  stage.prepend(banner);
  return banner;
}
