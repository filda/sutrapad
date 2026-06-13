import { describe, expect, it } from "vitest";
import {
  detectKind,
  KIND_CHIP_COPY,
  URL_PATTERN,
  type KindId,
} from "../src/lib/detect-kind";

/**
 * Tiny helper — every test only supplies `body` because `title` isn't
 * currently read by any rule. The helper documents that dependency so
 * if a rule grows to read the title the tests all gain it in one spot.
 */
function detect(body: string, title = ""): KindId {
  return detectKind({ title, body });
}

describe("detectKind — empty / trivial inputs", () => {
  it("returns 'note' for an empty body", () => {
    expect(detect("")).toBe("note");
  });

  it("returns 'note' for whitespace-only bodies", () => {
    expect(detect("   \n\t  ")).toBe("note");
  });

  it("returns 'fleeting' for a short body with content", () => {
    expect(detect("just a passing thought")).toBe("fleeting");
  });

  it("'fleeting' threshold is at 14 words (under 15)", () => {
    // 14 words — still fleeting
    const fourteen = Array.from({ length: 14 }, (_, index) => `w${index}`).join(
      " ",
    );
    expect(detect(fourteen)).toBe("fleeting");
  });

  it("15-word body crosses out of 'fleeting' and becomes 'note'", () => {
    // 15 words on 1 line → not fleeting, not longform (longform is >40)
    const fifteen = Array.from({ length: 15 }, (_, index) => `w${index}`).join(
      " ",
    );
    expect(detect(fifteen)).toBe("note");
  });
});

describe("detectKind — link", () => {
  it("classifies a plain https URL", () => {
    expect(detect("https://example.com")).toBe("link");
  });

  it("classifies a URL even with trailing newline (typical paste)", () => {
    expect(detect("https://example.com/path?q=1\n")).toBe("link");
  });

  it("classifies www-prefixed URLs", () => {
    expect(detect("www.example.com/read")).toBe("link");
  });

  it("does NOT classify as 'link' when URL is followed by commentary", () => {
    expect(detect("https://example.com — worth reading later")).not.toBe(
      "link",
    );
  });
});

describe("detectKind — links (plural)", () => {
  it("classifies two URLs under 30 words", () => {
    expect(detect("https://a.com\nhttps://b.com")).toBe("links");
  });

  it("classifies three URLs with short glue text", () => {
    expect(
      detect("compare: https://a.com vs https://b.com vs https://c.com"),
    ).toBe("links");
  });

  it("does NOT classify as 'links' when body is long (>= 30 words)", () => {
    const prefix = Array.from({ length: 30 }, (_, index) => `w${index}`).join(
      " ",
    );
    expect(detect(`${prefix} https://a.com https://b.com`)).not.toBe("links");
  });
});

describe("detectKind — tasks", () => {
  it("classifies a body where all non-empty lines are task lines", () => {
    const body = "- [ ] buy milk\n- [ ] call the plumber\n- [x] renew lease";
    expect(detect(body)).toBe("tasks");
  });

  it("classifies at exactly the 50% boundary", () => {
    const body = "- [ ] one\nplain line\n- [ ] two\nanother plain line";
    // 2 of 4 non-empty lines are tasks → 50% → tasks
    expect(detect(body)).toBe("tasks");
  });

  it("does NOT classify as 'tasks' when below half are tasks", () => {
    const body = "- [ ] one\nplain line\nanother plain line";
    // 1 of 3 → 33% → not tasks
    expect(detect(body)).not.toBe("tasks");
  });

  it("ignores plain bullet lines — must be actual `[ ]` / `[x]` checkbox", () => {
    const body = "- plain bullet\n- another bullet\n- a third bullet";
    expect(detect(body)).not.toBe("tasks");
  });

  it("accepts numbered-list task syntax (`1. [ ] …`)", () => {
    const body = "1. [ ] first\n2. [x] second";
    expect(detect(body)).toBe("tasks");
  });

  it("accepts uppercase X in the checkbox", () => {
    expect(detect("- [X] done")).toBe("tasks");
  });
});

describe("detectKind — quote", () => {
  it("classifies bodies starting with a typographer opening quote", () => {
    expect(detect("\u201Cthe only way to do great work\u201D")).toBe("quote");
  });

  it("classifies bodies starting with a German low opening quote („)", () => {
    expect(detect("\u201Eto je v pořádku\u201D")).toBe("quote");
  });

  it("classifies bodies with a blockquote line (`> …`)", () => {
    const body = "context line\n> quoted passage here\nmore context";
    expect(detect(body)).toBe("quote");
  });

  it("does NOT classify as 'quote' when the ASCII double-quote is the opener (too ambiguous)", () => {
    // 40+ words so it doesn't fall into 'fleeting'; leading ASCII quote is
    // deliberately not a quote-kind trigger per the design notes.
    const body = `"dialogue-style opener" ${"word ".repeat(40)}`;
    expect(detect(body)).not.toBe("quote");
  });
});

describe("detectKind — longform", () => {
  it("classifies a 60-word paragraph on a single line", () => {
    const body = Array.from({ length: 60 }, (_, index) => `word${index}`).join(
      " ",
    );
    expect(detect(body)).toBe("longform");
  });

  it("classifies a 60-word body spread across 3 lines", () => {
    const line = Array.from({ length: 20 }, (_, index) => `w${index}`).join(
      " ",
    );
    expect(detect(`${line}\n${line}\n${line}`)).toBe("longform");
  });

  it("does NOT classify as 'longform' when line count exceeds 3", () => {
    const line = Array.from({ length: 15 }, (_, index) => `w${index}`).join(
      " ",
    );
    expect(detect(`${line}\n${line}\n${line}\n${line}`)).not.toBe("longform");
  });

  it("does NOT classify as 'longform' at exactly 40 words (rule is strict >)", () => {
    const forty = Array.from({ length: 40 }, (_, index) => `w${index}`).join(
      " ",
    );
    expect(detect(forty)).toBe("note");
  });
});

describe("detectKind — note (fallback)", () => {
  it("falls back to 'note' for medium-length multi-line writing", () => {
    // 15 words on 5 lines — not fleeting (>=15), not longform (>3 lines),
    // not tasks / quote / link(s)
    const body = "a b c\nd e f\ng h i\nj k l\nm n o";
    expect(detect(body)).toBe("note");
  });

  it("'note' wins over 'quote' when leading char is ASCII \" (ambiguous)", () => {
    const body = `"just a chat" ${"word ".repeat(20)}`;
    expect(detect(body)).toBe("note");
  });
});

describe("detectKind — rule precedence", () => {
  it("link beats fleeting for a short URL-only body", () => {
    expect(detect("https://a.co")).toBe("link");
  });

  it("links beats longform when multiple URLs appear in a short body", () => {
    expect(detect("https://a.com https://b.com https://c.com")).toBe("links");
  });

  it("tasks beats longform for a long checklist", () => {
    const body = Array.from(
      { length: 10 },
      (_, index) => `- [ ] step number ${index} with several words`,
    ).join("\n");
    expect(detect(body)).toBe("tasks");
  });

  it("quote beats longform when a long body opens with an opening quote", () => {
    const body = `\u201C${"word ".repeat(50)}\u201D`;
    expect(detect(body)).toBe("quote");
  });
});

describe("KIND_CHIP_COPY", () => {
  it("has copy for every KindId", () => {
    const kinds: KindId[] = [
      "note",
      "link",
      "links",
      "tasks",
      "quote",
      "longform",
      "fleeting",
    ];
    for (const kind of kinds) {
      const entry = KIND_CHIP_COPY[kind];
      expect(entry.icon.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.subtitle.length).toBeGreaterThan(0);
    }
  });
});

describe("URL_PATTERN", () => {
  it("matches all URLs without state leakage between calls", () => {
    const input = "a https://x.com b https://y.com";
    // If we forgot to reset /g between calls, the second .match would
    // skip earlier matches — this test guards that.
    const first = input.match(URL_PATTERN);
    const second = input.match(URL_PATTERN);
    expect(first).toEqual(second);
    expect(first?.length).toBe(2);
  });

  it("stops at any whitespace character (newline, tab, regular space)", () => {
    // The character class is `[^\s<>]+`. A swap to `\S` (non-space)
    // would reject the `<>` exclusion silently; a swap to a single
    // character `[^\s<>]` would chop URLs into single-character matches.
    expect("https://a.com next".match(URL_PATTERN)).toEqual(["https://a.com"]);
    expect("https://a.com\nhttps://b.com".match(URL_PATTERN)).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
    expect("https://a.com\thttps://b.com".match(URL_PATTERN)).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("stops at angle brackets so an HTML-style wrapper doesn't leak in", () => {
    // `<https://x.com>` is the markdown-autolink form. The bracket
    // exclusion keeps the matched URL clean ("https://x.com" not
    // "https://x.com>").
    expect("<https://x.com>".match(URL_PATTERN)).toEqual(["https://x.com"]);
  });

  it("matches bare-domain URLs that include a path segment", () => {
    // Pattern's second alternation requires `\/[^\s<>]*` — i.e. there
    // must be a path. Bare hostnames without a slash are deliberately
    // not matched (too noisy in casual prose).
    expect("read example.com/article tomorrow".match(URL_PATTERN)).toEqual([
      "example.com/article",
    ]);
    expect("hostname-only example.com please".match(URL_PATTERN)).toBeNull();
  });
});

describe("detectKind — task line shape", () => {
  // These tests pin the exact shape of the TASK_LINE regex so a swap
  // from `\s+` to `\s` (Stryker's typical narrowing) or `\d+` to `\d`
  // surfaces in tests instead of users' notes. Each assertion targets
  // a specific component of the regex.
  it("requires at least one whitespace character between bullet and bracket", () => {
    // `- [ ]` has the space between `-` and `[`. `-[ ] x` does NOT and
    // must therefore not be classified as tasks. (Otherwise plain
    // hyphenated prose like "anti-[clockwise]" would tip into tasks.)
    expect(detect("-[ ] not a task\n-[ ] also not")).not.toBe("tasks");
  });

  it("requires at least one whitespace character between bracket and content", () => {
    // `- [ ]task` has no space between `]` and the content. Must not
    // be tasks. The trailing `\s+` in the regex is what enforces this.
    expect(detect("- [ ]glued\n- [ ]also-glued")).not.toBe("tasks");
  });

  it("accepts a multi-digit numbered list (`12. [ ] …`)", () => {
    // Stryker mutates `\d+` to `\d` (single digit) — a 12-line numbered
    // task list would silently stop being recognised. Two double-digit
    // entries here would fall back to the bullet-list path under the
    // mutated regex.
    expect(detect("11. [ ] eleven\n12. [ ] twelve")).toBe("tasks");
  });

  it("rejects a checkbox containing a non-x letter", () => {
    // The character class is `[ xX]` — anything else (e.g. `[?]`)
    // must NOT be parsed as a task.
    expect(detect("- [?] unknown\n- [?] also unknown")).not.toBe("tasks");
  });

  it("requires a leading anchor — task syntax inside prose does not flip the kind", () => {
    // The regex starts with `^\s*`, anchored. `prose - [ ] task` has
    // the bullet mid-line and must not classify as tasks.
    const body = `prose paragraph - [ ] task fragment\nanother prose paragraph - [ ] more`;
    expect(detect(body)).not.toBe("tasks");
  });
});

describe("detectKind — links count threshold", () => {
  it("classifies as 'links' at exactly 2 URLs (the boundary)", () => {
    // `urlCount >= 2 && words < 30` — the `>= 2` half is the boundary
    // we pin here. A swap to `> 2` would drop two-URL bodies into note.
    expect(detect("https://a.com https://b.com")).toBe("links");
  });

  it("does NOT classify as 'links' at exactly 1 URL", () => {
    // Single URL → falls through to the `link` rule (above) or to
    // shorter-body rules. Pin the lower edge so a swap to `>= 1`
    // (which would catch single URLs) reads as a behaviour change.
    expect(detect("just one https://a.com here please")).not.toBe("links");
  });

  it("stays 'links' at exactly 29 words (just under the < 30 cap)", () => {
    // 27 padding words + 2 URLs = 29 words. Under the strict-less-than
    // cap → still links. Pinned alongside the 30-word test below to
    // pin both sides of the boundary.
    const padding = Array.from({ length: 27 }, (_, idx) => `w${idx}`).join(" ");
    expect(detect(`${padding} https://a.com https://b.com`)).toBe("links");
  });

  it("stops being 'links' once the word count hits exactly 30", () => {
    // 28 padding words + 2 URLs = 30 words. `words < 30` flips to
    // false at exactly 30 — a swap to `<= 30` would silently keep
    // this case as 'links'. The body is long enough for the longform
    // branch to claim it instead.
    const padding = Array.from({ length: 28 }, (_, idx) => `w${idx}`).join(" ");
    expect(detect(`${padding} https://a.com https://b.com`)).not.toBe("links");
  });
});

describe("detectKind — longform / fleeting boundaries", () => {
  it("'longform' is strict-greater-than 40 words (not >=)", () => {
    const forty = Array.from({ length: 40 }, (_, index) => `w${index}`).join(
      " ",
    );
    const fortyOne = Array.from({ length: 41 }, (_, index) => `w${index}`).join(
      " ",
    );
    // 40 → not longform (it's the existing "note" branch); 41 → longform.
    // Stryker's `> 40` → `>= 40` mutation flips the 40 case.
    expect(detect(forty)).toBe("note");
    expect(detect(fortyOne)).toBe("longform");
  });

  it("'longform' requires <= 3 lines", () => {
    // Pin the line cap. 3 lines → longform; 4 lines with the same
    // word count → not longform. Stryker's `<= 3` → `< 3` mutation
    // flips the 3-line case.
    const line = Array.from({ length: 20 }, (_, index) => `w${index}`).join(
      " ",
    );
    expect(detect(`${line}\n${line}\n${line}`)).toBe("longform");
    expect(detect(`${line}\n${line}\n${line}\n${line}`)).not.toBe("longform");
  });
});

describe("detectKind — tasks ratio boundary", () => {
  it("crosses into 'tasks' at exactly 50% (tasks*2 === nonEmpty)", () => {
    // 1 task line, 2 non-empty → 1*2 === 2 → tasks (>= boundary).
    expect(detect("- [ ] one\nplain")).toBe("tasks");
  });

  it("does NOT cross into 'tasks' just below 50% (tasks*2 < nonEmpty)", () => {
    // 1 task line, 3 non-empty → 1*2 < 3 → not tasks.
    expect(detect("- [ ] one\nplain\nmore plain")).not.toBe("tasks");
  });
});

describe("detectKind — pure-URL guard", () => {
  it("rejects a URL with trailing whitespace as 'pure URL'", () => {
    // `isPureUrl` rejects whitespace inside the trimmed body. A space
    // in the middle would otherwise allow `https://a.com tail` to be
    // classified as a single-URL link kind.
    expect(detect("https://a.com extra")).not.toBe("link");
  });

  it("rejects two whitespace-separated URLs as 'pure URL' (kind is 'links', not 'link')", () => {
    // Two URLs with a space → matches.length === 2, not pure-URL,
    // falls through to the urlCount branch and lands on 'links'.
    expect(detect("https://a.com https://b.com")).toBe("links");
  });

  it("treats a single non-URL token as fleeting, never 'link'", () => {
    // A whitespace-free word reaches the `matches === null` branch of
    // isPureUrl. If that branch returned true instead of false, a plain
    // word like "hello" would be mis-detected as a link.
    expect(detect("hello")).toBe("fleeting");
  });

  it("does not treat a URL glued to a prefix (single match ≠ whole body) as 'link'", () => {
    // "see:www.foo.com/x" has no whitespace and yields exactly one URL
    // match, but the match doesn't span the whole body — so isPureUrl's
    // `matches[0] === trimmed` half must hold. A swap of `&&` to `||`
    // there would wrongly flip this to 'link'.
    expect(detect("see:www.foo.com/x")).not.toBe("link");
  });

  it("recognises a plain http:// URL (scheme is optional-s, not required-https)", () => {
    // URL_PATTERN uses `https?://`. Dropping the `?` (https-only) would
    // leave a bare "http://example.com" unmatched and mis-detect it as
    // fleeting text instead of a link.
    expect(detect("http://example.com")).toBe("link");
  });
});

describe("detectKind — whitespace handling edge cases", () => {
  it("counts words across runs of whitespace as one separator", () => {
    // 14 real words, but one gap is a double space. The word splitter is
    // `/\s+/`; narrowing it to `/\s/` would count an empty token and tip
    // the body from 14 (fleeting) to 15 (note).
    const body = "w0  w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13";
    expect(detect(body)).toBe("fleeting");
  });

  it("ignores blank/whitespace-only lines when counting longform lines", () => {
    // 3 content lines separated by whitespace-only lines. The line counter
    // filters empties (`line.trim() !== ""`); dropping the filter — or the
    // `.trim()` in it — would count 5 lines, pushing this past the ≤3 cap
    // and out of 'longform'.
    const line = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    expect(detect(`${line}\n   \n${line}\n   \n${line}`)).toBe("longform");
  });

  it("ignores a whitespace-only line when measuring the tasks ratio", () => {
    // 1 task + 1 whitespace-only line + 1 plain. The empty line (kept
    // mid-body so the outer trim can't strip it) must be skipped so
    // nonEmpty is 2 (→ 50% → tasks). Counting it would make nonEmpty 3
    // (1*2 < 3) and drop the body out of 'tasks'.
    expect(detect("- [ ] a\n   \nplain line")).toBe("tasks");
  });

  it("recognises indented task lines (leading whitespace before the bullet)", () => {
    // TASK_LINE opens with `^\s*` to allow nested/indented checklists. A
    // leading heading keeps the indented bullets mid-body (out of reach of
    // the outer trim). Narrowing `^\s*` to `^\S*` would reject the indented
    // tasks, dropping nonEmpty's task share below half.
    expect(detect("list:\n  - [ ] a\n  - [ ] b\n  - [ ] c")).toBe("tasks");
  });
});

describe("detectKind — quote anchoring", () => {
  it("does not flag an opening-quote character that appears mid-body", () => {
    // The opening-quote test is anchored with `^`. A typographer quote in
    // the middle of the text must not trigger 'quote' — dropping the
    // anchor would match it anywhere.
    expect(detect("abc “mid quote” end")).not.toBe("quote");
  });

  it("does not flag a '>' that appears mid-line (not a blockquote opener)", () => {
    // BLOCKQUOTE_LINE is anchored per line with `^>`. A greater-than sign
    // used as prose ("2 > 1") must not be read as a blockquote — dropping
    // the anchor would match the inline "> ".
    expect(detect("2 > 1 holds true")).not.toBe("quote");
  });
});
