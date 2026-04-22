import { filterTagSuggestions } from "../../../lib/notebook";
import type { SutraPadDocument, SutraPadTagEntry } from "../../../types";

/**
 * Combobox-style tag entry: a chip row that doubles as the input field, with
 * an autocomplete listbox attached. Rendering is driven entirely by the note
 * passed in — adding or removing a tag is delegated to the callbacks, both of
 * which are expected to trigger a full app re-render that rebuilds this
 * widget from scratch. That's why there's no "update in place" logic: once a
 * change is committed, the current DOM is thrown away and replaced.
 *
 * Keyboard contract:
 *  - ArrowDown / ArrowUp — move through the suggestion list (wraps).
 *  - Enter / Tab with suggestions open — commit the highlighted suggestion.
 *  - Enter / comma without suggestions — commit the raw input text.
 *  - Escape — close the suggestions without committing.
 *  - Backspace on an empty input — remove the last tag (chip-style delete).
 */
export function buildTagInput(
  note: SutraPadDocument,
  availableTagSuggestions: readonly SutraPadTagEntry[],
  onAddTag: (value: string) => void,
  onRemoveTag: (tag: string) => void,
): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "tags-field";

  const row = document.createElement("div");
  row.className = "tags-row";

  const input = document.createElement("input");
  input.className = "tag-text-input";
  input.type = "text";
  input.setAttribute("aria-label", "Add tag");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  const suggestionsList = document.createElement("ul");
  suggestionsList.className = "tag-suggestions";
  suggestionsList.setAttribute("role", "listbox");
  suggestionsList.hidden = true;

  let highlightedIndex = 0;
  let currentSuggestions: SutraPadTagEntry[] = [];

  const closeSuggestions = (): void => {
    suggestionsList.hidden = true;
    input.setAttribute("aria-expanded", "false");
    currentSuggestions = [];
    highlightedIndex = 0;
  };

  const renderSuggestions = (): void => {
    currentSuggestions = filterTagSuggestions(
      availableTagSuggestions,
      input.value,
      note.tags,
    );

    while (suggestionsList.firstChild) {
      suggestionsList.removeChild(suggestionsList.firstChild);
    }

    if (currentSuggestions.length === 0) {
      closeSuggestions();
      return;
    }

    if (highlightedIndex >= currentSuggestions.length) {
      highlightedIndex = 0;
    }

    for (let index = 0; index < currentSuggestions.length; index += 1) {
      const entry = currentSuggestions[index];
      const option = document.createElement("li");
      option.className = `tag-suggestion${index === highlightedIndex ? " is-active" : ""}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", index === highlightedIndex ? "true" : "false");

      const label = document.createElement("span");
      label.className = "tag-suggestion-label";
      label.textContent = entry.tag;

      const count = document.createElement("span");
      count.className = "tag-suggestion-count";
      count.textContent = String(entry.count);

      option.append(label, count);
      // Use mousedown so the suggestion is picked before the input's blur fires
      // and closes the dropdown.
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        addTag(entry.tag);
      });
      option.addEventListener("mouseenter", () => {
        highlightedIndex = index;
        updateHighlight();
      });

      suggestionsList.append(option);
    }

    suggestionsList.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const updateHighlight = (): void => {
    const options = suggestionsList.querySelectorAll<HTMLLIElement>(".tag-suggestion");
    options.forEach((option, index) => {
      const active = index === highlightedIndex;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
      if (active) option.scrollIntoView({ block: "nearest" });
    });
  };

  const addTag = (value: string): void => {
    const tag = value.trim().toLowerCase();
    if (!tag || note.tags.includes(tag)) return;
    // onAddTag triggers a full app render, which replaces this entire tag
    // input with a freshly built one (app.ts re-focuses it). Any DOM updates
    // below would run on the detached old nodes, so we just delegate.
    onAddTag(value);
  };

  input.addEventListener("keydown", (e) => {
    const hasOpenSuggestions = !suggestionsList.hidden && currentSuggestions.length > 0;

    if (e.key === "ArrowDown") {
      if (!hasOpenSuggestions) {
        renderSuggestions();
        return;
      }
      e.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % currentSuggestions.length;
      updateHighlight();
      return;
    }

    if (e.key === "ArrowUp") {
      if (!hasOpenSuggestions) return;
      e.preventDefault();
      highlightedIndex =
        (highlightedIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
      updateHighlight();
      return;
    }

    if (e.key === "Escape") {
      if (hasOpenSuggestions) {
        e.preventDefault();
        closeSuggestions();
      }
      return;
    }

    if ((e.key === "Enter" || e.key === "Tab") && hasOpenSuggestions) {
      // Tab with a highlighted suggestion commits that tag; without suggestions
      // we let Tab fall through so focus moves to the next field normally.
      e.preventDefault();
      addTag(currentSuggestions[highlightedIndex].tag);
      return;
    }

    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input.value);
      return;
    }

    if (e.key === "Backspace" && input.value === "") {
      const tags = note.tags;
      if (tags.length === 0) return;
      onRemoveTag(tags.at(-1) ?? "");
    }
  });

  input.addEventListener("input", () => {
    highlightedIndex = 0;
    renderSuggestions();
  });

  input.addEventListener("focus", () => {
    renderSuggestions();
  });

  input.addEventListener("blur", () => {
    // A small delay lets a click on a suggestion fire before we close the list
    // and commit any remaining text. Without it, blur fires first and the
    // suggestion row disappears before its click handler runs.
    window.setTimeout(() => {
      // If the input has been detached from the DOM (e.g. the keyboard path
      // already committed a tag and triggered a re-render), skip the flush —
      // otherwise we'd commit the stale partial text from the old input on
      // top of the tag we just added.
      if (!input.isConnected) return;
      if (input.value.trim()) {
        addTag(input.value);
        input.value = "";
      }
      closeSuggestions();
    }, 100);
  });

  row.addEventListener("click", (e) => {
    if (e.target === row) input.focus();
  });

  const renderChips = (): void => {
    while (row.firstChild) row.removeChild(row.firstChild);

    for (const tag of note.tags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";

      const label = document.createElement("span");
      label.textContent = tag;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "tag-chip-remove";
      removeBtn.setAttribute("aria-label", `Remove tag ${tag}`);
      removeBtn.textContent = "×";
      // onRemoveTag triggers a full app render (app.ts refocuses the new tag
      // input), so no local DOM updates are needed here.
      removeBtn.addEventListener("click", () => {
        onRemoveTag(tag);
      });

      chip.append(label, removeBtn);
      row.append(chip);
    }

    input.placeholder = note.tags.length === 0 ? "Add tags…" : "";
    row.append(input);
  };

  renderChips();
  wrapper.append(row, suggestionsList);
  return wrapper;
}
