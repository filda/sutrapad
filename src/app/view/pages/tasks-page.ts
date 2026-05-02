import { buildTaskIndex, filterNotesByTags } from "../../../lib/notebook";
import { deriveNotebookPersona } from "../../../lib/notebook-persona";
import type { SutraPadWorkspace } from "../../../types";
import {
  applyTaskFilter,
  computeTaskCounts,
  enrichTasks,
  findEnrichedTaskByKey,
  formatRelativeDays,
  groupEnrichedTasksByNote,
  pickStalestOpenTask,
  taskKey,
  type EnrichedNoteGroup,
  type EnrichedTask,
  type TasksFilterId,
} from "../../logic/tasks-filter";
import { deriveNotePrimaryUrl } from "../../logic/note-primary-url";
import { createOgImageResolver } from "../../logic/og-image-resolver";
import { EMPTY_COPY, buildEmptyScene, buildEmptyState } from "../shared/empty-state";
import { buildLinkThumb } from "../shared/link-thumb";
import {
  applyPersonaStyles,
  appendPersonaStickers,
} from "../shared/persona-decor";
import type { NotesListPersonaOptions } from "../shared/notes-list";
import { buildPageHeader } from "../shared/page-header";

// Inline SVG paths, taken verbatim from
// `docs/design_handoff_sutrapad2/src/icons.jsx`. Rendered through
// `renderIcon` below to keep the same stroke/linecap contract as the rest
// of our ink-on-paper iconography (see `settings-gear` in topbar.ts for
// the convention).
const ICON_SPARKLE =
  '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/>';
const ICON_CLOSE = '<path d="M6 6l12 12M18 6 6 18"/>';
const ICON_CHECK = '<path d="m5 12 5 5L20 7"/>';
const ICON_PIN =
  '<path d="M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/>';
const ICON_ARROW = '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>';

function renderIcon(pathHtml: string, size = 14): string {
  return `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${pathHtml}</svg>`;
}

/**
 * Chip labels + hover hints. Matches `screen_rest.jsx`:
 * FILTERS = [{ id, label, hint }]. Hints surface as `title=""` so the
 * threshold ("added last 2 days", "open 3+ days") is discoverable on
 * hover without cluttering the pill row.
 */
const FILTER_DEFS: ReadonlyArray<{
  id: TasksFilterId;
  label: string;
  hint: string | null;
}> = [
  { id: "all", label: "All", hint: null },
  { id: "recent", label: "Recent", hint: "added last 2 days" },
  { id: "stale", label: "Stale", hint: "open 3+ days" },
  { id: "waiting", label: "Waiting for", hint: "mentions a person" },
];

export interface TasksPageOptions {
  workspace: SutraPadWorkspace;
  /**
   * Active topbar tag filter set. The Tasks page narrows to tasks from
   * notes that carry every selected tag (AND), same source-of-truth the
   * topbar's chip strip and palette tag-pick already feed. The chip row
   * (All/Recent/Stale/Waiting) operates on the already-narrowed set,
   * so a stale filter under "#work" only counts work tasks.
   */
  selectedTagFilters: readonly string[];
  /** Active chip id. `all` is the default on first visit. */
  tasksFilter: TasksFilterId;
  /** Toggle that sits next to the chip row; off by default. */
  tasksShowDone: boolean;
  /**
   * `noteId::lineIndex` identity for the task promoted to "one thing for
   * today" (handoff widget). When the key no longer resolves — e.g. the
   * user edited the source note and line indices shifted — the widget
   * harmlessly falls back to the empty-pick state on the next render.
   */
  tasksOneThingKey: string | null;
  /**
   * Persona decoration. Same shape as on Notes/Links — when present, each
   * task card gets paper/ink/rotation/stickers derived from its source
   * note, so the surface visually matches the Notes page entry for the
   * same notebook.
   */
  personaOptions?: NotesListPersonaOptions;
  onOpenNote: (noteId: string) => void;
  onToggleTask: (noteId: string, lineIndex: number) => void;
  onChangeTasksFilter: (filter: TasksFilterId) => void;
  onToggleTasksShowDone: (showDone: boolean) => void;
  onSetOneThing: (key: string | null) => void;
  /**
   * Clears every active tag filter. Wired into the filter-miss empty
   * state below so the user can recover without leaving the page.
   */
  onClearTagFilters: () => void;
}

export function buildTasksPage(options: TasksPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "tasks-page";

  // Always derive the unfiltered enriched list too — the eyebrow needs
  // the unfiltered open/done counts to show "filtered N of M", and the
  // first-run empty scene must stay reachable even when a stray tag
  // filter happens to match nothing.
  const allEnriched = enrichTasks(
    buildTaskIndex(options.workspace).tasks,
    options.workspace,
    // `new Date()` is evaluated here on purpose — the tasks page is
    // rebuilt on every render, so "today" tracks wall-clock time
    // without needing a separate tick. In tests the logic functions
    // take an explicit `now`.
    new Date(),
  );

  const filterCount = options.selectedTagFilters.length;
  const filteredNotes =
    filterCount === 0
      ? options.workspace.notes
      : filterNotesByTags(
          options.workspace.notes,
          [...options.selectedTagFilters],
          "all",
        );
  // Use the same workspace shape (filtered notes + same activeNoteId) so
  // enrichTasks finds the source notes via the id->note map. Building a
  // fresh task index from the filtered workspace is cheaper than
  // post-filtering the enriched list — tasks are ~few-per-note so the
  // index walk dominates.
  const enriched =
    filterCount === 0
      ? allEnriched
      : enrichTasks(
          buildTaskIndex({ ...options.workspace, notes: filteredNotes }).tasks,
          { ...options.workspace, notes: filteredNotes },
          new Date(),
        );

  const totalOpen = enriched.filter((entry) => !entry.task.done).length;
  const totalDone = enriched.filter((entry) => entry.task.done).length;
  const allOpen = allEnriched.filter((entry) => !entry.task.done).length;
  const allDone = allEnriched.filter((entry) => entry.task.done).length;

  const eyebrowCount =
    filterCount === 0
      ? `${totalOpen} open · ${totalDone} done`
      : `${totalOpen} of ${allOpen} open · ${totalDone} of ${allDone} done`;
  const eyebrowFilter =
    filterCount === 0
      ? ""
      : ` · filtered by ${filterCount} tag${filterCount === 1 ? "" : "s"}`;

  section.append(
    buildPageHeader({
      pageId: "tasks",
      eyebrow: `Tasks · ${eyebrowCount}${eyebrowFilter}`,
      titleHtml: "Loose <em>threads</em>.",
      subtitle:
        "Every “- [ ]” in a note shows up here, in the context it came from. No artificial buckets — a task is as urgent as the note you wrote it in.",
    }),
  );

  if (allEnriched.length === 0) {
    section.append(buildEmptyScene({ ...EMPTY_COPY.tasks }));
    return section;
  }

  if (enriched.length === 0) {
    // Workspace has tasks but the active tag filter killed them all —
    // sub-line nudges the user back toward a wider filter, the CTA
    // clears tags. Re-uses the same dashed-card treatment as the
    // chip-driven filter-miss further down.
    const tagMiss = buildEmptyState({
      kind: "tasks",
      title: "No tasks under this tag filter.",
      sub: "Loosen the tag set or clear filters to see everything.",
      cta: "Clear tag filter",
      onCta: options.onClearTagFilters,
    });
    tagMiss.classList.add("task-empty");
    section.append(tagMiss);
    return section;
  }

  const oneThing = findEnrichedTaskByKey(enriched, options.tasksOneThingKey);
  section.append(
    buildOneThing({
      oneThing,
      enriched,
      onSetOneThing: options.onSetOneThing,
      onToggleTask: options.onToggleTask,
      onOpenNote: options.onOpenNote,
      totalOpen,
    }),
  );

  const counts = computeTaskCounts(enriched, options.tasksShowDone);
  section.append(
    buildFilterRow({
      filter: options.tasksFilter,
      counts,
      showDone: options.tasksShowDone,
      onChangeFilter: options.onChangeTasksFilter,
      onToggleShowDone: options.onToggleTasksShowDone,
    }),
  );

  const filtered = applyTaskFilter(
    enriched,
    options.tasksFilter,
    options.tasksShowDone,
  );
  const groups = groupEnrichedTasksByNote(filtered);

  const grid = document.createElement("div");
  const personaClass = options.personaOptions ? " task-grid--persona" : "";
  grid.className = `task-grid${personaClass}`;

  if (groups.length === 0) {
    grid.append(buildFilterMiss(options, totalDone));
  } else {
    // One resolver per render for the same reason the Links page does it:
    // Notes/Tasks/Links all draw on the same localStorage og:image cache,
    // and a per-render resolver keeps a warm-cache paint cheap when the
    // user bounces between pages.
    const resolver = createOgImageResolver();
    for (const group of groups) {
      grid.append(buildTaskCard(group, options, resolver));
    }
  }

  section.append(grid);
  return section;
}

interface OneThingOptions {
  oneThing: EnrichedTask | null;
  enriched: readonly EnrichedTask[];
  onSetOneThing: (key: string | null) => void;
  onToggleTask: (noteId: string, lineIndex: number) => void;
  onOpenNote: (noteId: string) => void;
  totalOpen: number;
}

/**
 * The "one thing for today" widget has two shapes:
 *
 * - **empty** — large dashed row inviting the user to pick. Clicking it
 *   auto-selects the stalest open task (falls back to the first open one).
 *   When there are no open tasks the button is rendered disabled so
 *   "Pick one thing" never silently misfires.
 * - **filled** — paper card with a large checkbox (`.task-check.lg`), the
 *   task text in the serif, the source note title as a link, and a quiet
 *   `×` to clear the pick.
 */
function buildOneThing({
  oneThing,
  enriched,
  onSetOneThing,
  onToggleTask,
  onOpenNote,
  totalOpen,
}: OneThingOptions): HTMLElement {
  if (oneThing) {
    const card = document.createElement("div");
    card.className = "one-thing";

    const label = document.createElement("div");
    label.className = "one-thing-label";
    label.innerHTML = `${renderIcon(ICON_SPARKLE, 12)}<span>One thing for today</span>`;
    card.append(label);

    const body = document.createElement("div");
    body.className = "one-thing-body";

    const check = document.createElement("button");
    check.type = "button";
    check.className = `task-check lg${oneThing.task.done ? " checked" : ""}`;
    check.setAttribute("aria-label", oneThing.task.done ? "Mark open" : "Mark done");
    if (oneThing.task.done) check.innerHTML = renderIcon(ICON_CHECK, 16);
    check.addEventListener("click", () => {
      onToggleTask(oneThing.task.noteId, oneThing.task.lineIndex);
    });
    body.append(check);

    const text = document.createElement("div");
    text.style.flex = "1";
    text.style.minWidth = "0";

    const line = document.createElement("div");
    line.className = "one-thing-text";
    line.textContent = oneThing.task.text;
    text.append(line);

    const meta = document.createElement("div");
    meta.className = "one-thing-meta";
    const from = document.createElement("span");
    from.textContent = "from ";
    meta.append(from);
    const noteLink = document.createElement("a");
    noteLink.href = "#";
    noteLink.textContent = oneThing.note.title.trim() || "Untitled note";
    noteLink.addEventListener("click", (event) => {
      event.preventDefault();
      onOpenNote(oneThing.note.id);
    });
    meta.append(noteLink);
    const dim = document.createElement("span");
    dim.className = "dim";
    dim.textContent = ` · ${formatRelativeDays(oneThing.daysOld)}`;
    meta.append(dim);
    text.append(meta);

    body.append(text);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "one-thing-clear";
    clear.setAttribute("aria-label", "Clear one thing");
    clear.title = "Clear";
    clear.innerHTML = renderIcon(ICON_CLOSE, 12);
    clear.addEventListener("click", () => onSetOneThing(null));
    body.append(clear);

    card.append(body);
    return card;
  }

  // No current pick → the dashed "pick one" button. Disabled when the
  // backlog is empty so the sparkle doesn't promise something it can't
  // deliver.
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "one-thing empty";
  pick.disabled = totalOpen === 0;

  const icon = document.createElement("span");
  icon.className = "one-thing-icon";
  icon.innerHTML = renderIcon(ICON_SPARKLE, 14);
  pick.append(icon);

  const label = document.createElement("span");
  label.className = "one-thing-pick-label";
  label.textContent =
    totalOpen === 0 ? "Nothing to pick" : "Pick one thing for today";
  pick.append(label);

  const sub = document.createElement("span");
  sub.className = "one-thing-pick-sub mono";
  sub.textContent =
    totalOpen === 0
      ? "All caught up — enjoy the silence."
      : `${totalOpen} open — we'll suggest the stalest`;
  pick.append(sub);

  if (totalOpen > 0) {
    pick.addEventListener("click", () => {
      const choice = pickStalestOpenTask(enriched);
      if (choice) onSetOneThing(taskKey(choice.task));
    });
  }
  return pick;
}

interface FilterRowOptions {
  filter: TasksFilterId;
  counts: Record<TasksFilterId, number>;
  showDone: boolean;
  onChangeFilter: (filter: TasksFilterId) => void;
  onToggleShowDone: (showDone: boolean) => void;
}

/**
 * Chip row above the cards. Per handoff: a chip is hidden when its count
 * is zero *unless* it's the active chip (so the user never sees the
 * filter they're standing on disappear mid-session) or `all` (always
 * present, functions as the reset). Show-done toggle sits at the right
 * edge of the same pill bar.
 */
function buildFilterRow({
  filter,
  counts,
  showDone,
  onChangeFilter,
  onToggleShowDone,
}: FilterRowOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "task-filters";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Filter tasks");

  for (const def of FILTER_DEFS) {
    if (def.id !== "all" && counts[def.id] === 0 && filter !== def.id) continue;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `task-filter${filter === def.id ? " is-active" : ""}`;
    if (def.hint) chip.title = def.hint;
    chip.setAttribute("aria-pressed", filter === def.id ? "true" : "false");

    const label = document.createElement("span");
    label.textContent = def.label;
    chip.append(label);

    const count = document.createElement("span");
    count.className = "c mono";
    count.textContent = String(counts[def.id]);
    chip.append(count);

    chip.addEventListener("click", () => {
      if (filter !== def.id) onChangeFilter(def.id);
    });
    row.append(chip);
  }

  const spacer = document.createElement("div");
  spacer.className = "task-filters-spacer";
  row.append(spacer);

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "done-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = showDone;
  input.addEventListener("change", () => onToggleShowDone(input.checked));
  toggleLabel.append(input);
  const toggleText = document.createElement("span");
  toggleText.textContent = "Show done";
  toggleLabel.append(toggleText);
  row.append(toggleLabel);

  return row;
}

function buildFilterMiss(
  options: TasksPageOptions,
  totalDone: number,
): HTMLElement {
  const canShowDone = !options.tasksShowDone && totalDone > 0;
  const miss = buildEmptyState({
    kind: "tasks",
    title: "Nothing matches this filter.",
    sub: canShowDone
      ? "Flip Show done to widen the search, or pick a different chip."
      : "Try another chip, or clear the filter to see everything.",
    cta: canShowDone
      ? `Show ${totalDone} done`
      : options.tasksFilter !== "all"
      ? "Show all"
      : undefined,
    onCta: canShowDone
      ? () => options.onToggleTasksShowDone(true)
      : options.tasksFilter !== "all"
      ? () => options.onChangeTasksFilter("all")
      : undefined,
  });
  miss.classList.add("task-empty");
  return miss;
}

function buildTaskCard(
  group: EnrichedNoteGroup,
  options: TasksPageOptions,
  resolver: ReturnType<typeof createOgImageResolver>,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "task-card";

  // Persona attaches to the source note so the same notebook reads with
  // the same paper/ink across Notes ↔ Tasks. When persona is off the card
  // keeps its original flat treatment.
  const persona = options.personaOptions
    ? deriveNotebookPersona(group.note, {
        allNotes: options.personaOptions.allNotes,
        dark: options.personaOptions.dark,
      })
    : null;
  if (persona) {
    card.classList.add("has-persona");
    applyPersonaStyles(card, persona);
  }

  // Thumb header — same shape as the Links page, fed off the source
  // note's primary URL. URL-less notes still render the gradient (no
  // domain chip) so the visual rhythm of the grid stays consistent.
  const primaryUrl = deriveNotePrimaryUrl(group.note);
  card.append(
    buildLinkThumb({
      url: primaryUrl,
      notes: [group.note],
      resolver,
    }),
  );

  card.append(buildTaskCardHead(group, options));

  const list = document.createElement("ul");
  list.className = "task-list";
  for (const entry of group.tasks) {
    list.append(buildTaskItem(entry, options));
  }
  card.append(list);

  card.append(buildTaskCardFoot(group, options));

  if (persona) appendPersonaStickers(card, persona);

  return card;
}

function buildTaskCardHead(
  group: EnrichedNoteGroup,
  options: TasksPageOptions,
): HTMLElement {
  const head = document.createElement("header");
  head.className = "task-card-head";

  const title = document.createElement("div");
  title.style.minWidth = "0";

  const heading = document.createElement("h3");
  heading.textContent = group.note.title.trim() || "Untitled";
  title.append(heading);

  const sub = document.createElement("div");
  sub.className = "task-card-sub";

  // The handoff uses the oldest task's `daysOld` as the card's temporal
  // anchor; we mirror that ("3 days ago" on a mixed-age card means the
  // oldest open task on it is 3 days old).
  const anchor = group.tasks[0]?.daysOld ?? 0;
  const anchorSpan = document.createElement("span");
  anchorSpan.textContent = formatRelativeDays(anchor);
  sub.append(anchorSpan);

  // Location is an optional string on the note; the handoff strips a
  // leading "City — " prefix so the sub-label reads as just the venue.
  // We do the same for parity with the mock.
  const rawLocation = group.note.location?.trim();
  if (rawLocation && rawLocation !== "—") {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "·";
    sub.append(sep);
    const pin = document.createElement("span");
    pin.className = "task-card-pin";
    pin.innerHTML = renderIcon(ICON_PIN, 11);
    sub.append(pin);
    const loc = document.createElement("span");
    loc.textContent = rawLocation.replace(/^.*?—\s*/, "");
    sub.append(loc);
  }

  if (group.hasStaleOpen) {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "·";
    sub.append(sep);
    const badge = document.createElement("span");
    badge.className = "stale-badge";
    badge.textContent = "stale";
    sub.append(badge);
  }

  title.append(sub);
  head.append(title);

  const open = document.createElement("button");
  open.type = "button";
  open.className = "task-card-open";
  open.setAttribute("aria-label", "Open note");
  open.title = "Open note";
  open.innerHTML = renderIcon(ICON_ARROW, 12);
  open.addEventListener("click", () => options.onOpenNote(group.note.id));
  head.append(open);

  return head;
}

function buildTaskItem(
  entry: EnrichedTask,
  options: TasksPageOptions,
): HTMLElement {
  const item = document.createElement("li");
  item.className = `task-item${entry.task.done ? " done" : ""}`;

  const check = document.createElement("button");
  check.type = "button";
  check.className = `task-check${entry.task.done ? " checked" : ""}`;
  check.setAttribute(
    "aria-label",
    entry.task.done ? "Mark open" : "Mark done",
  );
  if (entry.task.done) check.innerHTML = renderIcon(ICON_CHECK, 12);
  check.addEventListener("click", () => {
    options.onToggleTask(entry.task.noteId, entry.task.lineIndex);
  });
  item.append(check);

  const body = document.createElement("div");
  body.className = "task-body";

  const text = document.createElement("div");
  text.className = "t";
  text.textContent = entry.task.text;
  body.append(text);

  if (entry.hasPerson && !entry.task.done) {
    const tag = document.createElement("span");
    tag.className = "mini-tag waiting";
    tag.textContent = "waiting for";
    body.append(tag);
  }

  item.append(body);

  const key = taskKey(entry.task);
  const isOneThing = options.tasksOneThingKey === key;
  if (!entry.task.done && !isOneThing) {
    const promote = document.createElement("button");
    promote.type = "button";
    promote.className = "task-promote";
    promote.setAttribute("aria-label", "Pick for today");
    promote.title = "Pick for today";
    promote.innerHTML = renderIcon(ICON_SPARKLE, 11);
    promote.addEventListener("click", () => options.onSetOneThing(key));
    item.append(promote);
  }

  return item;
}

function buildTaskCardFoot(
  group: EnrichedNoteGroup,
  options: TasksPageOptions,
): HTMLElement {
  const foot = document.createElement("footer");
  foot.className = "task-card-foot";

  const count = document.createElement("span");
  count.className = "mono dim task-card-count";
  count.textContent = `${group.openCount} of ${group.totalCount} open`;
  foot.append(count);

  // "Add" routes to the source note — creating a new task inline would
  // require a cursor-at-end contract we don't have yet, and the handoff
  // itself leaves this as a thin jump to the note.
  const add = document.createElement("button");
  add.type = "button";
  add.className = "task-card-add";
  add.textContent = "Open & add";
  add.addEventListener("click", () => options.onOpenNote(group.note.id));
  foot.append(add);

  return foot;
}

