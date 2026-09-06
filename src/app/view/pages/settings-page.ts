import type { UserProfile } from "../../../types";
import {
  type CaptureLocationPreference,
} from "../../logic/capture-location";
import { type MenuItemId } from "../../logic/menu";
import { type PersonaPreference } from "../../logic/persona";
import type { AliasSuggestion } from "../../logic/tag-aliases";
import { describeThemes, type ThemeChoice } from "../../logic/theme";
import {
  allLocales,
  formatPlural,
  getActiveLocale,
  messages,
  type Locale,
} from "../../../lib/i18n";
import { buildTagPill } from "../shared/tag-pill";
import { buildMicrophoneConsentCard } from "../shared/microphone-consent-card";
import {
  describeRebuildStatus,
  type RebuildStatus,
} from "../../logic/rebuild-status";

/**
 * Builds a settings card's `<header>` — an eyebrow `<p>` + an `<h2>` title.
 * Both labels are set via `textContent` (DOM construction, no `innerHTML`),
 * so the card headers no longer parse trusted-but-static HTML strings and
 * a future dynamic label can't regress into a markup sink.
 */
function buildSettingsCardHeader(eyebrow: string, title: string): HTMLElement {
  const header = document.createElement("header");
  header.className = "settings-card-header";
  const eyebrowEl = document.createElement("p");
  eyebrowEl.className = "panel-eyebrow";
  eyebrowEl.textContent = eyebrow;
  const titleEl = document.createElement("h2");
  titleEl.textContent = title;
  header.append(eyebrowEl, titleEl);
  return header;
}

export interface SettingsPageOptions {
  /**
   * Active app language, for the picker's selected state — the same role
   * `currentTheme` plays for the theme grid. It is not what decides the
   * language of this page's text: that comes from the module-level catalog,
   * which `applyLocale` has already pointed at this locale. A key, not copy
   * — persisted verbatim and set as `<html lang>`; only its display name in
   * the picker is translated.
   */
  locale: Locale;
  currentTheme: ThemeChoice;
  personaPreference: PersonaPreference;
  /**
   * Whether `+ Add` is allowed to call `getCurrentPosition` on note
   * creation. Tri-state: `"on"`, `"off"`, or `"unanswered"` for first-run
   * users who haven't yet resolved the in-editor consent card. The
   * toggle in this card surfaces explicit decisions only; when the
   * preference is `"unanswered"` neither toggle option lights up.
   */
  captureLocationPreference: CaptureLocationPreference;
  profile: UserProfile | null;
  /**
   * Deduplication suggestions computed over the current workspace, with
   * the user's dismissed pairs already filtered out. Empty array collapses
   * the hygiene card into a one-liner "nothing to clean up" state.
   */
  tagAliasSuggestions: readonly AliasSuggestion[];
  onChangeLocale: (locale: Locale) => void;
  onChangeTheme: (choice: ThemeChoice) => void;
  onChangePersonaPreference: (preference: PersonaPreference) => void;
  onChangeCaptureLocationPreference: (
    preference: CaptureLocationPreference,
  ) => void;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  /**
   * Maintenance-rebuild status shown as the Backup card's third action's
   * status line. See `describeRebuildStatus` for the state → text mapping.
   */
  rebuildStatus: RebuildStatus;
  /** Fires the manual "Rebuild index" action. */
  onRebuildIndex: () => void;
  onSignIn: () => void;
  /** Collapses a suggestion into `canonical` across every note that carries an alias. */
  onMergeTagAlias: (from: string, to: string) => void;
  /** Marks the canonical↔alias pair as "keep separate" so future renders skip it. */
  onDismissTagAlias: (canonical: string, alias: string) => void;
  /**
   * Routing callback. Used by the Privacy card's "Read full policy"
   * link — same plumbing the topbar / footer already share, so
   * static-page navigation never invents its own primitive.
   */
  onSelectMenuItem: (id: MenuItemId) => void;
}

/**
 * Settings page. Each concern lives in its own card inside the page wrapper:
 * language and appearance (per-device UI preferences), notebook persona
 * (decorative card layer), tag hygiene (alias / merge suggestions), and
 * backup (manual Google Drive load/save). Further device-local or
 * account-level preferences slot in as additional cards in the same
 * container.
 */
export function buildSettingsPage({
  locale,
  currentTheme,
  personaPreference,
  captureLocationPreference,
  profile,
  tagAliasSuggestions,
  onChangeLocale,
  onChangeTheme,
  onChangePersonaPreference,
  onChangeCaptureLocationPreference,
  onLoadNotebook,
  onSaveNotebook,
  rebuildStatus,
  onRebuildIndex,
  onSignIn,
  onMergeTagAlias,
  onDismissTagAlias,
  onSelectMenuItem,
}: SettingsPageOptions): HTMLElement {
  const page = document.createElement("section");
  page.className = "settings-page";

  // Language leads: a reader who ended up in the wrong locale has to be able
  // to find the way out without reading the rest of the page.
  page.append(buildLanguageCard({ locale, onChangeLocale }));
  page.append(buildAppearanceCard({ currentTheme, onChangeTheme }));
  page.append(
    buildPersonaCard({ personaPreference, onChangePersonaPreference }),
  );
  page.append(
    buildTagHygieneCard({
      tagAliasSuggestions,
      onMergeTagAlias,
      onDismissTagAlias,
    }),
  );
  page.append(
    buildBackupCard({
      profile,
      onLoadNotebook,
      onSaveNotebook,
      rebuildStatus,
      onRebuildIndex,
      onSignIn,
    }),
  );
  page.append(
    buildPrivacyCard({
      captureLocationPreference,
      onChangeCaptureLocationPreference,
      onSelectMenuItem,
    }),
  );
  page.append(buildWorkbenchCard({ onSelectMenuItem }));

  return page;
}

interface WorkbenchCardOptions {
  onSelectMenuItem: (id: MenuItemId) => void;
}

/**
 * Workbench card — surfaces internal-only tooling that lives inside the
 * SutraPad app temporarily. Today's only entry is the Topic Lexicon
 * Builder; future workbenches slot in as additional rows below.
 *
 * Intentionally minimal styling and tucked under the privacy card —
 * this card exists so the workbench is reachable without polluting the
 * primary nav, not so it's discoverable to general users.
 */
function buildWorkbenchCard({
  onSelectMenuItem,
}: WorkbenchCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card settings-card-workbench";

  const copy = messages().settings.workbench;

  card.append(buildSettingsCardHeader(copy.eyebrow, copy.title));

  const hint = document.createElement("p");
  hint.className = "settings-card-hint";
  hint.textContent = copy.hint;
  card.append(hint);

  const link = document.createElement("button");
  link.type = "button";
  link.className = "is-link settings-card-workbench-link";
  link.textContent = copy.lexiconLink;
  link.addEventListener("click", () => onSelectMenuItem("lexicon"));
  card.append(link);

  return card;
}

interface PrivacyCardOptions {
  captureLocationPreference: CaptureLocationPreference;
  onChangeCaptureLocationPreference: (
    preference: CaptureLocationPreference,
  ) => void;
  onSelectMenuItem: (id: MenuItemId) => void;
}

/**
 * Privacy controls + pointer to the full disclosure page. Today this
 * card hosts a single in-page control — the location-capture toggle,
 * which gates the geolocation prompt that used to fire silently on
 * `+ Add`. Future privacy-shaped controls (analytics opt-out, etc.)
 * slot in alongside as additional toggle groups inside this card,
 * which keeps "the privacy switches" clustered visually.
 *
 * The "Read the full Privacy page" link routes via the same
 * `onSelectMenuItem` plumbing as the topbar / footer — the long-form
 * page lives in `privacy-page.ts` (single source of truth, two entry
 * points: this card and the footer link).
 */
function buildPrivacyCard({
  captureLocationPreference,
  onChangeCaptureLocationPreference,
  onSelectMenuItem,
}: PrivacyCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card settings-card-privacy";

  const copy = messages().settings.privacy;

  const heading = document.createElement("h3");
  heading.textContent = copy.title;
  card.append(heading);

  const summary = document.createElement("p");
  summary.textContent = copy.summary;
  card.append(summary);

  card.append(
    buildLocationCaptureToggle({
      captureLocationPreference,
      onChangeCaptureLocationPreference,
    }),
  );

  card.append(buildMicrophoneConsentCard());

  const link = document.createElement("button");
  link.type = "button";
  link.className = "is-link settings-card-privacy-link";
  link.textContent = copy.readFullPolicy;
  link.addEventListener("click", () => onSelectMenuItem("privacy"));
  card.append(link);

  return card;
}

interface LocationCaptureToggleOptions {
  captureLocationPreference: CaptureLocationPreference;
  onChangeCaptureLocationPreference: (
    preference: CaptureLocationPreference,
  ) => void;
}

/**
 * Radio-group toggle for the location-capture preference. Mirrors the
 * Persona card's two-button toggle so the visual language stays
 * consistent. Surfaces only the explicit `"on"` / `"off"` values —
 * first-run users see the dedicated consent card inside the editor
 * stage, and the preference flips into one of these two when they
 * resolve it there. Once a decision has been made, this toggle is
 * the surface for changing your mind.
 */
function buildLocationCaptureToggle({
  captureLocationPreference,
  onChangeCaptureLocationPreference,
}: LocationCaptureToggleOptions): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "settings-card-privacy-toggle";

  const copy = messages().settings.privacy.captureLocation;

  const label = document.createElement("p");
  label.className = "settings-card-subheading";
  label.textContent = copy.label;
  wrapper.append(label);

  const hint = document.createElement("p");
  hint.className = "settings-card-hint";
  hint.textContent = copy.hint;
  wrapper.append(hint);

  const group = document.createElement("div");
  group.className = "persona-toggle";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", copy.label);

  // `value` is the persisted preference and stays untranslated; the label and
  // description beside it are the only localized part of the row.
  const options: ReadonlyArray<{
    value: CaptureLocationPreference;
    label: string;
    description: string;
  }> = [
    { value: "off", ...copy.off },
    { value: "on", ...copy.on },
  ];

  for (const option of options) {
    const isSelected = option.value === captureLocationPreference;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `persona-toggle-option${isSelected ? " is-active" : ""}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", isSelected ? "true" : "false");
    button.dataset.captureLocationPreference = option.value;

    const optionLabel = document.createElement("span");
    optionLabel.className = "persona-toggle-label";
    optionLabel.textContent = option.label;

    const optionDescription = document.createElement("span");
    optionDescription.className = "persona-toggle-description";
    optionDescription.textContent = option.description;

    button.append(optionLabel, optionDescription);
    button.addEventListener("click", () =>
      onChangeCaptureLocationPreference(option.value),
    );
    group.append(button);
  }

  wrapper.append(group);
  return wrapper;
}

interface LanguageCardOptions {
  locale: Locale;
  onChangeLocale: (locale: Locale) => void;
}

/**
 * App language picker. Same two-button radio shape as the Persona and
 * location toggles, so the three device-local preferences read alike.
 *
 * Each language is named in *its own* language rather than translated
 * ("Čeština", not "Czech"): someone who has landed in a locale they can't
 * read has to be able to find their way out, and a list of names they can't
 * read doesn't help them. That is also why this card is first on the page.
 *
 * The `data-locale` attribute carries the raw locale id — the value that
 * gets persisted and set as `<html lang>` — so a test can assert the key
 * independently of whatever the button says.
 */
function buildLanguageCard({
  locale,
  onChangeLocale,
}: LanguageCardOptions): HTMLElement {
  const catalog = messages();
  const copy = catalog.settings.language;

  const card = document.createElement("section");
  card.className = "settings-card";

  card.append(buildSettingsCardHeader(copy.eyebrow, copy.title));

  const hint = document.createElement("p");
  hint.className = "settings-card-hint";
  hint.textContent = copy.hint;
  card.append(hint);

  const group = document.createElement("div");
  group.className = "persona-toggle";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", copy.groupLabel);

  for (const option of allLocales()) {
    const isSelected = option === locale;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `persona-toggle-option${isSelected ? " is-active" : ""}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", isSelected ? "true" : "false");
    button.dataset.locale = option;
    // `lang` on the button itself: the option labels are each in a different
    // language from the page, and without it a screen reader reads "Čeština"
    // with English pronunciation rules.
    button.lang = option;

    const label = document.createElement("span");
    label.className = "persona-toggle-label";
    label.textContent = catalog.localeName[option];
    button.append(label);

    button.addEventListener("click", () => onChangeLocale(option));
    group.append(button);
  }

  card.append(group);
  return card;
}

interface AppearanceCardOptions {
  currentTheme: ThemeChoice;
  onChangeTheme: (choice: ThemeChoice) => void;
}

function buildAppearanceCard({
  currentTheme,
  onChangeTheme,
}: AppearanceCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card";

  const catalog = messages();
  const copy = catalog.settings.appearance;

  card.append(buildSettingsCardHeader(copy.eyebrow, copy.title));

  const hint = document.createElement("p");
  hint.className = "settings-card-hint";
  hint.textContent = copy.hint;
  card.append(hint);

  const grid = document.createElement("div");
  grid.className = "theme-grid";
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", copy.groupLabel);

  for (const theme of describeThemes(catalog)) {
    const isSelected = theme.id === currentTheme;
    const themeCard = document.createElement("button");
    themeCard.type = "button";
    themeCard.className = `theme-card${isSelected ? " is-active" : ""}`;
    themeCard.setAttribute("role", "radio");
    themeCard.setAttribute("aria-checked", isSelected ? "true" : "false");
    themeCard.dataset.themeId = theme.id;

    const swatches = document.createElement("span");
    swatches.className = "theme-swatches";
    swatches.setAttribute("aria-hidden", "true");
    for (const key of ["background", "primary", "accent"] as const) {
      const swatch = document.createElement("span");
      swatch.className = `theme-swatch theme-swatch-${key}`;
      swatch.style.background = theme.swatches[key];
      swatches.append(swatch);
    }
    themeCard.append(swatches);

    const label = document.createElement("span");
    label.className = "theme-card-label";
    label.textContent = theme.label;
    themeCard.append(label);

    const description = document.createElement("span");
    description.className = "theme-card-description";
    description.textContent = theme.description;
    themeCard.append(description);

    themeCard.addEventListener("click", () => onChangeTheme(theme.id));
    grid.append(themeCard);
  }

  card.append(grid);
  return card;
}

interface PersonaCardOptions {
  personaPreference: PersonaPreference;
  onChangePersonaPreference: (preference: PersonaPreference) => void;
}

/**
 * Notebook persona card. The persona layer paints each note card with a
 * time-of-day paper palette, a small rotation, and decorative stickers —
 * it's opinionated, so it ships off by default and the user turns it on
 * here. The toggle is a pair of radio-style buttons rather than a checkbox
 * so the two states read as equally first-class choices (matching the
 * Theme card's grid below).
 */
function buildPersonaCard({
  personaPreference,
  onChangePersonaPreference,
}: PersonaCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card";

  const copy = messages().settings.persona;

  card.append(buildSettingsCardHeader(copy.eyebrow, copy.title));

  const hint = document.createElement("p");
  hint.className = "settings-card-hint";
  hint.textContent = copy.hint;
  card.append(hint);

  const group = document.createElement("div");
  group.className = "persona-toggle";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", copy.groupLabel);

  const options: ReadonlyArray<{
    value: PersonaPreference;
    label: string;
    description: string;
  }> = [
    { value: "off", ...copy.off },
    { value: "on", ...copy.on },
  ];

  for (const option of options) {
    const isSelected = option.value === personaPreference;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `persona-toggle-option${isSelected ? " is-active" : ""}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", isSelected ? "true" : "false");
    button.dataset.personaPreference = option.value;

    const label = document.createElement("span");
    label.className = "persona-toggle-label";
    label.textContent = option.label;

    const description = document.createElement("span");
    description.className = "persona-toggle-description";
    description.textContent = option.description;

    button.append(label, description);
    button.addEventListener("click", () =>
      onChangePersonaPreference(option.value),
    );
    group.append(button);
  }

  card.append(group);
  return card;
}

interface TagHygieneCardOptions {
  tagAliasSuggestions: readonly AliasSuggestion[];
  onMergeTagAlias: (from: string, to: string) => void;
  onDismissTagAlias: (canonical: string, alias: string) => void;
}

/**
 * Tag hygiene card. Surfaces alias/merge suggestions the heuristic in
 * `src/app/logic/tag-aliases.ts` flagged — pairs of topic tags that look
 * like spellings of the same thing.
 *
 * One card per canonical tag, with a pill row of the alias candidates,
 * the reason the heuristic picked them, and two actions:
 *
 *   - **Merge** — per-alias affordance (the button is rendered beside each
 *     alias pill). One click rewrites every note that carries that alias
 *     over to the canonical string and bumps its `updatedAt`. We keep the
 *     action per-alias rather than "merge all" because a cluster of three
 *     can mix a real duplicate with a false positive, and the user should
 *     get to pick without re-entering the flow.
 *   - **Keep separate** — per-alias too, for the same reason. Dismissing
 *     one alias in a three-way cluster doesn't hide the card; only when
 *     every alias has been either merged or dismissed does the whole
 *     suggestion drop off the list on the next render.
 *
 * The handoff put this in a right-panel hygiene view on the Tags page; we
 * moved it here because the Tags page's hygiene toggle was removed when
 * #84 (Constellation → list) landed and the card reads fine alongside
 * the other Settings cards.
 */
function buildTagHygieneCard({
  tagAliasSuggestions,
  onMergeTagAlias,
  onDismissTagAlias,
}: TagHygieneCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card tag-hygiene-card";

  const copy = messages().settings.tagHygiene;

  card.append(buildSettingsCardHeader(copy.eyebrow, copy.title));

  const hint = document.createElement("p");
  hint.className = "settings-card-hint";
  hint.textContent = copy.hint;
  card.append(hint);

  if (tagAliasSuggestions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "settings-card-note";
    empty.textContent = copy.empty;
    card.append(empty);
    return card;
  }

  const list = document.createElement("div");
  list.className = "tag-hygiene-list";

  for (const suggestion of tagAliasSuggestions) {
    list.append(
      buildHygieneSuggestion({
        suggestion,
        onMergeTagAlias,
        onDismissTagAlias,
      }),
    );
  }

  card.append(list);
  return card;
}

interface HygieneSuggestionOptions {
  suggestion: AliasSuggestion;
  onMergeTagAlias: (from: string, to: string) => void;
  onDismissTagAlias: (canonical: string, alias: string) => void;
}

function buildHygieneSuggestion({
  suggestion,
  onMergeTagAlias,
  onDismissTagAlias,
}: HygieneSuggestionOptions): HTMLElement {
  const row = document.createElement("article");
  row.className = "hygiene-card";
  row.dataset.canonical = suggestion.canonical;

  const hed = document.createElement("div");
  hed.className = "hygiene-hed";

  const canonical = buildTagPill({
    tag: suggestion.canonical,
    kind: "user",
    size: "lg",
  });
  canonical.classList.add("hygiene-canonical");
  hed.append(canonical);

  const arrow = document.createElement("span");
  arrow.className = "hygiene-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "←";
  hed.append(arrow);

  const count = document.createElement("span");
  count.className = "hygiene-candidate-count mono";
  count.textContent = formatPlural(
    getActiveLocale(),
    suggestion.aliases.length,
    messages().settings.tagHygiene.candidateCount,
  );
  hed.append(count);

  row.append(hed);

  const aliasList = document.createElement("div");
  aliasList.className = "hygiene-alias-list";
  for (const alias of suggestion.aliases) {
    aliasList.append(
      buildHygieneAliasRow({
        canonical: suggestion.canonical,
        alias,
        onMergeTagAlias,
        onDismissTagAlias,
      }),
    );
  }
  row.append(aliasList);

  const reason = document.createElement("p");
  reason.className = "hygiene-reason";
  reason.textContent = suggestion.reason;
  row.append(reason);

  return row;
}

interface HygieneAliasRowOptions {
  canonical: string;
  alias: string;
  onMergeTagAlias: (from: string, to: string) => void;
  onDismissTagAlias: (canonical: string, alias: string) => void;
}

function buildHygieneAliasRow({
  canonical,
  alias,
  onMergeTagAlias,
  onDismissTagAlias,
}: HygieneAliasRowOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "hygiene-alias-row";

  const pill = buildTagPill({ tag: alias, kind: "user", size: "lg" });
  row.append(pill);

  const actions = document.createElement("div");
  actions.className = "hygiene-alias-actions";

  const copy = messages().settings.tagHygiene;

  const mergeBtn = document.createElement("button");
  mergeBtn.type = "button";
  mergeBtn.className = "button button-primary hygiene-action";
  mergeBtn.textContent = copy.merge;
  mergeBtn.setAttribute("aria-label", copy.mergeLabel(alias, canonical));
  mergeBtn.addEventListener("click", () => onMergeTagAlias(alias, canonical));
  actions.append(mergeBtn);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "button hygiene-action";
  dismissBtn.textContent = copy.dismiss;
  dismissBtn.setAttribute("aria-label", copy.dismissLabel(canonical, alias));
  dismissBtn.addEventListener("click", () =>
    onDismissTagAlias(canonical, alias),
  );
  actions.append(dismissBtn);

  row.append(actions);
  return row;
}

interface BackupCardOptions {
  profile: UserProfile | null;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  rebuildStatus: RebuildStatus;
  onRebuildIndex: () => void;
  onSignIn: () => void;
}

/**
 * Backup card. Surfaces the manual Load/Save actions that used to live in
 * the top account bar, plus the Phase 2 notes-scaling "Rebuild index"
 * maintenance action. These are rarely needed in normal use — the workspace
 * syncs automatically for signed-in users — so the card leads with an
 * explanation of *when* you'd want to reach for these buttons instead of
 * assuming the reader knows.
 */
function buildBackupCard({
  profile,
  onLoadNotebook,
  onSaveNotebook,
  rebuildStatus,
  onRebuildIndex,
  onSignIn,
}: BackupCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card";

  const copy = messages().settings.backup;

  card.append(buildSettingsCardHeader(copy.eyebrow, copy.title));

  const intro = document.createElement("p");
  intro.className = "settings-card-hint";
  intro.textContent = copy.intro;
  card.append(intro);

  if (!profile) {
    const signedOutNote = document.createElement("p");
    signedOutNote.className = "settings-card-note";
    signedOutNote.textContent = copy.signedOut;
    card.append(signedOutNote);

    const signInButton = document.createElement("button");
    signInButton.type = "button";
    signInButton.className = "button button-primary settings-backup-signin";
    signInButton.textContent = copy.signIn;
    signInButton.addEventListener("click", onSignIn);
    card.append(signInButton);

    return card;
  }

  const list = document.createElement("div");
  list.className = "settings-backup-actions";

  list.append(
    buildBackupAction({
      title: copy.load.title,
      description: copy.load.description,
      buttonLabel: copy.load.button,
      buttonClass: "button",
      onClick: onLoadNotebook,
    }),
  );

  list.append(
    buildBackupAction({
      title: copy.save.title,
      description: copy.save.description,
      buttonLabel: copy.save.button,
      buttonClass: "button button-primary",
      onClick: onSaveNotebook,
    }),
  );

  list.append(
    buildBackupAction({
      title: copy.rebuild.title,
      description: copy.rebuild.description,
      buttonLabel: copy.rebuild.button,
      buttonClass: "button",
      onClick: onRebuildIndex,
      disabled: rebuildStatus.state === "running",
      statusText: describeRebuildStatus(rebuildStatus) ?? undefined,
    }),
  );

  card.append(list);
  return card;
}

interface BackupActionOptions {
  title: string;
  description: string;
  buttonLabel: string;
  buttonClass: string;
  onClick: () => void;
  /** Disables the button — used while a rebuild is already running. */
  disabled?: boolean;
  /**
   * Optional status line appended below the description, e.g. the
   * rebuild's running / done / error text. Omitted entirely (rather than
   * an empty node) when there's nothing to show.
   */
  statusText?: string;
}

function buildBackupAction({
  title,
  description,
  buttonLabel,
  buttonClass,
  onClick,
  disabled = false,
  statusText,
}: BackupActionOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-backup-action";

  const text = document.createElement("div");
  text.className = "settings-backup-action-text";

  const heading = document.createElement("h3");
  heading.className = "settings-backup-action-title";
  heading.textContent = title;

  const desc = document.createElement("p");
  desc.className = "settings-backup-action-description";
  desc.textContent = description;

  text.append(heading, desc);

  if (statusText) {
    const status = document.createElement("p");
    status.className = "settings-backup-action-status";
    status.textContent = statusText;
    text.append(status);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = `${buttonClass} settings-backup-action-button`;
  button.textContent = buttonLabel;
  button.disabled = disabled;
  button.addEventListener("click", onClick);

  row.append(text, button);
  return row;
}
