import {
  filterPaletteEntries,
  flattenPaletteGroups,
  navigatePaletteEntries,
  reconcileActiveEntryId,
  type PaletteEntry,
  type PaletteGroups,
} from "../logic/palette";

/**
 * Global command palette (opened with `/`). Self-contained overlay: it owns
 * its input, active-highlight state, and keyboard handling, so the caller
 * doesn't need to re-render on every keystroke — which would also kill the
 * input's focus mid-typing. The palette rebuilds only its results list from
 * the full, unfiltered groups passed in at open time.
 *
 * Lifecycle:
 *   1. Caller builds the full groups with `buildPaletteEntries(workspace)`
 *      and calls `mountPalette(...)`, which appends the overlay to the
 *      target element (usually `document.body`).
 *   2. User types / arrows / Enter. The palette updates its own DOM.
 *   3. On Enter or row click: `onSelectEntry(entry)` fires and the palette
 *      tears itself down. The caller then performs the navigation.
 *   4. On Esc or backdrop click: the palette tears itself down via
 *      `onClose()` and the caller does nothing further.
 */

export interface PaletteMountOptions {
  host: HTMLElement;
  groups: PaletteGroups;
  /**
   * Tags currently applied as filters on the notes list. Each tag row shows
   * "Remove" instead of "Add" when its label is in this list, so the user
   * can see at a glance which tags are already active.
   */
  selectedTagFilters: readonly string[];
  onSelectEntry: (entry: PaletteEntry) => void;
  onClose: () => void;
}

export interface PaletteHandle {
  /**
   * Replaces the palette's groups + active-filter snapshot — used when the
   * workspace changes while the palette is open (e.g. a background Drive
   * load completes) or the filter set shifts under it. The current query
   * is re-applied so the visible list updates without the user losing
   * their typing.
   */
  update: (groups: PaletteGroups, selectedTagFilters: readonly string[]) => void;
  /** Removes the overlay from the DOM and detaches listeners. Idempotent. */
  destroy: () => void;
}

export function mountPalette(options: PaletteMountOptions): PaletteHandle {
  const { host, groups, selectedTagFilters, onSelectEntry, onClose } = options;

  let currentGroups: PaletteGroups = groups;
  let currentSelectedTagFilters: readonly string[] = selectedTagFilters;
  let currentQuery = "";
  let currentActiveId: string | null = null;
  let destroyed = false;

  const backdrop = document.createElement("div");
  backdrop.className = "palette-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "Command palette");

  const palette = document.createElement("div");
  palette.className = "palette";
  backdrop.append(palette);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "palette-input";
  input.placeholder = "Search notes and tags…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search notes and tags");
  palette.append(input);

  const results = document.createElement("div");
  results.className = "palette-results";
  palette.append(results);

  const renderResults = (): void => {
    const filtered = filterPaletteEntries(currentGroups, currentQuery);
    const flat = flattenPaletteGroups(filtered);
    currentActiveId = reconcileActiveEntryId(flat, currentActiveId);

    results.replaceChildren();
    if (flat.length === 0) {
      const empty = document.createElement("p");
      empty.className = "palette-empty";
      empty.textContent = currentQuery.trim()
        ? "No matches."
        : "This notebook is empty. Start a note or add a tag.";
      results.append(empty);
      return;
    }

    if (filtered.notes.length > 0) {
      results.append(renderGroupHeader("Notes"));
      for (const entry of filtered.notes) {
        results.append(buildResultItem(entry));
      }
    }

    if (filtered.tags.length > 0) {
      results.append(renderGroupHeader("Tags"));
      for (const entry of filtered.tags) {
        results.append(buildResultItem(entry));
      }
    }
  };

  const buildResultItem = (entry: PaletteEntry): HTMLElement => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "pr-item";
    row.dataset.entryId = entry.id;
    if (entry.id === currentActiveId) {
      row.classList.add("is-active");
    }
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(entry.id === currentActiveId));

    const label = document.createElement("span");
    label.className = "pr-item-label";
    label.textContent = entry.label;
    row.append(label);

    if (entry.subtitle) {
      const sub = document.createElement("span");
      sub.className = "pr-item-sub";
      sub.textContent = entry.subtitle;
      row.append(sub);
    }

    // Right-aligned chip does two jobs depending on the row kind:
    //  * Note rows show a plain "Note" label so the user can tell a note
    //    apart from a tag even when labels collide (e.g. a note titled
    //    "work" next to the `work` tag).
    //  * Tag rows show the *action* Enter will perform: "Add" when the
    //    tag isn't part of the current filter set, or "Remove" (with an
    //    is-active modifier for accent styling) when it already is. This
    //    is how we make the toggle behaviour explicit per the scope call
    //    — tags are cumulative but the user sees exactly what's about
    //    to happen before they commit.
    const chip = document.createElement("span");
    chip.className = "pr-item-kind";
    if (entry.payload.kind === "note") {
      chip.textContent = "Note";
    } else {
      const isActiveFilter = currentSelectedTagFilters.includes(entry.payload.tag);
      chip.textContent = isActiveFilter ? "Remove" : "Add";
      chip.classList.add(isActiveFilter ? "is-remove" : "is-add");
    }
    row.append(chip);

    row.addEventListener("mouseenter", () => {
      currentActiveId = entry.id;
      highlightActive();
    });
    row.addEventListener("click", () => {
      activateCurrent(entry);
    });

    return row;
  };

  /**
   * Lightweight re-paint of the active-highlight class across existing rows.
   * Called on hover + keyboard nav so arrow presses don't have to rebuild
   * the full results list for a visual state change.
   */
  const highlightActive = (): void => {
    for (const row of results.querySelectorAll<HTMLElement>(".pr-item")) {
      const isActive = row.dataset.entryId === currentActiveId;
      row.classList.toggle("is-active", isActive);
      row.setAttribute("aria-selected", String(isActive));
      if (isActive) {
        // Keep the active row in view when navigating with the keyboard.
        // `nearest` avoids a jarring scroll when the row is already visible.
        row.scrollIntoView({ block: "nearest" });
      }
    }
  };

  const activateCurrent = (entry?: PaletteEntry): void => {
    const target =
      entry ??
      flattenPaletteGroups(
        filterPaletteEntries(currentGroups, currentQuery),
      ).find((candidate) => candidate.id === currentActiveId);
    if (!target) return;
    teardown();
    onSelectEntry(target);
  };

  const moveActive = (direction: "next" | "prev"): void => {
    const flat = flattenPaletteGroups(
      filterPaletteEntries(currentGroups, currentQuery),
    );
    currentActiveId = navigatePaletteEntries(
      flat,
      currentActiveId,
      direction,
    );
    highlightActive();
  };

  input.addEventListener("input", () => {
    currentQuery = input.value;
    // Typing should reset to the top match so Enter does something
    // predictable. reconcileActiveEntryId inside renderResults handles the
    // case where the previous active id is no longer visible.
    currentActiveId = null;
    renderResults();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive("next");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive("prev");
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateCurrent();
    } else if (event.key === "Escape") {
      event.preventDefault();
      teardown();
      onClose();
    }
  });

  backdrop.addEventListener("mousedown", (event) => {
    // Only close when the click started on the backdrop itself — a
    // mousedown inside the palette that drags onto the backdrop shouldn't
    // dismiss it (matches the standard modal pattern).
    if (event.target === backdrop) {
      teardown();
      onClose();
    }
  });

  const teardown = (): void => {
    if (destroyed) return;
    destroyed = true;
    backdrop.remove();
  };

  host.append(backdrop);
  renderResults();
  // Focus happens after append so the input is attached to the document and
  // accepts focus. Without this, the very first keystroke would be lost on
  // some browsers that defer focus into next-microtask after appendChild.
  input.focus();

  return {
    update: (nextGroups, nextSelectedTagFilters) => {
      if (destroyed) return;
      currentGroups = nextGroups;
      currentSelectedTagFilters = nextSelectedTagFilters;
      renderResults();
    },
    destroy: teardown,
  };
}

/**
 * Decides whether a `/` keystroke should be treated as "open palette" or as
 * a regular character destined for whatever the user is typing into. Used
 * by the global key listener in app.ts so the shortcut never steals a slash
 * from a note body or a tag input.
 */
function renderGroupHeader(label: string): HTMLElement {
  const header = document.createElement("p");
  header.className = "pr-group";
  header.textContent = label;
  return header;
}

export function shouldOpenPaletteForSlash(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.isContentEditable) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return false;
  }
  return true;
}
