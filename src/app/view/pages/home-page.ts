import { buildBookmarklet } from "../../../lib/bookmarklet";
import {
  buildCombinedTagIndex,
  buildLinkIndex,
} from "../../../lib/notebook";
import { countTasksInNote } from "../../../lib/tasks";
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
import { buildPageHeader } from "../shared/page-header";

interface BookmarkletCardOptions {
  appRootUrl: string;
  bookmarkletHelperExpanded: boolean;
  bookmarkletMessage: string;
  iosShortcutUrl: string;
  onToggleBookmarkletHelper: () => void;
  onCopyBookmarklet: () => void;
}

function buildBookmarkletCard({
  appRootUrl,
  bookmarkletHelperExpanded,
  bookmarkletMessage,
  iosShortcutUrl,
  onToggleBookmarkletHelper,
  onCopyBookmarklet,
}: BookmarkletCardOptions): HTMLElement {
  const bookmarkletSection = document.createElement("section");
  bookmarkletSection.className = "bookmarklet-card";

  const bookmarkletHeader = document.createElement("div");
  bookmarkletHeader.className = "bookmarklet-header";
  bookmarkletHeader.innerHTML = `
    <div>
      <p class="panel-eyebrow">Capture</p>
      <h2>Bookmark any page into SutraPad.</h2>
      <p>Drag the bookmarklet to your bookmarks bar. It sends the current page URL and title into a fresh note.</p>
    </div>
  `;

  const toggleBookmarkletHelper = document.createElement("button");
  toggleBookmarkletHelper.className = "button button-ghost bookmarklet-toggle";
  toggleBookmarkletHelper.type = "button";
  toggleBookmarkletHelper.textContent = bookmarkletHelperExpanded ? "Hide helper" : "Show helper";
  toggleBookmarkletHelper.addEventListener("click", onToggleBookmarkletHelper);
  bookmarkletHeader.append(toggleBookmarkletHelper);
  bookmarkletSection.append(bookmarkletHeader);

  const bookmarkletActions = document.createElement("div");
  bookmarkletActions.className = "bookmarklet-actions";

  const bookmarkletLink = document.createElement("a");
  bookmarkletLink.className = "button button-primary bookmarklet-link";
  bookmarkletLink.href = buildBookmarklet(appRootUrl);
  bookmarkletLink.textContent = "Save to SutraPad";
  bookmarkletLink.setAttribute("draggable", "true");

  const copyBookmarkletButton = document.createElement("button");
  copyBookmarkletButton.className = "button button-ghost";
  copyBookmarkletButton.textContent = "Copy bookmarklet code";
  copyBookmarkletButton.addEventListener("click", onCopyBookmarklet);

  const bookmarkletHint = document.createElement("p");
  bookmarkletHint.className = "bookmarklet-hint";
  bookmarkletHint.innerHTML =
    "We cannot detect whether a browser already has this bookmarklet saved. Browsers do not expose bookmark contents to normal web pages, so this helper stays manual by design. Desktop Safari usually works best if you create a normal bookmark first and then replace its URL with the copied bookmarklet code.";

  const iosShortcutHint = document.createElement("p");
  iosShortcutHint.className = "bookmarklet-hint";
  iosShortcutHint.innerHTML =
    `On iPhone and iPad, a Shortcut is usually the easiest option. <a href="${iosShortcutUrl}" download>Download the iOS Shortcut</a>, open it in Safari, add it to Shortcuts, and enable it in the Share Sheet.`;

  const bookmarkletSteps = document.createElement("ol");
  bookmarkletSteps.className = "bookmarklet-steps";
  bookmarkletSteps.innerHTML = `
    <li>Drag <strong>Save to SutraPad</strong> to your bookmarks bar in Chrome, Brave, or Opera.</li>
    <li>In Safari, create a regular bookmark, choose <strong>Edit Address</strong>, and paste the copied bookmarklet code.</li>
    <li>While browsing any page, click the bookmarklet to open SutraPad with a new captured note.</li>
    <li>On iOS, download the Shortcut file, add it in Apple Shortcuts, and use it from the Share menu as <strong>Send to SutraPad</strong>.</li>
  `;

  bookmarkletActions.append(bookmarkletLink, copyBookmarkletButton);

  if (bookmarkletMessage) {
    const bookmarkletStatus = document.createElement("p");
    bookmarkletStatus.className = "bookmarklet-status";
    bookmarkletStatus.textContent = bookmarkletMessage;
    bookmarkletActions.append(bookmarkletStatus);
  }

  if (bookmarkletHelperExpanded) {
    bookmarkletActions.append(bookmarkletHint, iosShortcutHint, bookmarkletSteps);
    bookmarkletSection.append(bookmarkletActions);
  }

  return bookmarkletSection;
}

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
    const shown = note.tags.slice(0, 6);
    for (const tag of shown) {
      const chip = document.createElement("span");
      chip.className = "tl-tag-chip";
      chip.textContent = tag;
      tags.append(chip);
    }
    if (note.tags.length > shown.length) {
      const more = document.createElement("span");
      more.className = "tl-tag-more";
      more.textContent = `+${note.tags.length - shown.length}`;
      tags.append(more);
    }
    card.append(tags);
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
): HTMLElement | null {
  if (notes.length === 0) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "tl-section";

  const divider = document.createElement("p");
  divider.className = "tl-divider";
  divider.textContent = label;
  wrapper.append(divider);

  for (const note of notes) {
    wrapper.append(buildTimelineItem(note, onOpenNote));
  }

  return wrapper;
}

function buildTimeline(
  workspace: SutraPadWorkspace,
  onOpenNote: (noteId: string) => void,
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

  const sections: Array<[string, readonly SutraPadDocument[]]> = [
    ["Today", groups.today],
    ["Yesterday", groups.yesterday],
    ["Earlier", groups.earlier],
  ];

  for (const [label, notes] of sections) {
    const section = buildTimelineSection(label, notes, onOpenNote);
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

  const newNoteButton = document.createElement("button");
  newNoteButton.type = "button";
  newNoteButton.className = "button button-accent";
  newNoteButton.textContent = "+ New note";
  newNoteButton.addEventListener("click", onNewNote);

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
  appRootUrl: string;
  bookmarkletHelperExpanded: boolean;
  bookmarkletMessage: string;
  iosShortcutUrl: string;
  onToggleBookmarkletHelper: () => void;
  onCopyBookmarklet: () => void;
  onNewNote: () => void;
  onOpenNote: (noteId: string) => void;
}

export function buildHomePage({
  workspace,
  profile,
  appRootUrl,
  bookmarkletHelperExpanded,
  bookmarkletMessage,
  iosShortcutUrl,
  onToggleBookmarkletHelper,
  onCopyBookmarklet,
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

  const timeline = buildTimeline(workspace, onOpenNote);
  if (timeline) section.append(timeline);

  section.append(
    buildBookmarkletCard({
      appRootUrl,
      bookmarkletHelperExpanded,
      bookmarkletMessage,
      iosShortcutUrl,
      onToggleBookmarkletHelper,
      onCopyBookmarklet,
    }),
  );

  return section;
}
