import { buildTaskIndex } from "../../../lib/notebook";
import { formatDate } from "../../logic/formatting";
import type {
  SutraPadDocument,
  SutraPadTaskEntry,
  SutraPadWorkspace,
} from "../../../types";
import { buildPageHeader } from "../shared/page-header";

export interface TasksPageOptions {
  workspace: SutraPadWorkspace;
  onOpenNote: (noteId: string) => void;
  /**
   * Flip the done-state of a single task. The page calls this synchronously
   * when the user clicks a checkbox; the app is responsible for rewriting the
   * note body (via `toggleTaskInBody`) and scheduling a save.
   */
  onToggleTask: (noteId: string, lineIndex: number) => void;
}

interface NoteGroup {
  note: SutraPadDocument;
  open: SutraPadTaskEntry[];
  done: SutraPadTaskEntry[];
}

export function buildTasksPage({
  workspace,
  onOpenNote,
  onToggleTask,
}: TasksPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "tasks-page";

  const taskIndex = buildTaskIndex(workspace);
  const groups = groupTasksByNote(taskIndex.tasks, workspace);
  const groupsWithOpen = groups.filter((group) => group.open.length > 0);
  const groupsWithDone = groups.filter((group) => group.done.length > 0);
  const totalOpen = groups.reduce((sum, group) => sum + group.open.length, 0);
  const totalDone = groups.reduce((sum, group) => sum + group.done.length, 0);

  section.append(
    buildPageHeader({
      eyebrow: `Tasks · ${totalOpen} open · ${totalDone} done`,
      titleHtml: "Loose <em>threads</em>.",
      subtitle:
        "Every “- [ ]” in a note shows up here, in the context it came from. No artificial buckets — a task is as urgent as the note you wrote it in.",
    }),
  );

  if (taskIndex.tasks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tasks-page-empty";
    empty.textContent =
      "No tasks yet. Start a line in any note with `[ ]` or `- [ ]` and it will show up here.";
    section.append(empty);
    return section;
  }

  // Open and completed live in two separate card containers so the
  // "Show completed" toggle can sit visually between them as a divider.
  // A notebook with mixed tasks intentionally appears in both halves.
  const openCards = document.createElement("div");
  openCards.className = "tasks-cards tasks-cards-open";

  if (groupsWithOpen.length === 0) {
    const allDone = document.createElement("p");
    allDone.className = "tasks-all-done";
    allDone.textContent = "All caught up — every task is checked off.";
    openCards.append(allDone);
  }

  for (const group of groupsWithOpen) {
    openCards.append(buildNoteCard(group, "open", onOpenNote, onToggleTask));
  }

  section.append(openCards);

  if (totalDone > 0) {
    const countLabel = totalDone === 1 ? "1 completed" : `${totalDone} completed`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tasks-completed-toggle";
    toggle.textContent = `Show ${countLabel}`;
    toggle.setAttribute("aria-expanded", "false");

    const doneCards = document.createElement("div");
    doneCards.className = "tasks-cards tasks-cards-done";
    for (const group of groupsWithDone) {
      doneCards.append(buildNoteCard(group, "done", onOpenNote, onToggleTask));
    }

    toggle.addEventListener("click", () => {
      const willBeVisible = !section.classList.contains("is-showing-completed");
      section.classList.toggle("is-showing-completed", willBeVisible);
      toggle.setAttribute("aria-expanded", willBeVisible ? "true" : "false");
      toggle.textContent = willBeVisible ? `Hide ${countLabel}` : `Show ${countLabel}`;
    });

    section.append(toggle);
    section.append(doneCards);
  }

  return section;
}

/**
 * Bundles each note's tasks into a single group. The order of returned groups
 * follows the task index ordering: the most recently touched note first.
 * Within a group, tasks keep their authoring order (line index ascending) so
 * the card mirrors the layout the user wrote.
 */
function groupTasksByNote(
  tasks: readonly SutraPadTaskEntry[],
  workspace: SutraPadWorkspace,
): NoteGroup[] {
  const notesById = new Map(workspace.notes.map((note) => [note.id, note]));
  const groupsByNoteId = new Map<string, NoteGroup>();
  const orderedGroups: NoteGroup[] = [];

  for (const task of tasks) {
    const note = notesById.get(task.noteId);
    if (!note) continue;

    let group = groupsByNoteId.get(task.noteId);
    if (!group) {
      group = { note, open: [], done: [] };
      groupsByNoteId.set(task.noteId, group);
      orderedGroups.push(group);
    }

    if (task.done) {
      group.done.push(task);
    } else {
      group.open.push(task);
    }
  }

  for (const group of orderedGroups) {
    group.open.sort((left, right) => left.lineIndex - right.lineIndex);
    group.done.sort((left, right) => left.lineIndex - right.lineIndex);
  }

  return orderedGroups;
}

function buildNoteCard(
  group: NoteGroup,
  half: "open" | "done",
  onOpenNote: (noteId: string) => void,
  onToggleTask: (noteId: string, lineIndex: number) => void,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "tasks-card";

  const heading = document.createElement("div");
  heading.className = "tasks-card-header";

  const titleButton = document.createElement("button");
  titleButton.type = "button";
  titleButton.className = "tasks-card-title";
  titleButton.textContent = group.note.title.trim() || "Untitled note";
  titleButton.addEventListener("click", () => onOpenNote(group.note.id));
  heading.append(titleButton);

  if (group.note.updatedAt) {
    const time = document.createElement("time");
    time.className = "tasks-card-time";
    time.dateTime = group.note.updatedAt;
    time.textContent = `Last edited ${formatDate(group.note.updatedAt)}`;
    heading.append(time);
  }

  card.append(heading);

  // Each card represents one half of the page (planned or completed). Mixing
  // halves inside a single card is intentionally avoided so the global toggle
  // can act as a clean divider above the completed cards.
  const tasks = half === "open" ? group.open : group.done;
  card.append(buildTaskList(tasks, onToggleTask, half));

  return card;
}

function buildTaskList(
  tasks: readonly SutraPadTaskEntry[],
  onToggleTask: (noteId: string, lineIndex: number) => void,
  variant: "open" | "done",
): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = variant === "done" ? "tasks-list tasks-list-done" : "tasks-list";

  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = task.done ? "task-item task-item-done" : "task-item";

    const checkboxId = `task-${task.noteId}-${task.lineIndex}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.id = checkboxId;
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => {
      onToggleTask(task.noteId, task.lineIndex);
    });

    const label = document.createElement("label");
    label.className = "task-text";
    label.htmlFor = checkboxId;
    label.textContent = task.text;

    item.append(checkbox, label);
    list.append(item);
  }

  return list;
}
