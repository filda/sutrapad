import { buildLinkIndex } from "../../../lib/notebook";
import type { SutraPadWorkspace } from "../../../types";

export interface LinksPageOptions {
  workspace: SutraPadWorkspace;
  onOpenNote: (noteId: string) => void;
}

export function buildLinksPage({ workspace, onOpenNote }: LinksPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "links-page";

  const header = document.createElement("header");
  header.className = "links-page-header";
  header.innerHTML = `
    <p class="panel-eyebrow">Links</p>
    <h2>All links across your notebooks</h2>
  `;
  section.append(header);

  const linkIndex = buildLinkIndex(workspace);

  if (linkIndex.links.length === 0) {
    const empty = document.createElement("p");
    empty.className = "links-page-empty";
    empty.textContent =
      "No links yet. Paste a URL into a notebook and it will appear here.";
    section.append(empty);
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
      chip.onclick = () => onOpenNote(noteId);
      references.append(chip);
    }

    item.append(references);
    list.append(item);
  }

  section.append(list);
  return section;
}
