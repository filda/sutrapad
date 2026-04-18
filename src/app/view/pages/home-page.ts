import { buildBookmarklet } from "../../../lib/bookmarklet";
import type { UserProfile } from "../../../types";

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
  toggleBookmarkletHelper.onclick = onToggleBookmarkletHelper;
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
  copyBookmarkletButton.onclick = onCopyBookmarklet;

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

export interface HomePageOptions {
  profile: UserProfile | null;
  appRootUrl: string;
  bookmarkletHelperExpanded: boolean;
  bookmarkletMessage: string;
  iosShortcutUrl: string;
  onToggleBookmarkletHelper: () => void;
  onCopyBookmarklet: () => void;
}

export function buildHomePage({
  profile,
  appRootUrl,
  bookmarkletHelperExpanded,
  bookmarkletMessage,
  iosShortcutUrl,
  onToggleBookmarkletHelper,
  onCopyBookmarklet,
}: HomePageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "home-page";

  const heroIntro = document.createElement("div");
  heroIntro.className = "hero-intro";
  heroIntro.innerHTML = `
    <h1>notes & links</h1>
    <p class="lede">Store and manage your <em>Gerümpel</em> on <a href="https://drive.google.com/drive/home" target="_blank" rel="noreferrer">Google Drive</a> — powered entirely by browser magic, questionable decisions, and multiple JSON files.</p>
  `;
  section.append(heroIntro);

  if (!profile) {
    const heroCard = document.createElement("div");
    heroCard.className = "hero-card";

    const info = document.createElement("p");
    info.textContent =
      "You can write immediately in a local notebook. Sign in only when you want to sync with Google Drive.";

    heroCard.append(info);
    section.append(heroCard);
  }

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
