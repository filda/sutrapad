import { deriveNotebookPersona } from "../../../lib/notebook-persona";
import { documentFromSummary } from "../../../lib/note-card-meta";
import {
  formatHomeHeaderDate,
  formatNoteTime,
  greetingFor,
  groupNotesByRecency,
  type HomeGreeting,
} from "../../logic/home-groups";
import type {
  SutraPadLinkIndex,
  SutraPadNoteSummary,
  SutraPadTaskIndex,
  UserProfile,
} from "../../../types";
import { buildPageHeader } from "../shared/page-header";
import type { PageTitle } from "../shared/page-title";
import {
  applyPersonaStyles,
  appendPersonaStickers,
} from "../shared/persona-decor";
import type { NotesListPersonaOptions } from "../shared/notes-list";
import { buildTagPill } from "../shared/tag-pill";

interface HomeStatsSummary {
  notes: number;
  openTasks: number;
  tags: number;
  links: number;
}

/**
 * Builds the today-stats + subtitle numbers from the resident summary /
 * task / link models (Phase 2 notes-scaling) instead of scanning
 * `workspace.notes` bodies — a placeholder note (not yet opened this
 * session) has no body, so a body-scan would undercount open tasks and
 * miss task-derived auto-tags. `noteSummaries[].tags` / `.autoTags` and
 * `taskIndex` / `linkIndex` are all precomputed at save time (or read
 * straight from the Drive index) and stay correct regardless of hydration.
 */
function summariseNotebook(
  noteSummaries: readonly SutraPadNoteSummary[],
  taskIndex: SutraPadTaskIndex,
  linkIndex: SutraPadLinkIndex,
): HomeStatsSummary {
  const distinctTags = new Set<string>();
  for (const summary of noteSummaries) {
    for (const tag of summary.tags ?? []) distinctTags.add(tag);
    for (const tag of summary.autoTags ?? []) distinctTags.add(tag);
  }

  let openTasks = 0;
  for (const task of taskIndex.tasks) {
    if (!task.done) openTasks += 1;
  }

  return {
    notes: noteSummaries.length,
    openTasks,
    tags: distinctTags.size,
    links: linkIndex.links.length,
  };
}

function buildTodayStats(summary: HomeStatsSummary): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "today-stats";

  const stats: ReadonlyArray<{ label: string; value: number; accent?: boolean }> = [
    { label: "Notes", value: summary.notes },
    { label: "Open tasks", value: summary.openTasks, accent: true },
    { label: "Tags", value: summary.tags },
    { label: "Links", value: summary.links },
  ];

  for (const entry of stats) {
    const stat = document.createElement("div");
    stat.className = `stat${entry.accent ? " is-accent" : ""}`;

    const value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = String(entry.value);

    const label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = entry.label;

    stat.append(value, label);
    strip.append(stat);
  }

  return strip;
}

function buildTimelineItem(
  summary: SutraPadNoteSummary,
  hasOpenTask: boolean,
  onOpenNote: (noteId: string) => void,
  personaOptions: NotesListPersonaOptions | undefined,
): HTMLElement {
  const item = document.createElement("article");
  item.className = "tl-item";

  const time = document.createElement("p");
  time.className = "tl-time";
  time.textContent = formatNoteTime(summary.updatedAt);
  item.append(time);

  const card = document.createElement("button");
  card.type = "button";
  card.className = "tl-card";
  card.addEventListener("click", () => onOpenNote(summary.id));

  // Persona decoration is opt-in: when the user has "Persona" enabled we
  // derive the same paper/rotation/font identity the notes list uses, but
  // tune it down for a stacked timeline — halved rotation so cards don't
  // clash with the left rule, and at most one sticker so the column stays
  // calm per the handoff's "keep it calm" note on Today. `hasOpenTask` /
  // `autoTags` come precomputed from the summary (Phase 2) so this never
  // needs the note's body — mirrors how the Notes list feeds the same
  // derivation.
  const persona = personaOptions
    ? deriveNotebookPersona(documentFromSummary(summary), {
        allNotes: personaOptions.allNotes,
        dark: personaOptions.dark,
        hasOpenTask,
        autoTags: summary.autoTags,
      })
    : null;
  if (persona) {
    card.classList.add("has-persona");
    applyPersonaStyles(card, persona, { rotationFactor: 0.5 });
  }

  const title = document.createElement("h4");
  title.className = "tl-title";
  title.textContent = summary.title.trim() || "Untitled note";
  card.append(title);

  // `excerpt` is precomputed at save time (Phase 2 card metadata, 72-char
  // budget — same source and length the Notes grid card uses) rather than
  // trimmed here from the body, which a not-yet-hydrated placeholder
  // doesn't have.
  const excerpt = summary.excerpt ?? "";
  if (excerpt) {
    const p = document.createElement("p");
    p.className = "tl-excerpt";
    p.textContent = excerpt;
    card.append(p);
  }

  const tags = summary.tags ?? [];
  if (tags.length > 0) {
    const tagsRow = document.createElement("div");
    tagsRow.className = "tl-tags";
    // Limit to six chips so a note with a lot of auto-tags doesn't wrap the
    // card into a tall strip; the overflow indicator mirrors the handoff.
    // `summary.tags` only ever contains user-authored tags (auto-tags are
    // derived separately and aren't persisted on the note), so every pill
    // here lands in the `topic` class.
    const shown = tags.slice(0, 6);
    for (const tag of shown) {
      tagsRow.append(buildTagPill({ tag, kind: "user" }));
    }
    if (tags.length > shown.length) {
      const more = document.createElement("span");
      more.className = "tl-tag-more";
      more.textContent = `+${tags.length - shown.length}`;
      tagsRow.append(more);
    }
    card.append(tagsRow);
  }

  // Stickers go last so they read as a subtle tag-like accent under the card
  // content rather than competing with the title for the top edge. The chip
  // reuses the shared `.note-list-sticker` class so every `[data-sticker]`
  // colour rule works here too — only the row wrapper gets a timeline-specific
  // class so we can tune margin/placement without forking the chip visuals.
  if (persona) {
    appendPersonaStickers(card, persona, {
      rowClassName: "tl-stickers",
      chipClassName: "note-list-sticker",
      limit: 1,
    });
  }

  item.append(card);
  return item;
}

function buildTimelineSection(
  label: string,
  summaries: readonly SutraPadNoteSummary[],
  hasOpenTaskById: ReadonlySet<string>,
  onOpenNote: (noteId: string) => void,
  personaOptions: NotesListPersonaOptions | undefined,
): HTMLElement | null {
  if (summaries.length === 0) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "tl-section";

  const divider = document.createElement("p");
  divider.className = "tl-divider";
  divider.textContent = label;
  wrapper.append(divider);

  for (const summary of summaries) {
    wrapper.append(
      buildTimelineItem(
        summary,
        hasOpenTaskById.has(summary.id),
        onOpenNote,
        personaOptions,
      ),
    );
  }

  return wrapper;
}

function buildTimeline(
  noteSummaries: readonly SutraPadNoteSummary[],
  taskIndex: SutraPadTaskIndex,
  onOpenNote: (noteId: string) => void,
  personaOptions: NotesListPersonaOptions | undefined,
): HTMLElement | null {
  const groups = groupNotesByRecency(noteSummaries, new Date());
  // If every bucket is empty we skip the timeline entirely so the empty
  // page doesn't render a lonely left-rule with nothing attached.
  if (
    groups.today.length === 0 &&
    groups.yesterday.length === 0 &&
    groups.earlier.length === 0
  ) {
    return null;
  }

  const timeline = document.createElement("div");
  timeline.className = "timeline";
  if (personaOptions) timeline.classList.add("timeline--persona");

  // Precompute once per render rather than filtering `taskIndex.tasks` per
  // note — the persona derivation only needs a yes/no per note id.
  const hasOpenTaskById = new Set<string>();
  for (const task of taskIndex.tasks) {
    if (!task.done) hasOpenTaskById.add(task.noteId);
  }

  const sections: Array<[string, readonly SutraPadNoteSummary[]]> = [
    ["Today", groups.today],
    ["Yesterday", groups.yesterday],
    ["Earlier", groups.earlier],
  ];

  for (const [label, summaries] of sections) {
    const section = buildTimelineSection(
      label,
      summaries,
      hasOpenTaskById,
      onOpenNote,
      personaOptions,
    );
    if (section) timeline.append(section);
  }

  return timeline;
}

const GREETING_LABEL: Record<HomeGreeting, string> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
};

function firstName(profile: UserProfile | null): string | null {
  if (!profile?.name) return null;
  const trimmed = profile.name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/u)[0];
}

function buildHomeHeader(
  profile: UserProfile | null,
  summary: HomeStatsSummary,
): HTMLElement {
  const now = new Date();
  const greeting = GREETING_LABEL[greetingFor(now.getHours())];
  const name = firstName(profile);
  // `after` carries the profile name as a plain text node — no escaping
  // needed because `buildPageHeader` renders title parts via `textContent`,
  // never `innerHTML`.
  const title: PageTitle = {
    before: "Good ",
    emphasis: greeting,
    after: name ? `, ${name}.` : ".",
  };

  // Subtitle quietly carries the same numbers as the stats strip below, so
  // the greeting feels specific even before the eye scans the grid.
  const subtitle = summaryPhrase(summary);

  // No header action — the "new note" CTA lives in the app FAB so it
  // survives a collapsed intro and stays consistent with mobile.
  return buildPageHeader({
    pageId: "home",
    eyebrow: formatHomeHeaderDate(now),
    title,
    subtitle,
    // Greeting + counts change daily — the lockup carries live information,
    // not onboarding chrome, so it shouldn't quietly fade out after ten
    // visits like the static page intros do. The eyebrow toggle still
    // works for users who'd rather see only the date strip.
    noAutoFade: true,
  });
}

function summaryPhrase(summary: HomeStatsSummary): string {
  if (summary.notes === 0) {
    return "A fresh notebook. Start a note or drop a link in — everything you write lives here.";
  }
  const notesPart = `${summary.notes} note${summary.notes === 1 ? "" : "s"}`;
  const tasksPart =
    summary.openTasks > 0
      ? `${summary.openTasks} open thread${summary.openTasks === 1 ? "" : "s"}`
      : "no open threads";
  return `${notesPart}, ${tasksPart}. Pick up where you left off.`;
}

export interface HomePageOptions {
  /**
   * Resident per-note card metadata (Phase 2 notes-scaling) — read instead
   * of `workspace.notes` bodies so Home stays correct for placeholder notes
   * that haven't been hydrated this session yet.
   */
  noteSummaries: readonly SutraPadNoteSummary[];
  taskIndex: SutraPadTaskIndex;
  linkIndex: SutraPadLinkIndex;
  profile: UserProfile | null;
  /**
   * When provided, Home timeline cards pick up the same paper palette and
   * rotation as the notes list so the two surfaces feel like the same
   * notebook. Omit to render the plain surface-subtle card. The home
   * timeline dials rotation down (0.5×) and shows at most one sticker so a
   * stacked column stays readable.
   */
  personaOptions?: NotesListPersonaOptions;
  /**
   * Optional rotating hint banner mounted between the today-stats strip
   * and the timeline. Composed by the render-app caller via
   * `composeHintBanner` so the home page stays unaware of which hint
   * fired or how the rotation persists. When `null`, no slot is rendered.
   */
  hintBanner?: HTMLElement | null;
  onOpenNote: (noteId: string) => void;
}

export function buildHomePage({
  noteSummaries,
  taskIndex,
  linkIndex,
  profile,
  personaOptions,
  hintBanner,
  onOpenNote,
}: HomePageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "home-page";

  const summary = summariseNotebook(noteSummaries, taskIndex, linkIndex);

  section.append(buildHomeHeader(profile, summary));

  section.append(buildTodayStats(summary));

  // Hint slot sits between the stats strip and the timeline so it reads
  // as "here's something to think about" before the user scans down into
  // their notebook. Omitted entirely when the composer returned null —
  // an empty placeholder would be visual noise on a clean home.
  if (hintBanner) section.append(hintBanner);

  const timeline = buildTimeline(noteSummaries, taskIndex, onOpenNote, personaOptions);
  if (timeline) section.append(timeline);

  return section;
}
