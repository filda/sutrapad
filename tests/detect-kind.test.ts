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
});
