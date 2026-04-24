import { buildLinkIndex } from "../../../lib/notebook";
import { formatDate } from "../../logic/formatting";
import {
  buildLinkCardDescription,
  deriveLinkHostname,
  hashStringToHue,
} from "../../logic/link-card";
import type { LinksViewMode } from "../../logic/links-view";
import {
  buildFaviconUrl,
  resolveOgImageForUrl,
  type CachedOgImageEntry,
} from "../../logic/og-image";
import { buildIcon, type IconName } from "../shared/icons";
import {
  loadOgImageCache,
  persistOgImageCache,
  setOgImageCacheEntry,
  type OgImageCache,
} from "../../logic/og-image-cache";
import type { SutraPadDocument, SutraPadWorkspace } from "../../../types";
import { EMPTY_COPY, buildEmptyScene } from "../shared/empty-state";
import { buildPageHeader } from "../shared/page-header";

export interface LinksPageOptions {
  workspace: SutraPadWorkspace;
  /**
   * Current layout preference (cards = handoff default, list = dense
   * opt-in). Threaded from `app.ts` so a full re-render preserves it.
   */
  linksViewMode: LinksViewMode;
  onOpenNote: (noteId: string) => void;
  /**
   * Routes to the Capture page. Wired here because the first-run empty
   * state pitches the bookmarklet as the fastest way to accumulate links,
   * and the bookmarklet instructions live on Capture.
   */
  onOpenCapture: () => void;
  onChangeLinksView: (mode: LinksViewMode) => void;
}

/**
 * Order is `[Cards, List]` everywhere — matches the default-first rule
 * in `docs/conventions.md` → "Cross-page consistency". Icon names map
 * to handoff v2 (`screen_notes.jsx`): "cards" → `menu`, "list" →
 * `list`. The Notes page uses the same mapping; if it ever drifts,
 * fix here AND there.
 */
const VIEW_TOGGLE_OPTIONS: ReadonlyArray<{
  mode: LinksViewMode;
  label: string;
  icon: IconName;
}> = [
  { mode: "cards", label: "Cards", icon: "menu" },
  { mode: "list", label: "List", icon: "list" },
];

export function buildLinksPage({
  workspace,
  linksViewMode,
  onOpenNote,
  onOpenCapture,
  onChangeLinksView,
}: LinksPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "links-page";

  const linkIndex = buildLinkIndex(workspace);
  const linkCount = linkIndex.links.length;

  section.append(
    buildPageHeader({
      eyebrow: `Links · ${linkCount}`,
      titleHtml: "A <em>library</em> of what caught your eye.",
      subtitle:
        "Every URL you've captured into a note, gathered here with the notebooks they first appeared in.",
    }),
  );

  if (linkCount === 0) {
    // First-run full-bleed scene. CTA routes to the Capture page since
    // the handoff copy explicitly pitches the bookmarklet as the way to
    // start saving links.
    section.append(
      buildEmptyScene({
        ...EMPTY_COPY.links,
        onCta: onOpenCapture,
      }),
    );
    return section;
  }

  section.append(buildLinksToolbar(linksViewMode, onChangeLinksView));

  const notesById = new Map(workspace.notes.map((note) => [note.id, note]));

  if (linksViewMode === "cards") {
    // Async og:image resolver scoped to this render cycle. The cache
    // lives in localStorage across sessions, so in the steady state
    // every card is populated from the cache on mount and the grid
    // paints without flashing. Fresh workspaces still show the
    // gradient for a beat while the first batch of proxy fetches
    // lands.
    const resolver = createOgImageResolver();
    section.append(
      buildLinksGrid(linkIndex.links, notesById, onOpenNote, resolver),
    );
  } else {
    section.append(buildLinksList(linkIndex.links, notesById, onOpenNote));
  }

  return section;
}

/**
 * One resolver per render. Owns the in-memory view of the og:image
 * cache, persists the full cache back to localStorage after every
 * hit/miss that actually wrote (so subsequent renders short-circuit
 * on the warm cache), and hands cards a `resolve(url, notes)` method
 * that walks the priority chain from `og-image.ts`.
 *
 * Kept internal to this module — nothing outside the Links page
 * needs to orchestrate og:image lookups today.
 */
interface OgImageResolver {
  resolve: (url: string, notes: readonly SutraPadDocument[]) => Promise<string | null>;
}

function createOgImageResolver(): OgImageResolver {
  let cache: OgImageCache = loadOgImageCache();

  return {
    resolve: async (url, notes) => {
      const result = await resolveOgImageForUrl({
        url,
        notes,
        getCachedEntry: (key) => cache[key] ?? null,
        putCachedEntry: (key, entry) => {
          const next = setOgImageCacheEntry(cache, key, entry);
          // Only persist when something actually changed. `setOgImageCacheEntry`
          // returns a new reference on every call, but the resolver only
          // calls us after a runtime fetch, so any call here is a real
          // write worth committing.
          cache = next;
          persistOgImageCache(cache);
        },
      });
      return result;
    },
  };
}
// Re-export the cache entry type so tests/external callers (if any) can
// reason about resolver shape without reaching into the helper module.
export type { CachedOgImageEntry };

/**
 * Strip above the grid/list: a muted hint on the left (what this page
 * is, how to narrow it down) and the cards/list view-toggle on the
 * right. Matches the structure of the Notes toolbar so a user who's
 * learned the pattern on Notes doesn't relearn it here.
 */
function buildLinksToolbar(
  linksViewMode: LinksViewMode,
  onChangeLinksView: (mode: LinksViewMode) => void,
): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "links-toolbar";

  const hint = document.createElement("p");
  hint.className = "links-toolbar-hint muted";
  hint.textContent = "Sorted by most recent. Filter by tag from the bar above.";
  toolbar.append(hint);

  toolbar.append(buildViewToggle(linksViewMode, onChangeLinksView));
  return toolbar;
}

/**
 * `[Cards | List]` pill group. Parallels the one in `notes-page.ts` —
 * they're deliberately two separate implementations because each page
 * is typed on its own view-mode union; a shared helper would need a
 * generic `V extends string` signature that reads worse than the
 * ~20 lines of duplication.
 */
function buildViewToggle(
  active: LinksViewMode,
  onChange: (mode: LinksViewMode) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "view-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Links view");

  for (const option of VIEW_TOGGLE_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `view-toggle-button${option.mode === active ? " is-active" : ""}`;
    button.title = option.label;
    button.setAttribute("aria-label", option.label);
    button.setAttribute("aria-pressed", option.mode === active ? "true" : "false");
    button.append(buildIcon(option.icon, 14));
    button.addEventListener("click", () => {
      if (option.mode !== active) onChange(option.mode);
    });
    group.append(button);
  }

  return group;
}

interface LinkEntry {
  readonly url: string;
  readonly noteIds: readonly string[];
  readonly count: number;
  readonly latestUpdatedAt: string;
}

/**
 * Grid of preview cards. Ports the handoff's `.links-grid` + `.link-card`
 * shape (gradient thumb with the hostname stamped on it, a title/desc
 * body, and a meta row with the save date + "attached to note" chip).
 *
 * Title derives from the most recent source note's title so the card
 * reads "why you saved it" — much more useful than the raw URL.
 * Description is the first line of that note's body with the URL
 * itself stripped out (see `buildLinkCardDescription`), or the
 * URL itself if the body is empty/unrecoverable.
 */
function buildLinksGrid(
  links: readonly LinkEntry[],
  notesById: ReadonlyMap<string, SutraPadDocument>,
  onOpenNote: (noteId: string) => void,
  resolver: OgImageResolver,
): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "links-grid";

  for (const entry of links) {
    grid.append(buildLinkCard(entry, notesById, onOpenNote, resolver));
  }

  return grid;
}

function buildLinkCard(
  entry: LinkEntry,
  notesById: ReadonlyMap<string, SutraPadDocument>,
  onOpenNote: (noteId: string) => void,
  resolver: OgImageResolver,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "link-card";

  // First note id in `entry.noteIds` is the most recently updated one
  // (buildLinkIndex sorts notes by recency before walking URLs), so
  // using it for the card preview matches "show me the most recent
  // context I saved this link in".
  const primaryNoteId = entry.noteIds[0];
  const primaryNote = primaryNoteId ? notesById.get(primaryNoteId) ?? null : null;

  // Walk every note containing this URL (not just the primary) so
  // capture-time og:image lookup can pick up a scrape from any past
  // capture of the same link — a user might have captured nytimes.com
  // three times with a bookmarklet, one of which had og:image.
  const notesForUrl: SutraPadDocument[] = [];
  for (const noteId of entry.noteIds) {
    const note = notesById.get(noteId);
    if (note) notesForUrl.push(note);
  }

  card.append(buildLinkThumb(entry.url, notesForUrl, resolver));
  card.append(buildLinkBody(entry, primaryNote, onOpenNote));

  return card;
}

/**
 * Renders the thumbnail as a gradient placeholder and kicks off an
 * async og:image resolution. When the resolver returns a URL, we swap
 * the gradient for an `<img>` cover. When it returns null (no og:image
 * exists, proxy fetch failed, etc.), the gradient stays — same pleasant
 * fallback the user had before og:image support shipped.
 *
 * The hostname chip sits over both states so a user glancing at a
 * gradient mid-resolution still sees the domain label.
 */
function buildLinkThumb(
  url: string,
  notesForUrl: readonly SutraPadDocument[],
  resolver: OgImageResolver,
): HTMLElement {
  const thumb = document.createElement("div");
  thumb.className = "link-thumb";

  const hostname = deriveLinkHostname(url);
  // Fallback to the raw URL for hashing when parse failed — gives us
  // *some* stable hue rather than all-same-red on every malformed entry.
  const hue = hashStringToHue(hostname ?? url);
  // Two-colour diagonal gradient + a subtle diagonal stripe overlay.
  // Ported from handoff screen_rest.jsx's inline style for `.link-thumb`.
  // Kept as inline style (rather than CSS variable handoff) because the
  // hue is per-card, not per-theme — setting it in CSS would need one
  // custom property per card to plumb through.
  thumb.style.background = `linear-gradient(135deg, hsl(${hue} 42% 52%), hsl(${(hue + 40) % 360} 60% 38%)), repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0 6px, transparent 6px 12px)`;

  const domainLabel = document.createElement("span");
  domainLabel.className = "link-thumb-domain";
  domainLabel.textContent = hostname ?? "link";
  thumb.append(domainLabel);

  // Fire the async resolve and attach the image if/when it lands. We
  // don't block the render on this — the gradient stands in until the
  // resolver settles, which means a cold workspace prints the whole
  // grid at paint-speed and fills in thumbs over the next handful of
  // network round-trips.
  //
  // We swallow resolver errors silently: the resolver already
  // normalises proxy failures to a cached null, but just in case a
  // future code path throws, we never want a bad card to nuke the
  // whole page.
  void (async () => {
    let imageUrl: string | null = null;
    try {
      imageUrl = await resolver.resolve(url, notesForUrl);
    } catch {
      return;
    }
    if (!imageUrl) return;
    if (!thumb.isConnected) return;
    applyOgImageToThumb(thumb, imageUrl);
  })();

  return thumb;
}

/**
 * Swaps the thumb's background from the gradient placeholder to an
 * actual image. Uses an `Image()` pre-load + onerror so that a broken
 * og:image URL (404, CORS on the image itself) silently keeps the
 * gradient rather than flashing a broken-image icon.
 *
 * We set the image as a `background-image` rather than an `<img>`
 * element so the existing domain chip overlay in the thumb keeps
 * working without restructuring the DOM. The gradient stripe stays
 * as a secondary background so a semi-transparent image still reads
 * as "a SutraPad card" rather than a raw screenshot.
 */
function applyOgImageToThumb(thumb: HTMLElement, imageUrl: string): void {
  const probe = new Image();
  probe.addEventListener("load", () => {
    if (!thumb.isConnected) return;
    thumb.style.backgroundImage = `url("${imageUrl}"), ${thumb.style.backgroundImage}`;
    thumb.style.backgroundSize = "cover, auto, auto";
    thumb.style.backgroundPosition = "center, 0 0, 0 0";
    thumb.classList.add("has-og-image");
  });
  probe.src = imageUrl;
}

function buildLinkBody(
  entry: LinkEntry,
  primaryNote: SutraPadDocument | null,
  onOpenNote: (noteId: string) => void,
): HTMLElement {
  const body = document.createElement("div");
  body.className = "link-body";

  const title = document.createElement("div");
  title.className = "link-card-title";
  // Fall back to the bare URL if we have no source note (shouldn't
  // happen in practice — every indexed link has at least one source —
  // but the render must stay safe if the data ever drifts).
  const resolvedTitle =
    primaryNote && primaryNote.title.trim() !== ""
      ? primaryNote.title
      : primaryNote
        ? "Untitled note"
        : entry.url;
  title.textContent = resolvedTitle;
  body.append(title);

  const description = primaryNote
    ? buildLinkCardDescription(primaryNote.body, entry.url)
    : null;
  if (description !== null) {
    const desc = document.createElement("div");
    desc.className = "link-card-desc";
    desc.textContent = description;
    body.append(desc);
  }

  body.append(buildLinkUrl(entry.url));
  body.append(buildLinkMeta(entry, primaryNote, onOpenNote));

  return body;
}

function buildLinkUrl(url: string): HTMLElement {
  const anchor = document.createElement("a");
  anchor.className = "link-card-url";
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  anchor.textContent = url;
  return anchor;
}

function buildLinkMeta(
  entry: LinkEntry,
  primaryNote: SutraPadDocument | null,
  onOpenNote: (noteId: string) => void,
): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "link-meta";

  if (entry.latestUpdatedAt) {
    const saved = document.createElement("time");
    saved.className = "link-card-saved";
    saved.dateTime = entry.latestUpdatedAt;
    saved.textContent = formatDate(entry.latestUpdatedAt);
    meta.append(saved);
  }

  if (primaryNote) {
    // Make the source-note chip actionable — the handoff's mock is
    // static, but a real "open the note that captured this" affordance
    // is the link card's most useful click target.
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "link-card-source";
    const title = primaryNote.title.trim() || "Untitled note";
    chip.textContent =
      entry.count === 1 ? title : `${title} · +${entry.count - 1}`;
    chip.setAttribute(
      "aria-label",
      entry.count === 1 ? `Open ${title}` : `Open ${title}, saved in ${entry.count} notebooks`,
    );
    chip.addEventListener("click", () => onOpenNote(primaryNote.id));
    meta.append(chip);
  }

  return meta;
}

/**
 * Compact list layout — ports the original Links page renderer verbatim
 * (URL on top, "Last added" timestamp, then chips for every notebook
 * that captured this link). Kept as the opt-in alternative to the
 * cards grid for users who want as many URLs on screen as possible.
 */
function buildLinksList(
  links: readonly LinkEntry[],
  notesById: ReadonlyMap<string, SutraPadDocument>,
  onOpenNote: (noteId: string) => void,
): HTMLElement {
  const list = document.createElement("ul");
  list.className = "links-list";

  for (const entry of links) {
    list.append(buildLinkListItem(entry, notesById, onOpenNote));
  }

  return list;
}

function buildLinkListItem(
  entry: LinkEntry,
  notesById: ReadonlyMap<string, SutraPadDocument>,
  onOpenNote: (noteId: string) => void,
): HTMLElement {
  const item = document.createElement("li");
  item.className = "link-item";

  // Favicon lede — small inline icon so dense list rows still have a
  // per-domain visual anchor without a full gradient thumb. Google's
  // s2/favicons service resolves same-CORS for `<img>` display and
  // falls back to a neutral globe when the domain has no favicon of
  // its own, so we never render a broken image.
  const hostname = deriveLinkHostname(entry.url);
  if (hostname) {
    const favicon = document.createElement("img");
    favicon.className = "link-favicon";
    favicon.src = buildFaviconUrl(hostname);
    favicon.alt = "";
    favicon.width = 20;
    favicon.height = 20;
    favicon.loading = "lazy";
    favicon.decoding = "async";
    item.append(favicon);
  }

  const anchor = document.createElement("a");
  anchor.className = "link-url";
  anchor.href = entry.url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  anchor.textContent = entry.url;
  item.append(anchor);

  if (entry.latestUpdatedAt) {
    const lastAdded = document.createElement("time");
    lastAdded.className = "link-last-added";
    lastAdded.dateTime = entry.latestUpdatedAt;
    lastAdded.textContent = `Last added ${formatDate(entry.latestUpdatedAt)}`;
    item.append(lastAdded);
  }

  const references = document.createElement("div");
  references.className = "link-notebooks";

  const referenceLabel = document.createElement("span");
  referenceLabel.className = "link-notebooks-label";
  referenceLabel.textContent =
    entry.count === 1 ? "Found in" : `Found in ${entry.count} notebooks`;
  references.append(referenceLabel);

  const seenIds = new Set<string>();
  for (const noteId of entry.noteIds) {
    if (seenIds.has(noteId)) continue;
    seenIds.add(noteId);
    const note = notesById.get(noteId);
    if (!note) continue;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "link-notebook-chip";
    chip.textContent = note.title.trim() || "Untitled note";
    chip.addEventListener("click", () => onOpenNote(noteId));
    references.append(chip);
  }

  item.append(references);
  return item;
}
