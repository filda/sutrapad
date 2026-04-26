import {
  buildAvailableCombinedTagIndex,
  buildCombinedTagIndex,
  filterNotesByTags,
} from "../../../lib/notebook";
import {
  TAG_CLASS_IDS,
  classifyTagEntry,
  metaForClass,
  parseTagName,
  type TagClassId,
} from "../../logic/tag-class";
import { splitGraveyard } from "../../logic/tag-graveyard";
import type {
  SutraPadTagEntry,
  SutraPadTagFilterMode,
  SutraPadTagIndex,
  SutraPadWorkspace,
} from "../../../types";
import { EMPTY_COPY, buildEmptyScene } from "../shared/empty-state";
import {
  buildNotesList,
  type NotesListPersonaOptions,
} from "../shared/notes-list";
import { buildPageHeader } from "../shared/page-header";
import { buildTagPill } from "../shared/tag-pill";

export interface TagsPageOptions {
  workspace: SutraPadWorkspace;
  selectedTagFilters: string[];
  filterMode: SutraPadTagFilterMode;
  currentNoteId: string;
  /** See NotesPanelOptions.personaOptions — same contract, off when absent. */
  personaOptions?: NotesListPersonaOptions;
  /**
   * Which of the seven tag classes should contribute tags to the main list.
   * The set is owned by `app.ts` so it survives re-renders triggered by
   * task toggles, filter changes, etc. — the Tags page is a pure view over
   * this snapshot.
   */
  visibleTagClasses: ReadonlySet<TagClassId>;
  /**
   * Narrows the rendered list to entries whose value contains this substring
   * (case-insensitive). Kept separate from `selectedTagFilters` so typing in
   * the search field filters the list inline without committing to a real
   * filter — the palette (opened via `/`) remains the canonical way to
   * commit a tag into the filter set.
   */
  tagsSearchQuery: string;
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  onChangeFilterMode: (mode: SutraPadTagFilterMode) => void;
  onToggleTagClass: (classId: TagClassId) => void;
  onChangeTagsSearchQuery: (query: string) => void;
  onOpenNote: (noteId: string) => void;
}

const FILTER_MODE_OPTIONS: ReadonlyArray<{
  mode: SutraPadTagFilterMode;
  label: string;
  ariaLabel: string;
}> = [
  { mode: "all", label: "All", ariaLabel: "Match every selected tag" },
  { mode: "any", label: "Any", ariaLabel: "Match any selected tag" },
];

function buildFilterModeToggle(
  activeMode: SutraPadTagFilterMode,
  onChangeFilterMode: (mode: SutraPadTagFilterMode) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "filter-mode-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Combine selected tags with");

  for (const option of FILTER_MODE_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-mode-button${option.mode === activeMode ? " is-active" : ""}`;
    button.textContent = option.label;
    button.setAttribute("aria-pressed", option.mode === activeMode ? "true" : "false");
    button.setAttribute("aria-label", option.ariaLabel);
    button.addEventListener("click", () => {
      if (option.mode !== activeMode) onChangeFilterMode(option.mode);
    });
    group.append(button);
  }

  return group;
}

/**
 * Per-class counts across the full index. Used by the Classes panel so each
 * row shows the total population of that class — the panel itself is a
 * visibility toggle, not a filter, so counts come from the unfiltered index
 * and stay stable as the user selects filter tags.
 */
function countsByClass(
  index: SutraPadTagIndex,
): Readonly<Record<TagClassId, number>> {
  const counts: Record<TagClassId, number> = {
    topic: 0,
    place: 0,
    when: 0,
    source: 0,
    device: 0,
    weather: 0,
    people: 0,
  };
  for (const entry of index.tags) {
    counts[classifyTagEntry(entry)] += 1;
  }
  return counts;
}

/**
 * Case-insensitive substring match against a tag's display value (the part
 * after the `facet:` prefix for auto-tags). Matching against the display
 * value — not the raw string — means typing "today" finds `date:today`
 * without the user having to know the internal namespace.
 */
function matchesSearch(entry: SutraPadTagEntry, query: string): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  const { value } = parseTagName(entry.tag);
  return (value || entry.tag).toLowerCase().includes(needle);
}

/**
 * Active-filter pill row on the left panel. Each pill has an inline `×` that
 * removes just that tag from the filter set — removing through `onRemove`
 * rather than a whole-pill click keeps the class colour readable (a
 * `removable` pill is still hue-painted) and matches the topbar chip row's
 * affordance so the mental model stays consistent across surfaces.
 */
function buildActiveFiltersBlock(
  selectedTagFilters: string[],
  fullIndex: SutraPadTagIndex,
  onToggleTagFilter: (tag: string) => void,
  onClearTagFilters: () => void,
): HTMLElement {
  const block = document.createElement("div");
  block.className = "tags-left-block";

  const heading = document.createElement("h5");
  heading.textContent = "Active filters";
  block.append(heading);

  const list = document.createElement("div");
  list.className = "tags-active";

  if (selectedTagFilters.length === 0) {
    const empty = document.createElement("span");
    empty.className = "tags-active-empty";
    empty.textContent = "Click any tag to narrow.";
    list.append(empty);
  } else {
    // We look each active tag up in the full index so we can recover its
    // `kind` for correct class-hue styling. Filters committed via the
    // palette from a previous session might reference a tag that's since
    // been renamed/deleted — `kindFor` falls back to `user` (topic hue)
    // which matches the rest of the codebase's "missing kind = user" rule.
    const kindByTag = new Map(
      fullIndex.tags.map((entry) => [entry.tag, entry.kind] as const),
    );
    for (const tag of selectedTagFilters) {
      list.append(
        buildTagPill({
          tag,
          kind: kindByTag.get(tag),
          active: true,
          onRemove: () => onToggleTagFilter(tag),
          removeAriaLabel: `Remove filter ${tag}`,
        }),
      );
    }
  }
  block.append(list);

  if (selectedTagFilters.length > 0) {
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "tags-clear-filters";
    clearButton.textContent = "Clear all";
    clearButton.setAttribute("aria-label", "Clear all active filters");
    clearButton.addEventListener("click", onClearTagFilters);
    block.append(clearButton);
  }

  return block;
}

/**
 * Plain search input — narrows the list view inline without committing to a
 * filter. We deliberately don't render a suggestion dropdown here: the
 * palette (opened via the `/` shortcut or the topbar trigger) is the one
 * tag-commit surface in the app, and the list below the input already shows
 * matching tags organised by class, which is a richer answer than a
 * dropdown would be.
 */
function buildSearchBlock(
  tagsSearchQuery: string,
  onChangeTagsSearchQuery: (query: string) => void,
): HTMLElement {
  const block = document.createElement("div");
  block.className = "tags-left-block";

  const heading = document.createElement("h5");
  heading.textContent = "Search";
  block.append(heading);

  const input = document.createElement("input");
  input.type = "search";
  input.className = "tags-search-input";
  input.placeholder = "coffee, vinohrady, morning…";
  input.value = tagsSearchQuery;
  input.setAttribute("aria-label", "Filter tags by name");
  input.addEventListener("input", () => {
    onChangeTagsSearchQuery(input.value);
  });
  block.append(input);

  return block;
}

/**
 * Classes panel — clickable rows with a class-hue swatch, label, symbol
 * sigil and population count. Hidden classes get an `.off` modifier so the
 * swatch dims and the row visibly recedes; clicking toggles the stored
 * visibility set. No ripple/animation — consistent with the rest of the
 * app's dry ink-on-paper styling.
 */
function buildClassesBlock(
  visibleTagClasses: ReadonlySet<TagClassId>,
  classCounts: Readonly<Record<TagClassId, number>>,
  onToggleTagClass: (classId: TagClassId) => void,
): HTMLElement {
  const block = document.createElement("div");
  block.className = "tags-left-block";

  const heading = document.createElement("h5");
  heading.textContent = "Classes";
  block.append(heading);

  for (const classId of TAG_CLASS_IDS) {
    const meta = metaForClass(classId);
    const count = classCounts[classId];
    const isOn = visibleTagClasses.has(classId);

    const row = document.createElement("button");
    row.type = "button";
    row.className = `tag-class-row${isOn ? "" : " off"}`;
    row.style.setProperty("--h", String(meta.hue));
    row.setAttribute("aria-pressed", isOn ? "true" : "false");
    row.setAttribute(
      "aria-label",
      `${isOn ? "Hide" : "Show"} ${meta.label.toLowerCase()} tags`,
    );
    row.addEventListener("click", () => onToggleTagClass(classId));

    const swatch = document.createElement("span");
    swatch.className = "tag-class-swatch";
    swatch.setAttribute("aria-hidden", "true");
    row.append(swatch);

    const label = document.createElement("span");
    label.className = "tag-class-label";
    label.textContent = meta.label;
    row.append(label);

    const symbol = document.createElement("span");
    symbol.className = "tag-class-symbol mono";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = meta.symbol;
    row.append(symbol);

    const countEl = document.createElement("span");
    countEl.className = "tag-class-count mono";
    countEl.textContent = String(count);
    row.append(countEl);

    block.append(row);
  }

  return block;
}

/**
 * Assembles the left sidebar: Active filters + Search + Classes. Extracted
 * so the main builder reads as a coarse layout outline rather than a wall
 * of block construction.
 */
function buildLeftPanel(options: {
  selectedTagFilters: string[];
  fullIndex: SutraPadTagIndex;
  tagsSearchQuery: string;
  visibleTagClasses: ReadonlySet<TagClassId>;
  classCounts: Readonly<Record<TagClassId, number>>;
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  onToggleTagClass: (classId: TagClassId) => void;
  onChangeTagsSearchQuery: (query: string) => void;
}): HTMLElement {
  const {
    selectedTagFilters,
    fullIndex,
    tagsSearchQuery,
    visibleTagClasses,
    classCounts,
    onToggleTagFilter,
    onClearTagFilters,
    onToggleTagClass,
    onChangeTagsSearchQuery,
  } = options;

  const panel = document.createElement("aside");
  panel.className = "tags-left-panel";
  panel.setAttribute("aria-label", "Tag filters");

  panel.append(
    buildActiveFiltersBlock(
      selectedTagFilters,
      fullIndex,
      onToggleTagFilter,
      onClearTagFilters,
    ),
    buildSearchBlock(tagsSearchQuery, onChangeTagsSearchQuery),
    buildClassesBlock(visibleTagClasses, classCounts, onToggleTagClass),
  );

  return panel;
}

/**
 * One grouped row per class: `<section>` with an `<h4>` header (hue swatch,
 * label, count, description) followed by the class's pill cloud. Headers
 * never show for empty / hidden classes — we'd rather collapse than print
 * "Weather · 0 tags" with nothing underneath.
 */
function buildClassGroup(
  classId: TagClassId,
  entries: SutraPadTagEntry[],
  selectedTagFilters: string[],
  onToggleTagFilter: (tag: string) => void,
): HTMLElement {
  const meta = metaForClass(classId);
  const section = document.createElement("section");
  section.className = "tags-list-group";
  section.style.setProperty("--h", String(meta.hue));

  const heading = document.createElement("h4");
  heading.className = "tags-list-heading";

  const swatch = document.createElement("span");
  swatch.className = "tags-list-swatch";
  swatch.setAttribute("aria-hidden", "true");
  heading.append(swatch);

  const label = document.createElement("span");
  label.className = "tags-list-label";
  label.textContent = meta.label;
  heading.append(label);

  const count = document.createElement("span");
  count.className = "tags-list-count mono";
  count.textContent = `${entries.length}`;
  heading.append(count);

  const desc = document.createElement("span");
  desc.className = "tags-list-desc";
  desc.textContent = `· ${meta.desc}`;
  heading.append(desc);

  section.append(heading);

  const row = document.createElement("div");
  row.className = "tags-list-row";
  for (const entry of entries) {
    row.append(
      buildTagPill({
        tag: entry.tag,
        kind: entry.kind,
        size: "lg",
        count: `· ${entry.count}`,
        active: selectedTagFilters.includes(entry.tag),
        onClick: () => onToggleTagFilter(entry.tag),
      }),
    );
  }
  section.append(row);
  return section;
}

/**
 * Main list area: grouped-by-class sections in the canonical `TAG_CLASS_IDS`
 * order. The header and class groups that make it here have already been
 * narrowed by visibility + search; this helper is pure composition.
 */
function buildListView(
  livingEntries: readonly SutraPadTagEntry[],
  visibleTagClasses: ReadonlySet<TagClassId>,
  tagsSearchQuery: string,
  selectedTagFilters: string[],
  onToggleTagFilter: (tag: string) => void,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "tags-list-view";

  // Group once in a single pass so we don't pay an O(classes × entries)
  // scan per class.
  const groups: Record<TagClassId, SutraPadTagEntry[]> = {
    topic: [],
    place: [],
    when: [],
    source: [],
    device: [],
    weather: [],
    people: [],
  };
  for (const entry of livingEntries) {
    if (!matchesSearch(entry, tagsSearchQuery)) continue;
    const classId = classifyTagEntry(entry);
    if (!visibleTagClasses.has(classId)) continue;
    groups[classId].push(entry);
  }

  let renderedAny = false;
  for (const classId of TAG_CLASS_IDS) {
    const entries = groups[classId];
    if (entries.length === 0) continue;
    container.append(
      buildClassGroup(
        classId,
        entries,
        selectedTagFilters,
        onToggleTagFilter,
      ),
    );
    renderedAny = true;
  }

  if (!renderedAny) {
    // Inline miss state rather than a full-bleed scene — the left panel
    // (still populated) makes the page feel "alive", so the miss copy can
    // stay quiet. Three likely causes in order of likelihood: search
    // typo → classes toggled off → selected filter narrowed everything.
    const miss = document.createElement("p");
    miss.className = "tags-list-miss";
    miss.textContent = tagsSearchQuery
      ? `No tags match "${tagsSearchQuery}". Try a shorter query, or check whether a class is hidden.`
      : "No tags match the current visibility. Toggle a class back on in the panel to the left.";
    container.append(miss);
  }

  return container;
}

export function buildTagsPage({
  workspace,
  selectedTagFilters,
  filterMode,
  currentNoteId,
  personaOptions,
  visibleTagClasses,
  tagsSearchQuery,
  onToggleTagFilter,
  onClearTagFilters,
  onChangeFilterMode,
  onToggleTagClass,
  onChangeTagsSearchQuery,
  onOpenNote,
}: TagsPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "tags-page";

  // We build the full combined index (not the narrowed "available" one) so
  // the empty-state decision is based on whether *any* tag exists anywhere —
  // narrowing by the current filter would mislead a user whose selection
  // accidentally filtered out every other tag. The left-panel Classes row
  // counts also read from this index so the population never shifts as the
  // user toggles classes off.
  const fullIndex = buildCombinedTagIndex(workspace);

  const noteCount = workspace.notes.length;
  const actions: HTMLElement[] = [
    buildFilterModeToggle(filterMode, onChangeFilterMode),
  ];
  if (selectedTagFilters.length > 0) {
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "button button-ghost";
    clearButton.textContent = "Clear filters";
    clearButton.addEventListener("click", onClearTagFilters);
    actions.push(clearButton);
  }

  section.append(
    buildPageHeader({
      pageId: "tags",
      eyebrow: `Tags · ${fullIndex.tags.length} unique · ${noteCount} note${noteCount === 1 ? "" : "s"}`,
      titleHtml: "A <em>constellation</em> of what you think about.",
      subtitle:
        "Each class of tag has its own colour. Click to filter; toggle classes left to focus. All narrows to intersection, Any expands to union.",
      actions,
    }),
  );

  if (fullIndex.tags.length === 0) {
    // First-run full-bleed scene. No CTA — the sub-copy already promises
    // that tags appear on their own, so asking the user to do something
    // here would contradict the message.
    section.append(buildEmptyScene({ ...EMPTY_COPY.tags }));
    return section;
  }

  // Graveyard membership is computed against the full index and the full
  // workspace, so a tag stays "rare" based on its real history — not whatever
  // subset the current filter has narrowed us to. The resulting set culls
  // the main list and feeds the collapsible section at the bottom.
  const { graveyard } = splitGraveyard(fullIndex, workspace);
  const graveyardTags = new Set(graveyard.map((entry) => entry.tag));

  // For the rendered list we use the *available* index: narrows to tags
  // that still yield results under the current selection + mode, so the
  // next click is never a dead end. When there's no active selection this
  // collapses to the full index, preserving the original "show everything"
  // behaviour.
  const availableIndex = buildAvailableCombinedTagIndex(
    workspace,
    selectedTagFilters,
    filterMode,
  );
  const livingAvailable = availableIndex.tags.filter(
    (entry) => !graveyardTags.has(entry.tag),
  );

  const classCounts = countsByClass(fullIndex);

  const layout = document.createElement("div");
  layout.className = "tags-layout";

  layout.append(
    buildLeftPanel({
      selectedTagFilters,
      fullIndex,
      tagsSearchQuery,
      visibleTagClasses,
      classCounts,
      onToggleTagFilter,
      onClearTagFilters,
      onToggleTagClass,
      onChangeTagsSearchQuery,
    }),
  );

  const main = document.createElement("div");
  main.className = "tags-main";
  main.append(
    buildListView(
      livingAvailable,
      visibleTagClasses,
      tagsSearchQuery,
      selectedTagFilters,
      onToggleTagFilter,
    ),
  );
  layout.append(main);

  section.append(layout);

  if (selectedTagFilters.length === 0) {
    const hint = document.createElement("p");
    hint.className = "tags-page-hint";
    hint.textContent =
      "Select one or more tags to see matching notebooks. Use All to require every tag, Any for a union.";
    section.append(hint);

    // Graveyard only appears in the no-selection view — when the user is
    // exploring overlaps we don't want a dormant-tag pile interrupting the
    // "show the intersection" flow. Clicking a rare pill clears back here
    // via the normal filter toggle → the section collapses naturally.
    if (graveyard.length > 0) {
      section.append(
        buildGraveyardSection(graveyard, selectedTagFilters, onToggleTagFilter),
      );
    }

    return section;
  }

  const matches = document.createElement("section");
  matches.className = "tags-page-matches";

  const filteredNotes = filterNotesByTags(
    workspace.notes,
    selectedTagFilters,
    filterMode,
  );

  if (filteredNotes.length > 0) {
    const summary = document.createElement("p");
    summary.className = "tags-page-summary";
    const modePhrase = filterMode === "any" ? "any selected tag" : "every selected tag";
    summary.textContent = `Showing ${filteredNotes.length} notebook${filteredNotes.length === 1 ? "" : "s"} that match ${modePhrase}.`;
    matches.append(summary);
  }

  matches.append(
    buildNotesList(
      currentNoteId,
      filteredNotes,
      onOpenNote,
      undefined,
      personaOptions,
    ),
  );
  section.append(matches);

  return section;
}

/**
 * The collapsible "Rare" section at the bottom of the Tags page. Mirrors the
 * handoff's Graveyard affordance: dormant (count==1, >90d) tags collected
 * behind a single disclosure so the main cloud stays quiet. Clicking a pill
 * still toggles the filter — rare tags are searchable, just not visually
 * prominent. The `<details>` element gives us native keyboard support and an
 * accessible expand/collapse with no JS overhead.
 */
function buildGraveyardSection(
  graveyard: readonly SutraPadTagEntry[],
  selectedTagFilters: string[],
  onToggleTagFilter: (tag: string) => void,
): HTMLElement {
  const details = document.createElement("details");
  details.className = "tags-graveyard";

  const summary = document.createElement("summary");
  summary.className = "tags-graveyard-summary";

  const label = document.createElement("span");
  label.className = "tags-graveyard-label";
  label.textContent = "Rare";

  const count = document.createElement("span");
  count.className = "tags-graveyard-count";
  count.textContent = `${graveyard.length}`;

  const hint = document.createElement("span");
  hint.className = "tags-graveyard-hint";
  hint.textContent = "· used once, not touched in 90+ days";

  summary.append(label, count, hint);
  details.append(summary);

  const body = document.createElement("div");
  body.className = "tags-graveyard-body";

  const copy = document.createElement("p");
  copy.className = "tags-graveyard-copy";
  copy.textContent =
    "Collapsed here to reduce noise in the main cloud — still searchable.";
  body.append(copy);

  const cloud = document.createElement("div");
  cloud.className = "tags-graveyard-cloud";
  for (const entry of graveyard) {
    cloud.append(
      buildTagPill({
        tag: entry.tag,
        kind: entry.kind,
        muted: true,
        count: `· ${entry.count}`,
        active: selectedTagFilters.includes(entry.tag),
        onClick: () => onToggleTagFilter(entry.tag),
      }),
    );
  }
  body.append(cloud);
  details.append(body);

  return details;
}
