/**
 * Live detection of a note's *kind* from its title + body text.
 *
 * "Kind" is not a stored field on a SutraPad note — it's a derived view
 * over whatever the user has typed, re-computed on every keystroke by
 * the editor so the kind-chip in the detail topbar can update live.
 * Keeping it derived (rather than persisted with each save) means the
 * existing workspace format doesn't need a migration, and the rule set
 * can be tightened later without backfilling old data.
 *
 * The rules come from the design handoff (§2 "Add / universal capture"),
 * evaluated in this order:
 *
 *   1. Pure URL                                      → `link`
 *   2. ≥ 2 URLs in a short body (< 30 words)         → `links`
 *   3. ≥ 50 % of non-empty lines are task checkboxes → `tasks`
 *   4. Starts with an opening quote mark OR contains
 *      a leading-`>`-style blockquote line           → `quote`
 *   5. > 40 words on ≤ 3 lines                       → `longform`
 *   6. < 15 words, non-empty                         → `fleeting`
 *   7. Anything else (including completely empty)    → `note`
 *
 * The order matters: `link` beats `fleeting` when the body is a single
 * short URL; `tasks` beats `longform` when a long task list crosses 40
 * words; `quote` is checked before `longform` because quoted longform
 * passages are still most usefully displayed as quotes.
 */

export type KindId =
  | "note"
  | "link"
  | "links"
  | "tasks"
  | "quote"
  | "longform"
  | "fleeting";

export interface DetectKindInput {
  /** The current title value. Currently unused by the rules, but kept on the interface because the editor always has both fields at hand and future rules (e.g. "link if body is pure URL but title has text") should not have to break the signature. */
  title: string;
  /** The body textarea's current value — markdown source, not rendered. */
  body: string;
}

/**
 * Task-line regex. We only recognise *unchecked* and *checked* GFM task
 * syntax (`- [ ]` / `- [x]` / `* [ ]` / `1. [ ]`), not plain bullets —
 * the signal we're looking for is "the user is planning actions", which
 * a bullet list of nouns doesn't imply.
 */
const TASK_LINE = /^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+/;

/**
 * Liberal URL regex. Matches `http(s)://…`, `www.…`, and bare-domain
 * patterns like `example.com/path`. The `lookbehind-unfriendly` browsers
 * we support (per the `project_sutrapad_browser_support` memory, modern
 * only) all handle this.
 *
 * Exported so the kind-chip renderer can reuse the same predicate when
 * it decides whether to show the "fetching title…" link-preview
 * placeholder in the editor — keeping URL recognition in one place
 * prevents the chip from saying "link" while the preview sits dormant.
 */
export const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\/[^\s<>]*/gi;

/**
 * Opening-quote characters that bias the body toward "quote" kind.
 *
 * We match typographer-style opening quotes only — ASCII `"` and `'`
 * are deliberately *excluded* because they're too ambiguous in casual
 * prose (a longform paragraph that opens with a dialogue line would
 * otherwise get misclassified).
 *
 * Written with explicit `\u…` escapes to avoid surprises from
 * source-file encoding tools that might normalise, substitute, or
 * strip the raw unicode characters during copy/paste.
 *
 *   \u00AB  «   French/Czech opening
 *   \u201E  „   German/Czech low opening double
 *   \u201C  "   English opening double
 *   \u2018  '   English opening single
 */
const OPENING_QUOTE_CHARS = /^[\u00AB\u201E\u201C\u2018]/;

/** Matches a blockquote-style opener anywhere in the body. */
const BLOCKQUOTE_LINE = /^>\s+/m;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

function splitNonEmptyLines(text: string): readonly string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

function isPureUrl(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === "") return false;
  // `trim` + `\S+` check catches trailing whitespace / newline that users
  // commonly leave after pasting a URL from the address bar.
  if (/\s/.test(trimmed)) return false;
  // Reset `lastIndex` because the module-level regex has /g — without a
  // fresh match call it would return stale state across invocations.
  const matches = trimmed.match(URL_PATTERN);
  if (matches === null) return false;
  // A pure-URL body is a single URL that spans the whole trimmed input.
  return matches.length === 1 && matches[0] === trimmed;
}

function countUrls(body: string): number {
  const matches = body.match(URL_PATTERN);
  return matches === null ? 0 : matches.length;
}

function countTaskLines(body: string): { tasks: number; nonEmpty: number } {
  let tasks = 0;
  let nonEmpty = 0;
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    nonEmpty += 1;
    if (TASK_LINE.test(line)) tasks += 1;
  }
  return { tasks, nonEmpty };
}

function startsWithQuote(body: string): boolean {
  const trimmed = body.trimStart();
  if (trimmed === "") return false;
  return OPENING_QUOTE_CHARS.test(trimmed) || BLOCKQUOTE_LINE.test(trimmed);
}

/**
 * The handoff copy that should appear to the right of the kind label on
 * the `.add-kind-chip`. Exposed alongside `detectKind` so the chip
 * builder can read both from a single call site. Copy is deliberately
 * short — the chip is a live hint, not a dialog.
 */
export const KIND_CHIP_COPY: Readonly<
  Record<KindId, { icon: string; label: string; subtitle: string }>
> = {
  note: {
    icon: "\u26A1",          // ⚡
    label: "Note",
    subtitle: "Plain text note",
  },
  link: {
    icon: "\u{1F517}",       // 🔗
    label: "Link",
    subtitle: "Saved URL",
  },
  links: {
    icon: "\u{1F4CE}",       // 📎
    label: "Links",
    subtitle: "Several URLs",
  },
  tasks: {
    icon: "\u2705",          // ✅
    label: "Tasks",
    subtitle: "Checklist",
  },
  quote: {
    icon: "\u201C",          // “
    label: "Quote",
    subtitle: "Excerpt",
  },
  longform: {
    icon: "\u{1F4D6}",       // 📖
    label: "Longform",
    subtitle: "Reading piece",
  },
  fleeting: {
    icon: "\u{1F4AD}",       // 💭
    label: "Fleeting",
    subtitle: "Quick jot",
  },
};

/**
 * Detects the current kind from title+body. Pure; always returns a
 * valid `KindId`. Empty or whitespace-only inputs are classified as
 * `note` (the neutral default) rather than `fleeting` — `fleeting` is
 * reserved for bodies with *some* content, so the chip doesn't jump
 * on the very first keystroke.
 */
export function detectKind({ body }: DetectKindInput): KindId {
  const trimmed = body.trim();
  if (trimmed === "") return "note";

  if (isPureUrl(trimmed)) return "link";

  const words = countWords(trimmed);
  const urlCount = countUrls(trimmed);
  if (urlCount >= 2 && words < 30) return "links";

  const { tasks, nonEmpty } = countTaskLines(trimmed);
  if (nonEmpty > 0 && tasks * 2 >= nonEmpty) return "tasks";

  if (startsWithQuote(trimmed)) return "quote";

  const lineCount = splitNonEmptyLines(trimmed).length;
  if (words > 40 && lineCount <= 3) return "longform";

  if (words < 15) return "fleeting";

  return "note";
}
