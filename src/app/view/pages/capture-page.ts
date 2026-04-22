import { buildBookmarklet } from "../../../lib/bookmarklet";
import { buildPageHeader } from "../shared/page-header";

/**
 * Dedicated Capture / Install page. Ports the handoff's `CaptureScreen`:
 * a platform picker (Chrome/Safari/iOS/Android), a stack of three-step
 * install instructions per platform, and a preview-browser mock that
 * shows what the Save button looks like in situ.
 *
 * Platform switching is kept lightweight: the active platform is tracked
 * as a `data-platform` attribute on the page root, and CSS selectors
 * flip the visible step card and tab pill. Nothing is re-rendered at the
 * app level — selecting a platform is a purely local concern.
 */

export interface CapturePageOptions {
  appRootUrl: string;
  iosShortcutUrl: string;
  /**
   * Message shown under the "Copy bookmarklet code" button (e.g. "Copied!"
   * once the clipboard write resolves). Empty string = no message. The
   * caller owns the state; the page just renders it.
   */
  bookmarkletMessage: string;
  onCopyBookmarklet: () => void;
}

type Platform = "chrome" | "safari" | "ios" | "android";

interface PlatformTab {
  id: Platform;
  label: string;
}

const PLATFORM_TABS: readonly PlatformTab[] = [
  { id: "chrome", label: "Chrome / Arc / Brave" },
  { id: "safari", label: "Safari" },
  { id: "ios", label: "iPhone / iPad" },
  { id: "android", label: "Android" },
];

export function buildCapturePage(options: CapturePageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "capture-page";
  // Default platform mirrors the handoff — Chrome-family covers the bulk
  // of desktop visitors, so showing its steps first minimises clicks for
  // the most common install path.
  section.dataset.platform = "chrome";

  section.append(
    buildPageHeader({
      eyebrow: "Capture · Install",
      titleHtml: "Send anything into <em>SutraPad</em>.",
      subtitle:
        "One button in your browser. One Shortcut on iOS. It just opens a pre-filled note.",
    }),
  );

  section.append(buildPlatformTabs(section));

  const grid = document.createElement("div");
  grid.className = "capture-grid";
  grid.append(buildStepsColumn(options));
  grid.append(buildPreviewColumn());
  section.append(grid);

  return section;
}

function buildPlatformTabs(root: HTMLElement): HTMLElement {
  const tabs = document.createElement("div");
  tabs.className = "platform-tabs";
  tabs.setAttribute("role", "tablist");

  const buttons: HTMLButtonElement[] = [];

  for (const tab of PLATFORM_TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "platform-tab";
    button.dataset.platform = tab.id;
    button.setAttribute("role", "tab");
    const active = root.dataset.platform === tab.id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.textContent = tab.label;
    button.addEventListener("click", () => selectPlatform(root, buttons, tab.id));
    tabs.append(button);
    buttons.push(button);
  }

  return tabs;
}

function selectPlatform(
  root: HTMLElement,
  buttons: readonly HTMLButtonElement[],
  id: Platform,
): void {
  root.dataset.platform = id;
  for (const button of buttons) {
    const active = button.dataset.platform === id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function buildStepsColumn(options: CapturePageOptions): HTMLElement {
  const column = document.createElement("div");
  column.className = "capture-steps";

  column.append(buildChromeSteps(options.appRootUrl));
  column.append(buildSafariSteps(options));
  column.append(buildIosSteps(options.iosShortcutUrl));
  column.append(buildAndroidSteps());

  return column;
}

function buildPlatformBlock(platform: Platform): HTMLElement {
  const block = document.createElement("div");
  block.className = "capture-platform";
  block.dataset.for = platform;
  return block;
}

function buildStepCard(
  step: number,
  head: string,
  body: (card: HTMLElement) => void,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "step-card";

  const header = document.createElement("div");
  header.className = "step-head";

  const num = document.createElement("span");
  num.className = "step-num";
  num.textContent = String(step);
  header.append(num);

  const headText = document.createElement("span");
  headText.className = "step-head-text";
  headText.textContent = head;
  header.append(headText);

  card.append(header);
  body(card);
  return card;
}

function buildStepParagraph(card: HTMLElement, html: string): void {
  const p = document.createElement("p");
  p.className = "step-text";
  p.innerHTML = html;
  card.append(p);
}

function buildChromeSteps(appRootUrl: string): HTMLElement {
  const block = buildPlatformBlock("chrome");

  block.append(
    buildStepCard(1, "Show your bookmarks bar", (card) => {
      buildStepParagraph(
        card,
        'Press <kbd class="kbd">⌘⇧B</kbd> (or <kbd class="kbd">Ctrl+Shift+B</kbd> on Windows) to make it visible.',
      );
    }),
  );

  block.append(
    buildStepCard(2, "Drag this button up there", (card) => {
      buildStepParagraph(
        card,
        "Grab and drop the button into your bookmarks bar.",
      );
      const drag = document.createElement("a");
      drag.className = "bookmarklet-drag";
      drag.href = buildBookmarklet(appRootUrl);
      drag.draggable = true;
      drag.textContent = "⚡ Save to SutraPad";
      // Prevent the click from navigating to javascript: on the install
      // page itself — clicking is how users test the bookmarklet once it
      // lives on the bar, but on this page a click shouldn't run it.
      drag.addEventListener("click", (event) => event.preventDefault());
      card.append(drag);
    }),
  );

  block.append(
    buildStepCard(3, "Click it on any page", (card) => {
      buildStepParagraph(
        card,
        "SutraPad opens with a new note prefilled with the URL, title and page context.",
      );
    }),
  );

  return block;
}

function buildSafariSteps(options: CapturePageOptions): HTMLElement {
  const block = buildPlatformBlock("safari");

  block.append(
    buildStepCard(1, "Make a throwaway bookmark", (card) => {
      buildStepParagraph(
        card,
        "Bookmark any page to your Favorites so there's something to edit.",
      );
    }),
  );

  block.append(
    buildStepCard(2, "Copy the bookmarklet code", (card) => {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "button";
      copy.textContent = "Copy code";
      copy.addEventListener("click", options.onCopyBookmarklet);
      card.append(copy);
      if (options.bookmarkletMessage) {
        const status = document.createElement("p");
        status.className = "step-status";
        status.textContent = options.bookmarkletMessage;
        card.append(status);
      }
      const code = document.createElement("div");
      code.className = "code-block";
      code.textContent = buildBookmarklet(options.appRootUrl);
      card.append(code);
    }),
  );

  block.append(
    buildStepCard(3, "Edit the bookmark's URL → paste", (card) => {
      buildStepParagraph(
        card,
        "Bookmarks → Edit → replace the URL. Rename it to <strong>Save to SutraPad</strong>.",
      );
    }),
  );

  return block;
}

function buildIosSteps(iosShortcutUrl: string): HTMLElement {
  const block = buildPlatformBlock("ios");

  block.append(
    buildStepCard(1, "Download the Shortcut", (card) => {
      const link = document.createElement("a");
      link.className = "button button-accent";
      link.href = iosShortcutUrl;
      link.download = "";
      link.textContent = "Get SutraPad Shortcut";
      card.append(link);
    }),
  );

  block.append(
    buildStepCard(2, "Add it to the Share Sheet", (card) => {
      buildStepParagraph(
        card,
        "Open the file, tap <strong>Add Shortcut</strong>, then enable <strong>Show in Share Sheet</strong>.",
      );
    }),
  );

  block.append(
    buildStepCard(3, "Share from any app", (card) => {
      buildStepParagraph(
        card,
        "Safari, Mail, Messages — tap Share → Send to SutraPad. Done.",
      );
    }),
  );

  return block;
}

function buildAndroidSteps(): HTMLElement {
  const block = buildPlatformBlock("android");

  block.append(
    buildStepCard(1, "Install SutraPad as a PWA", (card) => {
      buildStepParagraph(
        card,
        "In Chrome → menu → <strong>Install app</strong>. SutraPad then appears in your system share sheet.",
      );
    }),
  );

  block.append(
    buildStepCard(2, "Share from anywhere", (card) => {
      buildStepParagraph(
        card,
        "Any URL → Share → pick <strong>SutraPad</strong>. A new note opens, pre-filled.",
      );
    }),
  );

  return block;
}

function buildPreviewColumn(): HTMLElement {
  const column = document.createElement("div");
  column.className = "capture-preview";

  const browser = document.createElement("div");
  browser.className = "preview-browser";

  const chrome = document.createElement("div");
  chrome.className = "pb-chrome";
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span");
    dot.className = "pb-dot";
    chrome.append(dot);
  }
  const url = document.createElement("span");
  url.className = "pb-url";
  url.textContent = "https://www.example.com/an-article-you-want-to-keep";
  chrome.append(url);
  browser.append(chrome);

  const bar = document.createElement("div");
  bar.className = "pb-bar";
  const reading = document.createElement("span");
  reading.className = "pb-bm";
  reading.textContent = "📓 Reading list";
  bar.append(reading);
  const saveBm = document.createElement("span");
  saveBm.className = "pb-bm is-glow";
  saveBm.textContent = "⚡ Save to SutraPad";
  bar.append(saveBm);
  browser.append(bar);

  const body = document.createElement("div");
  body.className = "pb-body";
  body.innerHTML = `
    <p class="pb-eyebrow">The Example Review · 12 min read</p>
    <h3 class="pb-title">On walking as an operating system</h3>
    <div class="pb-hero" aria-hidden="true"></div>
    <p class="pb-excerpt">The pace of thought is set by the pace of the feet. Walking is not an interruption from writing — it is a subroutine the writing depends on to return to itself.</p>
  `;
  browser.append(body);

  column.append(browser);

  const caption = document.createElement("div");
  caption.className = "capture-caption";
  caption.innerHTML = `
    <p class="panel-eyebrow">When you click the bookmarklet</p>
    <p>SutraPad opens with a new note titled <strong>“On walking as an operating system”</strong>, the URL saved, and the page context — title, description, OG image, author, scroll position — attached to the note.</p>
  `;
  column.append(caption);

  return column;
}
