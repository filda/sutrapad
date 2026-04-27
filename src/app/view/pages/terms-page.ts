/**
 * Terms of use — short, plain-language ToS modelled after the v3 design
 * handoff (`extracted/13_footer_static_pages.jsx`, `TermsScreen`). Five
 * numbered sections framed as a "handshake": small set of reasonable
 * obligations, MIT-style as-is software clause, governing law (Czech).
 *
 * **Not legal advice.** This is the application's own Terms surface; it
 * mirrors what the v3 prototype shipped. Filip will need a lawyer pass
 * before public launch — until then the file lives as the in-app
 * presentation of the same draft, kept in sync with whatever copy gets
 * blessed.
 *
 * **All textual content is set via `textContent`** (with the lone
 * exception of the page title's `<em>` emphasis, which goes through the
 * shell's `titleHtml` slot — caller-escapes-everything contract).
 */

import { buildStaticPageShell } from "../chrome/static-page-shell";
import type { MenuItemId } from "../../logic/menu";

export interface TermsPageOptions {
  onSelectMenuItem: (id: MenuItemId) => void;
}

interface TermsClause {
  heading: string;
  body: string;
}

/**
 * Numbered clauses, in display order. The headings include the leading
 * number so they read consistently when the user scans the page outside
 * the in-app context (e.g. after copying selection into an email).
 */
const CLAUSES: readonly TermsClause[] = [
  {
    heading: "1. Your notes are yours",
    body:
      "You own everything you write in Sutrapad. We claim no license, no copyright, no editorial control.",
  },
  {
    heading: "2. The software is as-is",
    body:
      "Sutrapad is provided without warranty of any kind. If it eats your notes — and it shouldn't, but software is software — we are sorry, but we cannot be held liable.",
  },
  {
    heading: "3. Don't use Sutrapad for harm",
    body:
      "Don't use the capture system to scrape sites at scale. Don't use Sutrapad to organise material that's illegal where you live. Common sense.",
  },
  {
    heading: "4. We can change these terms",
    body:
      "If we change anything material, we'll surface it as a banner the next time you open Sutrapad — not as an email blast.",
  },
  {
    heading: "5. Governing law",
    body:
      "Czech law, with a soft spot for common sense. Disputes go to the courts of Praha.",
  },
];

export function buildTermsPage({
  onSelectMenuItem,
}: TermsPageOptions): HTMLElement {
  const content: Node[] = [];
  for (const clause of CLAUSES) {
    content.push(buildClauseSection(clause));
  }
  content.push(buildFootCta(onSelectMenuItem));

  return buildStaticPageShell({
    eyebrow: "Terms of use",
    titleHtml: "The <em>handshake.</em>",
    subtitle:
      "By using Sutrapad you agree to a small number of reasonable things. Here they are.",
    lastUpdated: "April 2026",
    content,
    onSelectMenuItem,
  });
}

function buildClauseSection(clause: TermsClause): HTMLElement {
  const section = document.createElement("section");
  section.className = "static-section";

  const heading = document.createElement("h2");
  heading.className = "static-h2";
  heading.textContent = clause.heading;
  section.append(heading);

  const body = document.createElement("p");
  body.className = "static-paragraph";
  body.textContent = clause.body;
  section.append(body);

  return section;
}

function buildFootCta(
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  const cta = document.createElement("div");
  cta.className = "static-foot-cta";

  const text = document.createElement("p");
  text.className = "static-foot-cta-text muted";
  // Italic emphasis on the closing thought; we set it as a plain string
  // here (no innerHTML) and let the CSS apply emphasis via class — the
  // visual italic comes from `.static-foot-cta-emphasis` so user-controlled
  // strings can never sneak through.
  const lead = document.createElement("span");
  lead.textContent = "In a phrase: ";
  text.append(lead);
  const emphasis = document.createElement("em");
  emphasis.className = "static-foot-cta-emphasis";
  emphasis.textContent = "be kind, take your data with you.";
  text.append(emphasis);
  cta.append(text);

  const actions = document.createElement("div");
  actions.className = "static-foot-cta-actions";

  const homeButton = document.createElement("button");
  homeButton.type = "button";
  homeButton.className = "button button-primary";
  homeButton.textContent = "Back to Today";
  homeButton.addEventListener("click", () => onSelectMenuItem("home"));
  actions.append(homeButton);

  cta.append(actions);
  return cta;
}
