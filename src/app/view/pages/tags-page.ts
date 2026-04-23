import {
  buildAvailableCombinedTagIndex,
  buildCombinedTagIndex,
  filterNotesByTags,
} from "../../../lib/notebook";
import { splitGraveyard } from "../../logic/tag-graveyard";
import type {
  SutraPadTagEntry,
  SutraPadTagFilterMode,
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
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  onChangeFilterMode: (mode: SutraPadTagFilterMode) => void;
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

function appendTagChips(
  cloud: HTMLElement,
  entries: readonly SutraPadTagEntry[],
  selectedTagFilters: string[],
  onToggleTagFilter: (tag: string) => void,
): void {
  for (const entry of entries) {
    // Large size + counter ("· 12") to match the Tags-page cloud density.
    // Active state is driven by the current filter selection so the pill
    // visual and the filter set never drift.
    cloud.append(
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
}

export function buildTagsPage({
  workspace,
  selectedTagFilters,
  filterMode,
  currentNoteId,
  personaOptions,
  onToggleTagFilter,
  onClearTagFilters,
  onChangeFilterMode,
  onOpenNote,
}: TagsPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "tags-page";

  // We build the full combined index (not the narrowed "available" one) so the
  // empty-state decision is based on whether *any* tag exists anywhere —
  // narrowing by the current filter would mislead a user whose selection
  // accidentally filtered out every other tag.
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
      eyebrow: `Tags · ${fullIndex.tags.length} unique · ${noteCount} note${noteCount === 1 ? "" : "s"}`,
      titleHtml: "A <em>constellation</em> of what you think about.",
      subtitle:
        "Click tags to filter. Combine several and we'll show the notebooks that live where they overlap — All narrows to intersection, Any expands to union.",
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
  // subset the current filter has narrowed us to. We use the resulting set to
  // cull the main clouds (the handoff calls this "collapsed to reduce noise")
  // and to drive the collapsible section at the bottom.
  const { graveyard } = splitGraveyard(fullIndex, workspace);
  const graveyardTags = new Set(graveyard.map((entry) => entry.tag));

  // For the rendered cloud we use the *available* index: narrows to tags that
  // still yield results under the current selection + mode, so the next click
  // is never a dead end. When there's no active selection this collapses to
  // the full index, preserving the original "show everything" behaviour.
  const availableIndex = buildAvailableCombinedTagIndex(
    workspace,
    selectedTagFilters,
    filterMode,
  );
  const livingAvailable = availableIndex.tags.filter(
    (entry) => !graveyardTags.has(entry.tag),
  );
  const userEntries = livingAvailable.filter((entry) => entry.kind !== "auto");
  const autoEntries = livingAvailable.filter((entry) => entry.kind === "auto");

  if (userEntries.length > 0) {
    const userHeading = document.createElement("p");
    userHeading.className = "tags-cloud-heading";
    userHeading.textContent = "Your tags";
    section.append(userHeading);

    const userCloud = document.createElement("div");
    userCloud.className = "tags-cloud-wide";
    appendTagChips(userCloud, userEntries, selectedTagFilters, onToggleTagFilter);
    section.append(userCloud);
  }

  if (autoEntries.length > 0) {
    const autoHeading = document.createElement("p");
    autoHeading.className = "tags-cloud-heading is-auto";
    autoHeading.textContent = "Auto tags";
    section.append(autoHeading);

    const autoCloud = document.createElement("div");
    autoCloud.className = "tags-cloud-wide";
    appendTagChips(autoCloud, autoEntries, selectedTagFilters, onToggleTagFilter);
    section.append(autoCloud);
  }

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
