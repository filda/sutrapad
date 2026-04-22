import { buildLinkIndex } from "../../../lib/notebook";
import { formatDate } from "../../logic/formatting";
import type { SutraPadWorkspace } from "../../../types";
import { EMPTY_COPY, buildEmptyScene } from "../shared/empty-state";
import { buildPageHeader } from "../shared/page-header";

export interface LinksPageOptions {
  workspace: SutraPadWorkspace;
  onOpenNote: (noteId: string) => void;
  /**
   * Routes to the Capture page. Wired here because the first-run empty
   * state pitches the bookmarklet as the fastest way to accumulate links,
   * and the bookmarklet instructions live on Capture.
   */
  onOpenCapture: () => void;
}

export function buildLinksPage({
  workspace,
  onOpenNote,
  onOpenCapture,
}: LinksPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "links-page";

  const linkIndex = buildLinkIndex(workspace);
  const linkCount = linkIndex.links.length;

  section.append(
    buildPageHeader({
      eyebrow: `Links · ${linkCount}`,
      titleHtml: "A <em>library</em> of what caught your eye.",
      subtitle:
        "Every URL you've captured into a note, gathered here with the notebooks they first appeared in.",
    }),
  );

  if (linkCount === 0) {
    // First-run full-bleed scene. CTA routes to the Capture page since
    // the handoff copy explicitly pitches the bookmarklet as the way to
    // start saving links.
    section.append(
      buildEmptyScene({
        ...EMPTY_COPY.links,
        onCta: onOpenCapture,
      }),
    );
    return section;
  }

  const notesById = new Map(workspace.notes.map((note) => [note.id, note]));

  const list = document.createElement("ul");
  list.className = "links-list";

  for (const entry of linkIndex.links) {
    const item = document.createElement("li");
    item.className = "link-item";

    const anchor = document.createElement("a");
    anchor.className = "link-url";
    anchor.href = entry.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer noopener";
    anchor.textContent = entry.url;
    item.append(anchor);

    if (entry.latestUpdatedAt) {
      const lastAdded = document.createElement("time");
      lastAdded.className = "link-last-added";
      lastAdded.dateTime = entry.latestUpdatedAt;
      lastAdded.textContent = `Last added ${formatDate(entry.latestUpdatedAt)}`;
      item.append(lastAdded);
    }

    const references = document.createElement("div");
    references.className = "link-notebooks";

    const referenceLabel = document.createElement("span");
    referenceLabel.className = "link-notebooks-label";
    referenceLabel.textContent = entry.count === 1 ? "Found in" : `Found in ${entry.count} notebooks`;
    references.append(referenceLabel);

    const seenIds = new Set<string>();
    for (const noteId of entry.noteIds) {
      if (seenIds.has(noteId)) continue;
      seenIds.add(noteId);
      const note = notesById.get(noteId);
      if (!note) continue;

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "link-notebook-chip";
      chip.textContent = note.title.trim() || "Untitled note";
      chip.addEventListener("click", () => onOpenNote(noteId));
      references.append(chip);
    }

    item.append(references);
    list.append(item);
  }

  section.append(list);
  return section;
}
