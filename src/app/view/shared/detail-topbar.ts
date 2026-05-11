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
  /**
   * Pre-formatted "last change" string appended to the end of the
   * breadcrumb row — e.g. `synced 22:00` or `local · 11 May, 22:00`.
   * Built by `formatLastChange` at the render-app level so this view
   * stays time- and profile-agnostic. Pass `null` when there's no
   * note to talk about; the crumb is suppressed in that case.
   */
  syncCrumb: string | null;
  onBackToNotes?: () => void;
}

/**
 * Horizontal strip above the editor card: "← Back to notes" on the left, a
 * compact breadcrumb row on the right with word count, read time, tasks,
 * links, tag count, and a trailing "synced HH:mm" pill. Mirrors the
 * handoff's `.detail-topbar` but omits the duplicate/export/delete action
 * cluster — those are out of scope here. The sync crumb is rendered last
 * so the eye lands on it after scanning the size signals.
 */
export function buildDetailTopbar({
  note,
  syncCrumb,
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
    topbar.append(buildDetailBreadcrumbs(computeNoteStats(note), syncCrumb));
  }

  return topbar;
}

function buildDetailBreadcrumbs(
  stats: NoteStats,
  syncCrumb: string | null,
): HTMLElement {
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

  // Sync crumb sits at the end of the row, styled like the other crumbs
  // so the eye reads it as "another fact about this note" rather than as
  // a separate sync indicator (that role belongs to the chrome topbar's
  // sync-pill). A muted prefix on the rendered string (`synced` /
  // `local ·`) carries the signed-in/out distinction.
  if (syncCrumb !== null) {
    appendCrumbSeparator(crumbs);
    const sync = document.createElement("span");
    sync.className = "crumb crumb-sync";
    sync.textContent = syncCrumb;
    crumbs.append(sync);
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
