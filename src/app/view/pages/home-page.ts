import {
  buildCombinedTagIndex,
  buildLinkIndex,
} from "../../../lib/notebook";
import { countTasksInNote } from "../../../lib/tasks";
import { deriveNotebookPersona } from "../../../lib/notebook-persona";
import {
  formatHomeHeaderDate,
  formatNoteTime,
  greetingFor,
  groupNotesByRecency,
  type HomeGreeting,
} from "../../logic/home-groups";
import type {
  SutraPadDocument,
  SutraPadWorkspace,
  UserProfile,
} from "../../../types";
import { buildNewNoteButton } from "../shared/new-note-button";
import { buildPageHeader } from "../shared/page-header";
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

function summariseWorkspace(workspace: SutraPadWorkspace): HomeStatsSummary {
  let openTasks = 0;
  for (const note of workspace.notes) openTasks += countTasksInNote(note).open;
  return {
    notes: workspace.notes.length,
    openTasks,
    tags: buildCombinedTagIndex(workspace).tags.length,
    links: buildLinkIndex(workspace).links.length,
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
  note: SutraPadDocument,
  onOpenNote: (noteId: string) => void,
  personaOptions: NotesListPersonaOptions | undefined,
): HTMLElement {
  const item = document.createElement("article");
  item.className = "tl-item";

  const time = document.createElement("p");
  time.className = "tl-time";
  time.textContent = formatNoteTime(note.updatedAt);
  item.append(time);

  const card = document.createElement("button");
  card.type = "button";
  card.className = "tl-card";
  card.addEventListener("click", () => onOpenNote(note.id));

  // Persona decoration is opt-in: when the user has "Persona" enabled we
  // derive the same paper/rotation/font identity the notes list uses, but
  // tune it down for a stacked timeline — halved rotation so cards don't
  // clash with the left rule, and at most one sticker so the column stays
  // calm per the handoff's "keep it calm" note on Today.
  const persona = personaOptions
    ? deriveNotebookPersona(note, {
        allNotes: personaOptions.allNotes,
        dark: personaOptions.dark,
      })
    : null;
  if (persona) {
    card.classList.add("has-persona");
    applyPersonaStyles(card, persona, { rotationFactor: 0.5 });
  }

  const title = document.createElement("h4");
  title.className = "tl-title";
  title.textContent = note.title.trim() || "Untitled note";
  card.append(title);

  const excerpt = buildExcerpt(note.body);
  if (excerpt) {
    const p = document.createElement("p");
    p.className = "tl-excerpt";
    p.textContent = excerpt;
    card.append(p);
  }

  if (note.tags.length > 0) {
    const tags = document.createElement("div");
    tags.className = "tl-tags";
    // Limit to six chips so a note with a lot of auto-tags doesn't wrap the
    // card into a tall strip; the overflow indicator mirrors the handoff.
    // `note.tags` only ever contains user-authored tags (auto-tags are
    // derived at query time and aren't persisted on the note), so every
    // pill here lands in the `topic` class.
    const shown = note.tags.slice(0, 6);
    for (const tag of shown) {
      tags.append(buildTagPill({ tag, kind: "user" }));
    }
    if (note.tags.length > shown.length) {
      const more = document.createElement("span");
      more.className = "tl-tag-more";
      more.textContent = `+${note.tags.length - shown.length}`;
      tags.append(more);
    }
    card.append(tags);
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

function buildExcerpt(body: string): string {
  // Same trimming rule as the handoff timeline: collapse whitespace into
  // single spaces and cap at roughly two lines of reading before adding an
  // ellipsis. Keeps the card's vertical rhythm consistent across notes.
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const limit = 180;
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit).trimEnd()}…`;
}

function buildTimelineSection(
  label: string,
  notes: readonly SutraPadDocument[],
  onOpenNote: (noteId: string) => void,
  personaOptions: NotesListPersonaOptions | undefined,
): HTMLElement | null {
  if (notes.length === 0) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "tl-section";

  const divider = document.createElement("p");
  divider.className = "tl-divider";
  divider.textContent = label;
  wrapper.append(divider);

  for (const note of notes) {
    wrapper.append(buildTimelineItem(note, onOpenNote, personaOptions));
  }

  return wrapper;
}

function buildTimeline(
  workspace: SutraPadWorkspace,
  onOpenNote: (noteId: string) => void,
  personaOptions: NotesListPersonaOptions | undefined,
): HTMLElement | null {
  const groups = groupNotesByRecency(workspace.notes, new Date());
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

  const sections: Array<[string, readonly SutraPadDocument[]]> = [
    ["Today", groups.today],
    ["Yesterday", groups.yesterday],
    ["Earlier", groups.earlier],
  ];

  for (const [label, notes] of sections) {
    const section = buildTimelineSection(label, notes, onOpenNote, personaOptions);
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
  return trimmed.split(/\s+/)[0];
}

function buildHomeHeader(
  profile: UserProfile | null,
  summary: HomeStatsSummary,
  onNewNote: () => void,
): HTMLElement {
  const now = new Date();
  const greeting = GREETING_LABEL[greetingFor(now.getHours())];
  const name = firstName(profile);
  const titleHtml = name
    ? `Good <em>${greeting}</em>, ${escapeHtml(name)}.`
    : `Good <em>${greeting}</em>.`;

  // Subtitle quietly carries the same numbers as the stats strip below, so
  // the greeting feels specific even before the eye scans the grid.
  const subtitle = summaryPhrase(summary);

  const newNoteButton = buildNewNoteButton(onNewNote);

  return buildPageHeader({
    eyebrow: formatHomeHeaderDate(now),
    titleHtml,
    subtitle,
    actions: newNoteButton,
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

function escapeHtml(value: string): string {
  // Narrow escape — only the handful of characters that would break out of
  // the <em>…</em> / text nodes used in the title lockup. Keeps the innerHTML
  // call safe for whatever the profile provider returns as the user's name.
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface HomePageOptions {
  workspace: SutraPadWorkspace;
  profile: UserProfile | null;
  /**
   * When provided, Home timeline cards pick up the same paper palette and
   * rotation as the notes list so the two surfaces feel like the same
   * notebook. Omit to render the plain surface-subtle card. The home
   * timeline dials rotation down (0.5×) and shows at most one sticker so a
   * stacked column stays readable.
   */
  personaOptions?: NotesListPersonaOptions;
  onNewNote: () => void;
  onOpenNote: (noteId: string) => void;
}

export function buildHomePage({
  workspace,
  profile,
  personaOptions,
  onNewNote,
  onOpenNote,
}: HomePageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "home-page";

  const summary = summariseWorkspace(workspace);

  section.append(buildHomeHeader(profile, summary, onNewNote));

  const heroCard = document.createElement("div");
  heroCard.className = "hero-card";
  const info = document.createElement("p");
  info.textContent = profile
    ? "You can write immediately in a local notebook. Your notes sync to Google Drive when you're online."
    : "You can write immediately in a local notebook. Sign in only when you want to sync with Google Drive.";
  heroCard.append(info);
  section.append(heroCard);

  section.append(buildTodayStats(summary));

  const timeline = buildTimeline(workspace, onOpenNote, personaOptions);
  if (timeline) section.append(timeline);

  return section;
}
