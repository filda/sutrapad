// @vitest-environment happy-dom
//
// First focused test for `src/app/view/pages/about-page.ts` — the longest of
// the static pages (five sections, a pull quote, a numbered how-it-works
// list, a credits list and a two-button foot CTA). Copy pages have no
// branches to speak of, so almost every mutant is a string, a class or an
// attribute. That sounds like a reason not to bother; it is the opposite. The
// module header records two invariants that only a test can hold:
//
//   - **no `innerHTML`, anywhere.** Every string goes in via `textContent`,
//     and the title's `<em>` goes through the shell's structured `title` slot
//     rather than a markup string. A future contributor threading a
//     user-controlled value through `buildParagraph` must not be able to
//     regress that quietly.
//   - **the copy is the deliverable.** It was lifted verbatim from the v3
//     handoff, and the Manifesto section was dropped on purpose. Asserting
//     the sections whole means "someone deleted a paragraph" reads as a test
//     failure rather than as a diff nobody looked at.
//
// The two things here that are actually logic: the `<ol>` step numbers are
// rendered as their own `aria-hidden` spans (`index + 1`, so an off-by-one is
// invisible to the eye but obvious in a test), and the credits list appends a
// trailing `<span>` only for the entries that carry a `note`.

import { describe, expect, it, vi } from "vitest";
import { buildAboutPage } from "../src/app/view/pages/about-page";

function mount() {
  const onSelectMenuItem = vi.fn();
  const page = buildAboutPage({ onSelectMenuItem });
  return { page, onSelectMenuItem };
}

const sectionById = (page: HTMLElement, id: string): HTMLElement | null =>
  page.querySelector<HTMLElement>(`#${id}`);

const paragraphsIn = (section: HTMLElement | null): Array<string | null> =>
  [...(section?.querySelectorAll(".static-paragraph") ?? [])].map((p) => p.textContent);

describe("buildAboutPage shell", () => {
  it("fills every header slot", () => {
    const { page } = mount();

    expect(page.className).toBe("static-page");
    expect(page.querySelector(".static-page-eyebrow")?.textContent).toBe("About · Sutrapad");
    expect(page.querySelector(".static-page-subtitle")?.textContent).toBe(
      "Sutrapad is a personal notebook for people who already think in places, moods, and threads — and who would like a tool that gets out of the way.",
    );
    expect(page.querySelector(".static-page-meta")?.textContent).toBe(
      "Last updated · April 2026",
    );
  });

  it("emphasises the closing half of the title", () => {
    const { page } = mount();
    const title = page.querySelector(".static-page-title");

    expect(title?.textContent).toBe("A notebook that remembers like you do.");
    expect(title?.querySelector("em")?.textContent).toBe("remembers like you do.");
  });

  it("lays the six blocks out in order", () => {
    // The pull quote sits between Why and How on purpose — it is the beat
    // between the problem statement and the mechanics.
    const { page } = mount();

    expect([...(page.querySelector(".prose")?.children ?? [])].map((child) => child.className)).toEqual([
      "static-section",
      "pull-quote",
      "static-section",
      "static-section",
      "static-section",
      "static-foot-cta",
    ]);
    expect([...page.querySelectorAll<HTMLElement>(".prose > .static-section")].map((s) => s.id)).toEqual([
      "why",
      "how",
      "who",
      "credits",
    ]);
  });

  it("names the four sections", () => {
    const { page } = mount();

    expect([...page.querySelectorAll(".static-h2")].map((h) => h.textContent)).toEqual([
      "Why another notebook",
      "How it works",
      "Who it's for",
      "Credits & open source",
    ]);
  });

  it("keeps the Manifesto section out", () => {
    // Dropped deliberately: its principles live inside Why and How. A
    // re-added `#manifesto` anchor would be a copy decision, not a refactor.
    const { page } = mount();

    expect(page.querySelector("#manifesto")).toBeNull();
    expect(page.querySelectorAll(".prose > .static-section")).toHaveLength(4);
  });
});

describe("buildAboutPage prose", () => {
  it("carries both Why paragraphs verbatim", () => {
    const { page } = mount();

    expect(paragraphsIn(sectionById(page, "why"))).toEqual([
      "Most note apps want to be your second brain. Sutrapad doesn't. It just wants to be a good first notebook — the kind you'd pick up in a stationary shop in Žižkov on a Tuesday morning, flip open at a café, and feel quietly happy about.",
      "The premise is small: you write in plain text. Sutrapad adds the context that's already in the moment — where you are, what time it is, what the weather's like, which device you're on, how you feel. Tags appear without you typing them. Threads emerge.",
    ]);
  });

  it("carries the Who paragraphs and mutes the second", () => {
    // The "not the right tool for" list is deliberately quieter than the
    // pitch above it — the muted class is the whole difference.
    const { page } = mount();
    const who = sectionById(page, "who");

    expect(paragraphsIn(who)).toEqual([
      "Sutrapad is for the kind of person who keeps a Moleskine in their bag but also has eight Notion workspaces they never open. For people who want their notes to feel like theirs — not like content in someone else's CMS.",
      "It is probably not the right tool for: team wikis, project management, enterprise knowledge bases, or the deep PKM rabbit hole. There are good tools for those.",
    ]);
    expect([...(who?.querySelectorAll("p") ?? [])].map((p) => p.className)).toEqual([
      "static-paragraph",
      "static-paragraph muted",
    ]);
  });

  it("renders the pull quote with a decorative mark and a citation", () => {
    const { page } = mount();
    const quote = page.querySelector(".pull-quote");

    expect(quote?.tagName.toLowerCase()).toBe("aside");
    expect(quote?.querySelector(".pull-quote-body")?.textContent).toBe(
      "The best notebook is the one you don't think about. The second-best is the one that thinks with you, not for you.",
    );
    expect(quote?.querySelector(".pull-quote-cite")?.textContent).toBe(
      "— Sutrapad design principle №1",
    );
    // The opening curly quote is ornament; a screen reader announcing it
    // would read a stray double-quote before the sentence.
    const mark = quote?.querySelector(".pull-quote-mark");
    expect(mark?.textContent).toBe("“");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect([...(quote?.children ?? [])].map((c) => c.className)).toEqual([
      "pull-quote-mark",
      "pull-quote-body",
      "pull-quote-cite",
    ]);
  });

  it("never parses any of its copy as markup", () => {
    // Everything goes in through `textContent`. The strings contain typographic
    // characters and an ampersand ("Credits & open source"); none of them may
    // arrive as an entity or as an element.
    const { page } = mount();

    expect(page.querySelectorAll(".prose script, .prose img")).toHaveLength(0);
    expect(page.textContent).toContain("Credits & open source");
    expect(page.textContent).not.toContain("&amp;");
  });
});

describe("buildAboutPage how-it-works steps", () => {
  it("numbers the four steps from one", () => {
    // The digits are rendered spans, not an `<ol>` counter, so an off-by-one
    // is invisible on screen review and obvious here.
    const { page } = mount();

    expect([...page.querySelectorAll(".static-step-num")].map((n) => n.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("hides the rendered digits from screen readers", () => {
    // The list is a real `<ol>`, so assistive tech numbers it already —
    // announcing the span too would read "one one".
    const { page } = mount();

    expect(page.querySelector(".static-steps")?.tagName.toLowerCase()).toBe("ol");
    expect(
      [...page.querySelectorAll(".static-step-num")].every(
        (num) => num.getAttribute("aria-hidden") === "true",
      ),
    ).toBe(true);
  });

  it("pairs each step's headline with its explanation", () => {
    const { page } = mount();
    const steps = [...page.querySelectorAll(".static-step")].map(
      (step) =>
        `${step.querySelector(".static-step-head")?.textContent} | ${
          step.querySelector(".static-step-text")?.textContent
        }`,
    );

    expect(steps).toEqual([
      "You write a note. | Plain text. Markdown if you want it, prose if you don't. URLs become links. The first line becomes the title.",
      "Sutrapad reads the room. | Location, time of day, weather, device, recent activity — all become tags. They live alongside your topic tags but don't compete with them.",
      "Things connect themselves. | Notes written at the same café, on the same overcast morning, about the same idea — they find each other. Without you opening a graph view.",
      "It saves to your drive. | Every note is a JSON file in your Google Drive folder. No proprietary database. No cloud dependency for read-back.",
    ]);
  });

  it("puts the digit beside a body wrapper inside each list item", () => {
    const { page } = mount();

    expect([...(page.querySelector(".static-step")?.children ?? [])].map((c) => c.className)).toEqual([
      "static-step-num",
      "static-step-body",
    ]);
    expect(page.querySelectorAll(".static-steps > .static-step")).toHaveLength(4);
  });
});

describe("buildAboutPage credits", () => {
  it("links the four sources it stands on", () => {
    const { page } = mount();
    const links = [...page.querySelectorAll<HTMLAnchorElement>(".static-list a")];

    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Ink & Switch — Local-first software", "https://www.inkandswitch.com/local-first"],
      ["Martin Kleppmann's writing on CRDTs", "https://martin.kleppmann.com"],
      ["Obsidian", "https://obsidian.md"],
      ["OpenStreetMap + Nominatim", "https://www.openstreetmap.org/"],
    ]);
    expect(page.querySelector(".static-list")?.className).toBe("static-list compact");
  });

  it("appends the trailing note only to the entries that carry one", () => {
    // `if (item.note)` is the one branch in this section: two of the four
    // credits have a tail, two do not.
    const { page } = mount();

    expect([...page.querySelectorAll(".static-list li")].map((li) => li.textContent)).toEqual([
      "Ink & Switch — Local-first software",
      "Martin Kleppmann's writing on CRDTs",
      "Obsidian — for proving Markdown vaults are enough",
      "OpenStreetMap + Nominatim — reverse geocoding for the location tag",
    ]);
    expect([...page.querySelectorAll(".static-list li")].map((li) => li.children.length)).toEqual([
      1, 1, 2, 2,
    ]);
  });

  it("opens every outbound credit in a new tab with noopener", () => {
    const { page } = mount();
    const links = [...page.querySelectorAll<HTMLAnchorElement>("#credits a")];

    expect(links.every((link) => link.target === "_blank")).toBe(true);
    expect(links.every((link) => link.rel === "noopener")).toBe(true);
    // Four credits plus the repo link in the source line below them.
    expect(links).toHaveLength(5);
  });

  it("builds the source line from three nodes rather than one string", () => {
    const { page } = mount();
    const line = page.querySelector("#credits .static-paragraph.muted");

    expect(line?.textContent).toBe(
      "Source code at github.com/filda/sutrapad · MIT license.",
    );
    expect([...(line?.children ?? [])].map((c) => c.tagName.toLowerCase())).toEqual([
      "span",
      "a",
      "span",
    ]);
    expect(line?.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/filda/sutrapad",
    );
  });

  it("introduces the list before showing it", () => {
    const { page } = mount();

    expect([...(sectionById(page, "credits")?.children ?? [])].map((c) => c.className)).toEqual([
      "static-h2",
      "static-paragraph",
      "static-list compact",
      "static-paragraph muted",
    ]);
    expect(paragraphsIn(sectionById(page, "credits"))[0]).toBe(
      "Sutrapad is built on the shoulders of people who thought hard about local-first software, plain-text durability, and quiet design. In particular:",
    );
  });
});

describe("buildAboutPage foot CTA", () => {
  it("asks the closing question above the buttons", () => {
    const { page } = mount();
    const text = page.querySelector(".static-foot-cta-text");

    expect(text?.querySelector(".static-foot-cta-eyebrow")?.textContent).toBe("Ready to start?");
    expect(text?.querySelector(".static-foot-cta-head")?.textContent).toBe(
      "Open a notebook. Or read the privacy policy first.",
    );
    expect([...(page.querySelector(".static-foot-cta")?.children ?? [])].map((c) => c.className)).toEqual([
      "static-foot-cta-text",
      "static-foot-cta-actions",
    ]);
  });

  it("offers Privacy as the quiet option and Today as the primary one", () => {
    const { page } = mount();
    const buttons = [
      ...page.querySelectorAll<HTMLButtonElement>(".static-foot-cta-actions button"),
    ];

    expect(buttons.map((button) => [button.className, button.textContent])).toEqual([
      ["button button-ghost", "Privacy"],
      ["button button-primary", "Open Today →"],
    ]);
    expect(buttons.every((button) => button.type === "button")).toBe(true);
  });

  it("routes each button to its own destination", () => {
    const { page, onSelectMenuItem } = mount();

    for (const button of page.querySelectorAll<HTMLButtonElement>(
      ".static-foot-cta-actions button",
    )) {
      button.click();
    }

    expect(onSelectMenuItem.mock.calls.flat()).toEqual(["privacy", "home"]);
  });
});
