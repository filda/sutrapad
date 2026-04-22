import { computeNoteStats } from "../../logic/note-stats";
import type { SutraPadDocument } from "../../../types";

/**
 * Right-rail sidebar rendered next to the detail editor on the notes
 * detail route. Three cards: live Stats, a "How this gets saved"
 * explainer, and an "Other ways to capture" jump list.
 *
 * The sidebar is built once per render pass (like the rest of the
 * editor). Live updates — currently only the Stats card changes during
 * typing — flow through `syncFromInputs`, which is wired by
 * `editor-card.ts` to the same keystroke path that drives the kind
 * chip. Everything else in the sidebar is static copy or navigation,
 * so we don't pay a DOM-refresh cost per keystroke.
 */

export interface EditorSidebarHandle {
  element: HTMLElement;
  /**
   * Re-reads stats from the live title + body and updates the Stats
   * card in place. No-op when the displayed numbers haven't changed —
   * most keystrokes don't cross a word-count integer boundary, so the
   * DOM stays still even while the handler runs on every input event.
   */
  syncFromInputs: (title: string, body: string) => void;
}

export interface EditorSidebarOptions {
  /**
   * Baseline note for the stats computation. `syncFromInputs` overlays
   * live title/body on top of this to get tags, urls (captured via
   * bookmarklet), and task counts at their current values; the fields
   * we care about from this baseline are the ones the textarea doesn't
   * re-derive (tag count, captured urls).
   */
  currentNote: SutraPadDocument;
  /** Navigates to the Capture page — all three platform buttons use it. */
  onOpenCapture: () => void;
}

export function buildEditorSidebar(
  options: EditorSidebarOptions,
): EditorSidebarHandle {
  const aside = document.createElement("aside");
  aside.className = "editor-sidebar";

  const stats = buildStatsCard();
  const howSaved = buildHowSavedCard();
  const capture = buildCaptureLinksCard(options.onOpenCapture);

  aside.append(stats.element, howSaved, capture);

  // Seed stats from whatever is currently in the note — the editor
  // passes live values in on the first keystroke, but until then the
  // sidebar should already display the right numbers.
  stats.setNote(options.currentNote);

  return {
    element: aside,
    syncFromInputs: (title, body) => {
      // Overlay the live editable fields on the captured metadata so
      // URLs added via the bookmarklet still feed into the link count
      // even before the user saves.
      stats.setNote({
        ...options.currentNote,
        title,
        body,
      });
    },
  };
}

interface StatsCardHandle {
  element: HTMLElement;
  setNote: (note: SutraPadDocument) => void;
}

function buildStatsCard(): StatsCardHandle {
  const card = document.createElement("section");
  card.className = "editor-sidebar-card editor-sidebar-stats-card";

  const eyebrow = document.createElement("p");
  eyebrow.className = "editor-sidebar-eyebrow";
  eyebrow.textContent = "Stats";

  const grid = document.createElement("div");
  grid.className = "editor-sidebar-stats";

  const wordsStat = buildStat("words");
  const readStat = buildStat("min read");
  const tasksStat = buildStat("tasks");
  const linksStat = buildStat("links");

  grid.append(
    wordsStat.element,
    readStat.element,
    tasksStat.element,
    linksStat.element,
  );
  card.append(eyebrow, grid);

  const setNote = (note: SutraPadDocument): void => {
    const stats = computeNoteStats(note);
    wordsStat.setValue(String(stats.wordCount));
    readStat.setValue(String(stats.readMinutes));
    tasksStat.setValue(String(stats.openTasks + stats.doneTasks));
    linksStat.setValue(String(stats.linkCount));
  };

  return { element: card, setNote };
}

interface StatHandle {
  element: HTMLElement;
  setValue: (value: string) => void;
}

function buildStat(label: string): StatHandle {
  const stat = document.createElement("div");
  stat.className = "editor-sidebar-stat";

  const value = document.createElement("span");
  value.className = "editor-sidebar-stat-num";
  value.textContent = "0";

  const labelEl = document.createElement("span");
  labelEl.className = "editor-sidebar-stat-label";
  labelEl.textContent = label;

  stat.append(value, labelEl);

  return {
    element: stat,
    setValue: (next) => {
      if (value.textContent !== next) value.textContent = next;
    },
  };
}

function buildHowSavedCard(): HTMLElement {
  const card = document.createElement("section");
  card.className = "editor-sidebar-card";

  const eyebrow = document.createElement("p");
  eyebrow.className = "editor-sidebar-eyebrow";
  eyebrow.textContent = "How this gets saved";

  const steps = document.createElement("ol");
  steps.className = "editor-sidebar-steps";

  // Numbered, deliberately terse — this card is a refresher for users
  // who already read the README, not a tutorial. Keep these in sync
  // with the equivalent footer note and the Settings > Storage copy
  // if either one changes.
  const STEP_TEXT = [
    "One JSON file per note lives in your Google Drive.",
    "A notebook index keeps the list and the active note together.",
    "Nothing leaves this device until you're signed in and sync runs.",
  ] as const;

  for (const text of STEP_TEXT) {
    const li = document.createElement("li");
    const body = document.createElement("p");
    body.textContent = text;
    li.append(body);
    steps.append(li);
  }

  card.append(eyebrow, steps);
  return card;
}

function buildCaptureLinksCard(onOpenCapture: () => void): HTMLElement {
  const card = document.createElement("section");
  card.className = "editor-sidebar-card";

  const eyebrow = document.createElement("p");
  eyebrow.className = "editor-sidebar-eyebrow";
  eyebrow.textContent = "Other ways to capture";

  // All three buttons route to the same destination — the Capture page
  // owns the per-platform setup details. Keeping them as three rows
  // (rather than a single "See Capture →" link) matches the handoff
  // and gives the sidebar a visual anchor of comparable height to the
  // Stats + How-saved cards above it.
  const LINKS: readonly { title: string; subtitle: string }[] = [
    { title: "Bookmarklet", subtitle: "Save the page you're reading" },
    { title: "iOS Share", subtitle: "One-tap from Safari" },
    { title: "Android", subtitle: "Share to SutraPad" },
  ];

  card.append(eyebrow);
  for (const entry of LINKS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "editor-sidebar-link";
    button.addEventListener("click", () => onOpenCapture());

    const title = document.createElement("strong");
    title.textContent = entry.title;

    const subtitle = document.createElement("span");
    subtitle.textContent = entry.subtitle;

    button.append(title, subtitle);
    card.append(button);
  }
  return card;
}
