import { deriveLinkHostname } from "../../logic/link-card";
import { deriveNotePrimaryUrl } from "../../logic/note-primary-url";
import { computeNoteStats, type NoteStats } from "../../logic/note-stats";
import { detectKind } from "../../../lib/detect-kind";
import type { SutraPadDocument } from "../../../types";
import { buildKindChipForNote } from "./kind-chip";

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

export interface DetailTopbarHandle {
  element: HTMLElement;
  setKind: (title: string, body: string) => void;
}

/**
 * Horizontal strip above the editor card: "← Back to notes" on the left, a
 * live kind chip near the page title zone, then a compact breadcrumb row on
 * the right with word count, read time, tasks, links, tag count, and a
 * trailing "synced HH:mm" pill. Mirrors the
 * handoff's `.detail-topbar` but omits the duplicate/export/delete action
 * cluster — those are out of scope here. The sync crumb is rendered last
 * so the eye lands on it after scanning the size signals.
 */
export function buildDetailTopbar({
  note,
  syncCrumb,
  onBackToNotes,
}: DetailTopbarOptions): DetailTopbarHandle {
  const topbar = document.createElement("div");
  topbar.className = "detail-topbar";
  const kindChip = note ? buildKindChipForNote(note.title, note.body) : null;

  if (onBackToNotes) {
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "editor-back-button";
    backButton.textContent = "← Back to notes";
    backButton.addEventListener("click", onBackToNotes);
    topbar.append(backButton);
  }

  if (kindChip) {
    kindChip.element.classList.add("detail-kind-chip");
    topbar.append(kindChip.element);
  }

  // Domain chip lives in the same horizontal row as the back-button /
  // kind-chip / breadcrumbs so the hero stays a pure image canvas and
  // the note's source metadata reads as a sibling of the other
  // metadata pills. The hero's own `.link-thumb-domain` is hidden via
  // CSS (see `.note-detail-hero .link-thumb-domain { display: none }`
  // in styles.css) so we don't render the same hostname twice.
  if (note) {
    const domainChip = buildDomainChip(note);
    if (domainChip) topbar.append(domainChip);
    topbar.append(buildDetailBreadcrumbs(computeNoteStats(note), syncCrumb));
  }

  return {
    element: topbar,
    setKind: (title, body) => {
      kindChip?.setKind(detectKind({ title, body }));
    },
  };
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

/**
 * Returns a `.detail-domain-chip` carrying the note's primary-URL
 * hostname, or `null` when the note has no parseable URL (hand-typed
 * notes, malformed URLs). Hostname is trimmed of the leading `www.`
 * the same way `deriveLinkHostname` does for the link-thumb chip — so
 * the topbar pill and any other surface that surfaces the hostname
 * (links page, grid card thumb) stay in sync visually.
 */
function buildDomainChip(note: SutraPadDocument): HTMLElement | null {
  const url = deriveNotePrimaryUrl(note);
  if (url === null) return null;
  const hostname = deriveLinkHostname(url);
  if (hostname === null) return null;
  const chip = document.createElement("span");
  chip.className = "detail-domain-chip";
  chip.textContent = hostname;
  return chip;
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
