import { computeNoteStats, type NoteStats } from "../../logic/note-stats";
import type { SutraPadDocument } from "../../../types";

export interface DetailTopbarOptions {
  /**
   * When present, the breadcrumb row surfaces word count / read time /
   * tasks / links / tags for this note. Pass `null` when there is no editable
   * note (e.g. the "no matching notebook" state after a filter wipes out the
   * list) — in that case the breadcrumbs are omitted so the topbar collapses
   * to just the back button.
   */
  note: SutraPadDocument | null;
  onBackToNotes?: () => void;
}

/**
 * Horizontal strip above the editor card: "← Back to notes" on the left, a
 * compact breadcrumb row of stats (word count, read time, tasks, links, tag
 * count) on the right. Mirrors the handoff's `.detail-topbar` but omits the
 * duplicate/export/delete action cluster — those are out of scope here.
 */
export function buildDetailTopbar({
  note,
  onBackToNotes,
}: DetailTopbarOptions): HTMLElement {
  const topbar = document.createElement("div");
  topbar.className = "detail-topbar";

  if (onBackToNotes) {
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "editor-back-button";
    backButton.textContent = "← Back to notes";
    backButton.addEventListener("click", onBackToNotes);
    topbar.append(backButton);
  }

  if (note) {
    topbar.append(buildDetailBreadcrumbs(computeNoteStats(note)));
  }

  return topbar;
}

function buildDetailBreadcrumbs(stats: NoteStats): HTMLElement {
  const crumbs = document.createElement("div");
  crumbs.className = "detail-breadcrumbs";

  // Word count + read minutes are always rendered because they're meaningful
  // even on an empty note ("0 words · 1 min read"). Tasks / links / tags are
  // conditional — skipping them keeps the row short when the note has none.
  appendCrumb(crumbs, `${stats.wordCount} ${stats.wordCount === 1 ? "word" : "words"}`);
  appendCrumbSeparator(crumbs);
  appendCrumb(crumbs, `${stats.readMinutes} min read`);

  const totalTasks = stats.openTasks + stats.doneTasks;
  if (totalTasks > 0) {
    appendCrumbSeparator(crumbs);
    const label =
      stats.openTasks > 0
        ? `${stats.openTasks}/${totalTasks} tasks open`
        : `${totalTasks} ${totalTasks === 1 ? "task" : "tasks"} done`;
    appendCrumb(crumbs, label);
  }

  if (stats.linkCount > 0) {
    appendCrumbSeparator(crumbs);
    appendCrumb(
      crumbs,
      `${stats.linkCount} ${stats.linkCount === 1 ? "link" : "links"}`,
    );
  }

  if (stats.tagCount > 0) {
    appendCrumbSeparator(crumbs);
    appendCrumb(
      crumbs,
      `${stats.tagCount} ${stats.tagCount === 1 ? "tag" : "tags"}`,
    );
  }

  return crumbs;
}

function appendCrumb(parent: HTMLElement, text: string): void {
  const span = document.createElement("span");
  span.className = "crumb";
  span.textContent = text;
  parent.append(span);
}

function appendCrumbSeparator(parent: HTMLElement): void {
  const sep = document.createElement("span");
  sep.className = "crumb-sep";
  sep.setAttribute("aria-hidden", "true");
  sep.textContent = "·";
  parent.append(sep);
}
