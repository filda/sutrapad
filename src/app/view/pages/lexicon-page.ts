/**
 * Topic Lexicon Builder workbench page.
 *
 * Internal-only tooling described in `docs/dictionary-builder.md`. The
 * page is intentionally not wired into the primary nav — entry point
 * is a "Workbench" link in Settings + the `/lexicon` URL slug.
 *
 * Architecture choice: the builder owns its own state in module-scope
 * caches (`pageState`) rather than going through `app.ts`'s atom
 * store. The workspace concerns surrounding the regular notebook flow
 * (workspace, sync state, tag filters, …) don't apply here — the
 * builder talks directly to its own Drive artifacts. Keeping it
 * self-contained means the page can be removed cleanly when the
 * lexicon is finalised, with no dangling atom subscribers or
 * render-callbacks plumbing.
 *
 * Re-renders triggered by other parts of the app (sync pill changes,
 * theme switch, …) call `buildLexiconPage` again. The module cache
 * ensures the builder state survives such rebuilds without an extra
 * Drive round-trip.
 */
import {
  acceptExact,
  createEmptyBuilderState,
  isEmptyState,
  listCandidates,
  listExistingTargets,
  mapForm,
  mergeImport,
  rejectForm,
} from "../../logic/lexicon/state";
import { generateRuntimeLexicon } from "../../logic/lexicon/runtime";
import { filterTargetSuggestions } from "../../logic/lexicon/typeahead";
import type { BuilderState } from "../../logic/lexicon/types";
import { GoogleDriveLexiconStore } from "../../../services/drive/lexicon-store";
import type { MenuItemId } from "../../logic/menu";
import type { UserProfile } from "../../../types";

export interface LexiconPageOptions {
  profile: UserProfile | null;
  /**
   * Returns the current Drive access token, or `null` when the user is
   * signed out. Threaded through from the auth service in `app.ts` so
   * the page can build a `GoogleDriveLexiconStore` lazily on first
   * action — and so a sign-out mid-session is observable without
   * having to re-render at the app level.
   */
  getAccessToken: () => string | null;
  onSignIn: () => void;
  onSelectMenuItem: (id: MenuItemId) => void;
}

interface PageState {
  builder: BuilderState | null;
  loading: boolean;
  loadError: string | null;
  saveStatus: "idle" | "saving" | "error";
  saveError: string | null;
  skippedThisSession: Set<string>;
  /**
   * Pending save chain — used to serialise concurrent autosaves so
   * rapid Accept/Map clicks don't race each other on the wire. New
   * saves chain off the previous one's settle.
   */
  saveQueue: Promise<void>;
}

let pageState: PageState = createInitialState();
let renderHandle: { rerender: () => void } | null = null;

function createInitialState(): PageState {
  return {
    builder: null,
    loading: false,
    loadError: null,
    saveStatus: "idle",
    saveError: null,
    skippedThisSession: new Set<string>(),
    saveQueue: Promise.resolve(),
  };
}

export function buildLexiconPage(options: LexiconPageOptions): HTMLElement {
  const page = document.createElement("section");
  page.className = "lexicon-page";

  const heading = document.createElement("header");
  heading.className = "lexicon-header";
  const eyebrow = document.createElement("p");
  eyebrow.className = "panel-eyebrow";
  eyebrow.textContent = "Workbench · Internal";
  heading.append(eyebrow);
  const title = document.createElement("h1");
  title.textContent = "Topic Lexicon Builder";
  heading.append(title);
  const subtitle = document.createElement("p");
  subtitle.className = "lexicon-subtitle";
  subtitle.textContent =
    "Curate Czech word forms into canonical topic tags. The builder is hosted inside SutraPad temporarily — its state lives in your Google Drive alongside notes, but it is not part of the regular notebook flow.";
  heading.append(subtitle);
  const back = document.createElement("button");
  back.type = "button";
  back.className = "is-link lexicon-back";
  back.textContent = "← Back to Settings";
  back.addEventListener("click", () => options.onSelectMenuItem("settings"));
  heading.append(back);
  page.append(heading);

  if (!options.profile) {
    page.append(buildSignedOutNotice(options.onSignIn));
    return page;
  }

  const body = document.createElement("div");
  body.className = "lexicon-body";
  page.append(body);

  // Capture the rebuilder so action handlers can update only the body
  // without rebuilding the page header / wiring on every keystroke.
  const rerender = (): void => {
    body.replaceChildren(...renderBody(options));
  };
  renderHandle = { rerender };
  rerender();

  // Kick off the initial Drive load on first mount of the page (or
  // after a sign-in invalidated the previously-loaded state).
  if (pageState.builder === null && !pageState.loading) {
    void loadFromDrive(options.getAccessToken, rerender);
  }

  return page;
}

function renderBody(options: LexiconPageOptions): Node[] {
  if (pageState.loading) {
    return [buildPlaceholderCard("Loading lexicon from Drive…")];
  }
  if (pageState.loadError !== null) {
    return [
      buildErrorCard(`Couldn't load builder state: ${pageState.loadError}`, () =>
        retryLoad(options.getAccessToken),
      ),
    ];
  }
  const builder = pageState.builder ?? createEmptyBuilderState();

  return [
    buildCandidateCard(builder, options.getAccessToken),
    buildProgressStrip(builder),
    buildSaveStatus(),
    buildImportCard(options.getAccessToken),
  ];
}

function buildSignedOutNotice(onSignIn: () => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "lexicon-card lexicon-signin-card";

  const heading = document.createElement("h2");
  heading.textContent = "Sign in to use the workbench";
  card.append(heading);

  const note = document.createElement("p");
  note.textContent =
    "The builder reads and writes its working state to your Google Drive. Sign in with the same account you use for SutraPad notes.";
  card.append(note);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-primary";
  button.textContent = "Sign in with Google";
  button.addEventListener("click", onSignIn);
  card.append(button);

  return card;
}

function buildPlaceholderCard(message: string): HTMLElement {
  const card = document.createElement("div");
  card.className = "lexicon-card lexicon-placeholder-card";
  const text = document.createElement("p");
  text.textContent = message;
  card.append(text);
  return card;
}

function buildErrorCard(message: string, onRetry: () => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "lexicon-card lexicon-error-card";
  const text = document.createElement("p");
  text.textContent = message;
  card.append(text);

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", onRetry);
  card.append(retry);
  return card;
}

function buildImportCard(getAccessToken: () => string | null): HTMLElement {
  const card = document.createElement("section");
  card.className = "lexicon-card lexicon-import-card";

  const heading = document.createElement("h2");
  heading.textContent = "Import text";
  card.append(heading);

  const hint = document.createElement("p");
  hint.className = "lexicon-card-hint";
  hint.textContent =
    "Paste Czech text or upload a small text file. Forms already mapped or rejected are filtered out automatically.";
  card.append(hint);

  const fileLabel = document.createElement("label");
  fileLabel.className = "lexicon-file-label";
  fileLabel.textContent = "Upload .txt file: ";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".txt,text/plain";
  fileInput.className = "lexicon-file-input";
  fileLabel.append(fileInput);
  card.append(fileLabel);

  const textarea = document.createElement("textarea");
  textarea.className = "lexicon-textarea";
  textarea.placeholder = "Paste text here…";
  textarea.rows = 6;
  card.append(textarea);

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "button button-primary lexicon-import-button";
  importButton.textContent = "Import";
  card.append(importButton);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((content) => {
      textarea.value = content;
    });
  });

  importButton.addEventListener("click", () => {
    const text = textarea.value;
    if (!text.trim()) return;
    runMutation(
      getAccessToken,
      (state) => mergeImport(state, text),
      () => {
        textarea.value = "";
        fileInput.value = "";
      },
    );
  });

  return card;
}

function buildCandidateCard(
  builder: BuilderState,
  getAccessToken: () => string | null,
): HTMLElement {
  const card = document.createElement("section");
  card.className = "lexicon-card lexicon-candidate-card";

  const heading = document.createElement("h2");
  heading.textContent = "Current candidate";
  card.append(heading);

  const candidate = pickNextCandidate(builder);
  if (!candidate) {
    const empty = document.createElement("p");
    empty.className = "lexicon-empty-note";
    empty.textContent = isEmptyState(builder)
      ? "Import text above to start building the lexicon."
      : "No candidates waiting. Import more text to find new forms.";
    card.append(empty);
    return card;
  }

  const wordRow = document.createElement("div");
  wordRow.className = "lexicon-candidate-word-row";

  const word = document.createElement("p");
  word.className = "lexicon-candidate-word";
  word.textContent = candidate.form;
  wordRow.append(word);

  const count = document.createElement("p");
  count.className = "lexicon-candidate-count mono";
  count.textContent = `${candidate.count} ${candidate.count === 1 ? "occurrence" : "occurrences"}`;
  wordRow.append(count);
  card.append(wordRow);

  for (const context of candidate.contexts) {
    const ctx = document.createElement("p");
    ctx.className = "lexicon-candidate-context";
    ctx.textContent = context;
    card.append(ctx);
  }

  const targetRow = document.createElement("div");
  targetRow.className = "lexicon-target-row";

  const targetLabel = document.createElement("label");
  targetLabel.className = "lexicon-target-label";
  targetLabel.textContent = "Target tag";
  // The input lives inside an anchor div so the absolutely-positioned
  // typeahead dropdown can position relative to it without disturbing
  // the surrounding card layout.
  const inputWrap = document.createElement("div");
  inputWrap.className = "lexicon-target-input-wrap";
  const targetInput = document.createElement("input");
  targetInput.type = "text";
  targetInput.className = "lexicon-target-input";
  targetInput.placeholder = `e.g. praha — leave empty for ${candidate.form} → ${candidate.form}`;
  // `autocomplete=off` blocks browser autofill, but Chrome/Firefox
  // ignore it on form-less inputs. The custom typeahead below replaces
  // the native `<datalist>` flow Filip hit — datalist would erase
  // typed characters when the user typed faster than the dropdown
  // could react. Plain `<input>` + bespoke suggestion list is
  // predictable: the input value is only ever changed by the user
  // typing or by an explicit suggestion-click.
  targetInput.autocomplete = "off";
  targetInput.spellcheck = false;
  inputWrap.append(targetInput);
  targetLabel.append(inputWrap);
  targetRow.append(targetLabel);
  card.append(targetRow);

  const allTargets = listExistingTargets(builder);
  const typeahead = buildTargetTypeahead({
    input: targetInput,
    allTargets,
    onPick: (value) => {
      targetInput.value = value;
      // Move caret to end after a click-pick so the next keystroke
      // appends rather than overwriting from an unexpected position.
      const end = value.length;
      targetInput.setSelectionRange(end, end);
      targetInput.focus();
    },
  });
  inputWrap.append(typeahead.element);

  const actions = document.createElement("div");
  actions.className = "lexicon-actions";

  // Single Map button covers both "self-map" and "map to a different
  // canonical": empty input → form -> form (acceptExact), filled
  // input → form -> entered target. The placeholder hints at the
  // empty-input behaviour so the affordance isn't hidden.
  const mapButton = document.createElement("button");
  mapButton.type = "button";
  mapButton.className = "button lexicon-action-map";
  mapButton.textContent = "Map";
  mapButton.addEventListener("click", () => {
    const target = targetInput.value.trim().toLocaleLowerCase("cs-CZ").normalize("NFC");
    runMutation(
      getAccessToken,
      (state) =>
        target ? mapForm(state, candidate.form, target) : acceptExact(state, candidate.form),
    );
  });
  actions.append(mapButton);

  const rejectButton = document.createElement("button");
  rejectButton.type = "button";
  rejectButton.className = "button lexicon-action-reject";
  rejectButton.textContent = "Reject";
  rejectButton.addEventListener("click", () => {
    runMutation(getAccessToken, (state) => rejectForm(state, candidate.form));
  });
  actions.append(rejectButton);

  const skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.className = "button is-ghost";
  skipButton.textContent = "Skip";
  skipButton.addEventListener("click", () => {
    pageState.skippedThisSession.add(candidate.form);
    renderHandle?.rerender();
  });
  actions.append(skipButton);

  card.append(actions);

  // Enter-to-Map for keyboard-only flow. Registered AFTER the
  // typeahead keydown listener so the typeahead gets the first chance
  // to consume Enter (filling the input from a highlighted suggestion);
  // when no suggestion is highlighted, the typeahead lets Enter through
  // and this handler triggers Map.
  targetInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      mapButton.click();
    }
  });
  // Restore focus on the just-mounted input when the previous candidate
  // was decided via keyboard — small ergonomics win that matches the
  // editor-card pattern elsewhere.
  queueMicrotask(() => targetInput.focus());

  return card;
}

interface TargetTypeaheadOptions {
  readonly input: HTMLInputElement;
  readonly allTargets: readonly string[];
  /**
   * Called when the user picks a suggestion via click or Enter — the
   * caller is responsible for moving caret + (re)focusing the input
   * since picks are sometimes triggered from a click on the suggestion
   * pill, which would otherwise blur the field.
   */
  readonly onPick: (value: string) => void;
}

interface TargetTypeaheadHandle {
  readonly element: HTMLElement;
}

const TYPEAHEAD_LIMIT = 8;

/**
 * Custom typeahead replacing the native `<datalist>`. The native
 * widget is cheap to drop in but interacts badly with fast typing —
 * Chrome/Firefox occasionally swallow keystrokes when the dropdown is
 * mid-update and Filip hit this in real use. The bespoke version
 * here:
 *
 *   - never modifies `input.value` except via `onPick`, so the user's
 *     in-flight characters can't be erased mid-stream;
 *   - filters on every `input` event with a cs-CZ-aware substring
 *     match;
 *   - ranks `startsWith` matches above `includes` matches and falls
 *     back to alphabetical order;
 *   - supports ArrowUp/ArrowDown navigation, Enter-to-pick, and
 *     Escape-to-close;
 *   - closes on outside click + on input blur with a small grace
 *     period so a click on a suggestion pill still registers.
 */
function buildTargetTypeahead({
  input,
  allTargets,
  onPick,
}: TargetTypeaheadOptions): TargetTypeaheadHandle {
  const list = document.createElement("ul");
  list.className = "lexicon-typeahead";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  let suggestions: string[] = [];
  let highlighted = -1;

  const close = (): void => {
    list.hidden = true;
    highlighted = -1;
  };

  const renderList = (): void => {
    list.replaceChildren();
    if (suggestions.length === 0) {
      close();
      return;
    }
    list.hidden = false;
    for (const [index, suggestion] of suggestions.entries()) {
      const item = document.createElement("li");
      item.className = `lexicon-typeahead-item${index === highlighted ? " is-active" : ""}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", index === highlighted ? "true" : "false");
      item.textContent = suggestion;
      // mousedown (not click) so the pick fires before the input's
      // blur handler closes the list and prevents click delivery.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        onPick(suggestion);
        close();
      });
      list.append(item);
    }
  };

  const recompute = (): void => {
    // No suggestions until the user actually types something. The
    // input is auto-focused on candidate-card mount, so opening the
    // list on focus would cover the action buttons below before the
    // user has expressed any intent. Empty query → keep closed.
    if (input.value.trim() === "") {
      close();
      return;
    }
    suggestions = filterTargetSuggestions(input.value, allTargets, TYPEAHEAD_LIMIT);
    highlighted = suggestions.length > 0 ? 0 : -1;
    renderList();
  };

  input.addEventListener("input", recompute);
  input.addEventListener("blur", () => {
    // Slight delay so a click on a suggestion lands before close.
    // The mousedown handler above pre-empts this anyway, but the
    // delay also covers programmatic blur paths.
    setTimeout(close, 120);
  });
  input.addEventListener("keydown", (event) => {
    if (list.hidden || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlighted = (highlighted + 1) % suggestions.length;
      renderList();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
      renderList();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Enter" && highlighted >= 0) {
      const choice = suggestions[highlighted];
      // Stop propagation so the parent Enter→Map listener doesn't
      // also fire — the user picked a suggestion, they didn't ask
      // to commit yet. They press Enter a second time to commit
      // once the input is filled.
      event.preventDefault();
      event.stopImmediatePropagation();
      onPick(choice);
      close();
    }
  });

  return { element: list };
}


function buildProgressStrip(builder: BuilderState): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "lexicon-progress-strip";

  const mapped = Object.keys(builder.forms).length;
  const rejected = builder.rejectedForms.length;
  const waiting = countWaitingCandidates(builder);

  strip.textContent = `Mapped ${mapped} · Rejected ${rejected} · Waiting ${waiting}`;
  return strip;
}

function buildSaveStatus(): HTMLElement {
  const strip = document.createElement("p");
  strip.className = `lexicon-save-status lexicon-save-${pageState.saveStatus}`;
  if (pageState.saveStatus === "saving") {
    strip.textContent = "Saving to Drive…";
  } else if (pageState.saveStatus === "error") {
    strip.textContent = `Save failed: ${pageState.saveError ?? "unknown error"}. Retried automatically on next action.`;
  } else {
    strip.textContent = "Autosaves to Drive after every decision.";
  }
  return strip;
}

function pickNextCandidate(
  builder: BuilderState,
): { form: string; count: number; contexts: readonly string[] } | null {
  const candidates = listCandidates(builder);
  for (const candidate of candidates) {
    if (!pageState.skippedThisSession.has(candidate.form)) return candidate;
  }
  // Every visible candidate is skipped this session — surface nothing
  // (treated as the empty-state message). The user can reload to bring
  // skipped forms back, per the spec.
  return null;
}

function countWaitingCandidates(builder: BuilderState): number {
  let count = 0;
  for (const form of Object.keys(builder.candidates)) {
    if (!pageState.skippedThisSession.has(form)) count += 1;
  }
  return count;
}

/**
 * Applies a pure mutation to the builder state, immediately re-renders
 * the page body so the UI never lags behind state, then queues the
 * Drive autosave on the serialised save chain.
 */
function runMutation(
  getAccessToken: () => string | null,
  mutate: (state: BuilderState) => BuilderState,
  onSuccess?: () => void,
): void {
  const previous = pageState.builder ?? createEmptyBuilderState();
  const next = mutate(previous);
  if (next === previous) {
    onSuccess?.();
    return;
  }
  pageState = { ...pageState, builder: next };
  renderHandle?.rerender();
  onSuccess?.();
  void scheduleSave(getAccessToken, next);
}

async function scheduleSave(
  getAccessToken: () => string | null,
  state: BuilderState,
): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    pageState = {
      ...pageState,
      saveStatus: "error",
      saveError: "Not signed in.",
    };
    renderHandle?.rerender();
    return;
  }
  pageState = { ...pageState, saveStatus: "saving", saveError: null };
  renderHandle?.rerender();

  const previousQueue = pageState.saveQueue;
  const next = previousQueue.then(async () => {
    const store = new GoogleDriveLexiconStore(token);
    const runtime = generateRuntimeLexicon(state);
    await store.saveStateAndRuntime(state, runtime);
  });
  pageState = { ...pageState, saveQueue: next };

  try {
    await next;
    if (pageState.saveQueue === next) {
      pageState = {
        ...pageState,
        saveStatus: "idle",
        saveError: null,
      };
      renderHandle?.rerender();
    }
  } catch (error) {
    pageState = {
      ...pageState,
      saveStatus: "error",
      saveError: error instanceof Error ? error.message : "Drive save failed.",
    };
    renderHandle?.rerender();
  }
}

async function loadFromDrive(
  getAccessToken: () => string | null,
  rerender: () => void,
): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    pageState = {
      ...pageState,
      loadError: "Not signed in.",
    };
    rerender();
    return;
  }

  pageState = { ...pageState, loading: true, loadError: null };
  rerender();

  try {
    const store = new GoogleDriveLexiconStore(token);
    const remote = await store.loadState();
    pageState = {
      ...pageState,
      loading: false,
      builder: remote ?? createEmptyBuilderState(),
      loadError: null,
    };
    rerender();
  } catch (error) {
    pageState = {
      ...pageState,
      loading: false,
      loadError: error instanceof Error ? error.message : "Drive load failed.",
    };
    rerender();
  }
}

function retryLoad(getAccessToken: () => string | null): void {
  pageState = { ...pageState, loadError: null };
  void loadFromDrive(getAccessToken, () => renderHandle?.rerender());
}
