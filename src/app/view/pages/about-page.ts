/**
 * About page — long-form intro to what SutraPad is and how it works.
 *
 * Copy lifted verbatim from the v3 design handoff
 * (`docs/design_handoff_sutrapad3/extracted/13_footer_static_pages.jsx`,
 * `AboutScreen`). The Manifesto section is intentionally omitted at
 * Filip's call — it lived in the v3 prototype as a separate `#manifesto`
 * anchor, but the principles are scattered through Why / How and don't
 * earn their own section yet.
 *
 * **All textual content is set via `textContent`** so a future contributor
 * dropping a user-controlled string into one of the helpers can't
 * accidentally regress the no-innerHTML invariant. The lone exception is
 * the page title, where we want `<em>` emphasis on "remembers like you
 * do." — the rich title goes through the shell's `titleHtml` slot whose
 * caller-escapes-everything contract is documented there.
 *
 * **Updating copy:** edit the strings in this module directly. Copy
 * lives next to the DOM that renders it — same convention as
 * `privacy-page.ts` and `terms-page.ts`. There is no separate markdown
 * source-of-truth to keep in sync.
 */

import { buildStaticPageShell } from "../chrome/static-page-shell";
import type { MenuItemId } from "../../logic/menu";

export interface AboutPageOptions {
  /** Threaded through to the shell's back link + foot-CTA buttons. */
  onSelectMenuItem: (id: MenuItemId) => void;
}

export function buildAboutPage({
  onSelectMenuItem,
}: AboutPageOptions): HTMLElement {
  const content: Node[] = [
    buildWhySection(),
    buildPullQuote(),
    buildHowSection(),
    buildWhoSection(),
    buildCreditsSection(),
    buildFootCta(onSelectMenuItem),
  ];

  return buildStaticPageShell({
    eyebrow: "About · Sutrapad",
    titleHtml: "A notebook that <em>remembers like you do.</em>",
    subtitle:
      "Sutrapad is a personal notebook for people who already think in places, moods, and threads — and who would like a tool that gets out of the way.",
    lastUpdated: "April 2026",
    content,
    onSelectMenuItem,
  });
}

function buildWhySection(): HTMLElement {
  const section = document.createElement("section");
  section.className = "static-section";
  section.id = "why";
  section.append(buildHeading("Why another notebook"));
  section.append(
    buildParagraph(
      "Most note apps want to be your second brain. Sutrapad doesn't. It just wants to be a good first notebook — the kind you'd pick up in a stationary shop in Žižkov on a Tuesday morning, flip open at a café, and feel quietly happy about.",
    ),
  );
  section.append(
    buildParagraph(
      "The premise is small: you write in plain text. Sutrapad adds the context that's already in the moment — where you are, what time it is, what the weather's like, which device you're on, how you feel. Tags appear without you typing them. Threads emerge.",
    ),
  );
  return section;
}

function buildPullQuote(): HTMLElement {
  const aside = document.createElement("aside");
  aside.className = "pull-quote";

  const mark = document.createElement("span");
  mark.className = "pull-quote-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "“";
  aside.append(mark);

  const body = document.createElement("p");
  body.className = "pull-quote-body";
  body.textContent =
    "The best notebook is the one you don't think about. The second-best is the one that thinks with you, not for you.";
  aside.append(body);

  const cite = document.createElement("p");
  cite.className = "pull-quote-cite";
  cite.textContent = "— Sutrapad design principle №1";
  aside.append(cite);

  return aside;
}

function buildHowSection(): HTMLElement {
  const section = document.createElement("section");
  section.className = "static-section";
  section.id = "how";
  section.append(buildHeading("How it works"));

  const steps = document.createElement("ol");
  steps.className = "static-steps";
  const stepData: ReadonlyArray<{ head: string; body: string }> = [
    {
      head: "You write a note.",
      body:
        "Plain text. Markdown if you want it, prose if you don't. URLs become links. The first line becomes the title.",
    },
    {
      head: "Sutrapad reads the room.",
      body:
        "Location, time of day, weather, device, recent activity — all become tags. They live alongside your topic tags but don't compete with them.",
    },
    {
      head: "Things connect themselves.",
      body:
        "Notes written at the same café, on the same overcast morning, about the same idea — they find each other. Without you opening a graph view.",
    },
    {
      head: "It saves to your drive.",
      body:
        "Every note is a JSON file in your Google Drive folder. No proprietary database. No cloud dependency for read-back.",
    },
  ];
  for (const [index, step] of stepData.entries()) {
    const li = document.createElement("li");
    li.className = "static-step";

    const num = document.createElement("span");
    num.className = "static-step-num";
    num.setAttribute("aria-hidden", "true");
    num.textContent = String(index + 1);
    li.append(num);

    const stepBody = document.createElement("div");
    stepBody.className = "static-step-body";

    const head = document.createElement("p");
    head.className = "static-step-head";
    head.textContent = step.head;
    stepBody.append(head);

    const text = document.createElement("p");
    text.className = "static-step-text";
    text.textContent = step.body;
    stepBody.append(text);

    li.append(stepBody);
    steps.append(li);
  }
  section.append(steps);

  return section;
}

function buildWhoSection(): HTMLElement {
  const section = document.createElement("section");
  section.className = "static-section";
  section.id = "who";
  section.append(buildHeading("Who it's for"));
  section.append(
    buildParagraph(
      "Sutrapad is for the kind of person who keeps a Moleskine in their bag but also has eight Notion workspaces they never open. For people who want their notes to feel like theirs — not like content in someone else's CMS.",
    ),
  );
  const muted = buildParagraph(
    "It is probably not the right tool for: team wikis, project management, enterprise knowledge bases, or the deep PKM rabbit hole. There are good tools for those.",
  );
  muted.className = "static-paragraph muted";
  section.append(muted);
  return section;
}

function buildCreditsSection(): HTMLElement {
  const section = document.createElement("section");
  section.className = "static-section";
  section.id = "credits";
  section.append(buildHeading("Credits & open source"));
  section.append(
    buildParagraph(
      "Sutrapad is built on the shoulders of people who thought hard about local-first software, plain-text durability, and quiet design. In particular:",
    ),
  );

  const list = document.createElement("ul");
  list.className = "static-list compact";

  const credits: ReadonlyArray<{ href: string; label: string; note?: string }> = [
    {
      href: "https://www.inkandswitch.com/local-first",
      label: "Ink & Switch — Local-first software",
    },
    {
      href: "https://martin.kleppmann.com",
      label: "Martin Kleppmann's writing on CRDTs",
    },
    {
      href: "https://obsidian.md",
      label: "Obsidian",
      note: " — for proving Markdown vaults are enough",
    },
    {
      href: "https://www.openstreetmap.org/",
      label: "OpenStreetMap + Nominatim",
      note: " — reverse geocoding for the location tag",
    },
  ];
  for (const item of credits) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = item.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = item.label;
    li.append(a);
    if (item.note) {
      const tail = document.createElement("span");
      tail.textContent = item.note;
      li.append(tail);
    }
    list.append(li);
  }
  section.append(list);

  const sourceLine = document.createElement("p");
  sourceLine.className = "static-paragraph muted";

  const lead = document.createElement("span");
  lead.textContent = "Source code at ";
  sourceLine.append(lead);

  const repoLink = document.createElement("a");
  repoLink.href = "https://github.com/filda/sutrapad";
  repoLink.target = "_blank";
  repoLink.rel = "noopener";
  repoLink.textContent = "github.com/filda/sutrapad";
  sourceLine.append(repoLink);

  const tail = document.createElement("span");
  tail.textContent = " · MIT license.";
  sourceLine.append(tail);

  section.append(sourceLine);
  return section;
}

function buildFootCta(
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  const cta = document.createElement("div");
  cta.className = "static-foot-cta";

  const text = document.createElement("div");
  text.className = "static-foot-cta-text";
  const eyebrow = document.createElement("p");
  eyebrow.className = "static-foot-cta-eyebrow";
  eyebrow.textContent = "Ready to start?";
  text.append(eyebrow);
  const head = document.createElement("p");
  head.className = "static-foot-cta-head";
  head.textContent = "Open a notebook. Or read the privacy policy first.";
  text.append(head);
  cta.append(text);

  const actions = document.createElement("div");
  actions.className = "static-foot-cta-actions";

  const privacyButton = document.createElement("button");
  privacyButton.type = "button";
  privacyButton.className = "button button-ghost";
  privacyButton.textContent = "Privacy";
  privacyButton.addEventListener("click", () => onSelectMenuItem("privacy"));
  actions.append(privacyButton);

  const homeButton = document.createElement("button");
  homeButton.type = "button";
  homeButton.className = "button button-primary";
  homeButton.textContent = "Open Today →";
  homeButton.addEventListener("click", () => onSelectMenuItem("home"));
  actions.append(homeButton);

  cta.append(actions);
  return cta;
}

function buildHeading(text: string): HTMLHeadingElement {
  const heading = document.createElement("h2");
  heading.className = "static-h2";
  heading.textContent = text;
  return heading;
}

function buildParagraph(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "static-paragraph";
  p.textContent = text;
  return p;
}
