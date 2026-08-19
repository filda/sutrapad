// @vitest-environment happy-dom
//
// First focused test for `src/app/view/pages/capture-page.ts` — the install
// page. 386 lines of mostly static copy, which is exactly why it was left
// unmeasured, and exactly why it is worth pinning: this page *is* its copy.
// If a step's instructions drift, or the bookmarklet href stops being the
// bookmarklet, the app still renders perfectly and the feature is simply
// uninstallable. The smoke test only ever visited it in its default state.
//
// Three things carry real behaviour behind the copy:
//   - the platform tabs, which flip `data-platform` on the page root plus the
//     `is-active` / `aria-selected` pair on the pills (the CSS does the rest,
//     so the attributes *are* the feature);
//   - the bookmarklet href and code block, which have to be the real
//     `javascript:` payload for the drag-and-drop install to work at all;
//   - the copy-code button and its optional status line.
//
// Copy assertions are kept to the load-bearing sentences (what the user has to
// do, and the keyboard shortcuts they have to press) rather than every word,
// so a rewording that keeps the meaning does not fail the suite — but a step
// that loses its shortcut or its "drag this" instruction does.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCapturePage } from "../src/app/view/pages/capture-page";

const APP_ROOT = "https://sutrapad.example/";
const IOS_SHORTCUT = "/shortcuts/sutrapad.shortcut";

function mount(overrides: { bookmarkletMessage?: string } = {}) {
  const onCopyBookmarklet = vi.fn();
  const page = buildCapturePage({
    appRootUrl: APP_ROOT,
    iosShortcutUrl: IOS_SHORTCUT,
    bookmarkletMessage: overrides.bookmarkletMessage ?? "",
    onCopyBookmarklet,
  });
  document.body.append(page);

  const tabs = () => [...page.querySelectorAll<HTMLButtonElement>(".platform-tab")];
  const block = (platform: string) =>
    page.querySelector<HTMLElement>(`.capture-platform[data-for="${platform}"]`);
  /** Step head texts for one platform, in render order. */
  const steps = (platform: string) =>
    [...(block(platform)?.querySelectorAll(".step-head-text") ?? [])].map(
      (node) => node.textContent,
    );
  /** Paragraph copy for one platform, in render order. */
  const paragraphs = (platform: string) =>
    [...(block(platform)?.querySelectorAll(".step-text") ?? [])].map(
      (node) => node.textContent,
    );
  const stepNumbers = (platform: string) =>
    [...(block(platform)?.querySelectorAll(".step-num") ?? [])].map(
      (node) => node.textContent,
    );

  return { page, onCopyBookmarklet, tabs, block, steps, stepNumbers, paragraphs };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("buildCapturePage shell", () => {
  it("opens on the Chrome family, the most common install path", () => {
    const { page, tabs } = mount();

    expect(page.className).toBe("capture-page");
    expect(page.dataset.platform).toBe("chrome");
    expect(tabs()[0].classList.contains("is-active")).toBe(true);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs().slice(1).map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "false",
    ]);
  });

  it("offers all four platforms as a tablist", () => {
    const { page, tabs } = mount();

    expect(page.querySelector(".platform-tabs")?.getAttribute("role")).toBe("tablist");
    expect(tabs().map((tab) => tab.dataset.platform)).toEqual([
      "chrome",
      "safari",
      "ios",
      "android",
    ]);
    expect(tabs().map((tab) => tab.textContent)).toEqual([
      "Chrome / Arc / Brave",
      "Safari",
      "iPhone / iPad",
      "Android",
    ]);
    expect(tabs().every((tab) => tab.getAttribute("role") === "tab")).toBe(true);
  });

  it("renders the header copy and both columns", () => {
    const { page } = mount();

    expect(page.querySelector(".page-eyebrow-label")?.textContent).toBe("Capture · Install");
    expect(page.querySelector(".page-title")?.textContent).toBe(
      "Send anything into SutraPad.",
    );
    expect(page.querySelector(".page-subtitle")?.textContent).toBe(
      "One button in your browser. One Shortcut on iOS. It just opens a pre-filled note.",
    );
    expect(page.querySelector(".capture-grid .capture-steps")).not.toBeNull();
    expect(page.querySelector(".capture-grid .capture-preview")).not.toBeNull();
  });

  it("identifies itself to the intro store so its header fades on its own count", () => {
    // `buildPageHeader` persists the visit count per `pageId`. A blank or
    // shared id would make this page inherit another page's fade state — the
    // install instructions would be folded away on a first visit.
    mount();

    const store = JSON.parse(localStorage.getItem("sp.intros.v1") ?? "{}");
    expect(Object.keys(store)).toEqual(["capture"]);
    expect(store.capture.visits).toBe(1);
  });

  it("builds every step as a numbered card with a paragraph slot", () => {
    const { page } = mount();

    // 3 + 3 + 3 + 2 across the four platforms.
    expect(page.querySelectorAll(".capture-steps .step-card")).toHaveLength(11);
    expect(page.querySelectorAll(".capture-steps .step-head")).toHaveLength(11);
    expect(page.querySelectorAll(".capture-steps .step-text").length).toBeGreaterThan(0);
  });

  it("ships every platform's steps at once so the CSS can switch between them", () => {
    // Nothing re-renders on a tab click, so all four blocks have to be in the
    // DOM from the start — a lazily-built block would show an empty card.
    const { page } = mount();

    expect(
      [...page.querySelectorAll<HTMLElement>(".capture-platform")].map(
        (node) => node.dataset.for,
      ),
    ).toEqual(["chrome", "safari", "ios", "android"]);
  });
});

describe("buildCapturePage platform switching", () => {
  it("moves the active state to the clicked platform", () => {
    const { page, tabs } = mount();

    tabs()[2].click();

    expect(page.dataset.platform).toBe("ios");
    expect(tabs().map((tab) => tab.classList.contains("is-active"))).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
  });

  it("keeps exactly one platform active across repeated switches", () => {
    const { page, tabs } = mount();

    tabs()[1].click();
    tabs()[3].click();

    expect(page.dataset.platform).toBe("android");
    expect(tabs().filter((tab) => tab.classList.contains("is-active"))).toHaveLength(1);
    expect(
      tabs().filter((tab) => tab.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
  });

  it("stays put when the already-active platform is clicked again", () => {
    const { page, tabs } = mount();

    tabs()[0].click();

    expect(page.dataset.platform).toBe("chrome");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });
});

describe("buildCapturePage Chrome steps", () => {
  it("numbers its three steps and names each one", () => {
    const { steps, stepNumbers } = mount();

    expect(stepNumbers("chrome")).toEqual(["1", "2", "3"]);
    expect(steps("chrome")).toEqual([
      "Show your bookmarks bar",
      "Drag this button up there",
      "Click it on any page",
    ]);
  });

  it("spells out both keyboard shortcuts for showing the bar", () => {
    // Two platforms, two shortcuts — dropping either leaves half the users
    // unable to complete step 1.
    const { block, paragraphs } = mount();
    const shortcuts = [...(block("chrome")?.querySelectorAll("kbd") ?? [])].map(
      (node) => node.textContent,
    );

    expect(shortcuts).toEqual(["⌘⇧B", "Ctrl+Shift+B"]);
    expect(paragraphs("chrome")).toEqual([
      "Press ⌘⇧B (or Ctrl+Shift+B on Windows) to make it visible.",
      "Grab and drop the button into your bookmarks bar.",
      "SutraPad opens with a new note prefilled with the URL, title and page context.",
    ]);
  });

  it("makes the draggable button a real bookmarklet", () => {
    const { block } = mount();
    const drag = block("chrome")?.querySelector<HTMLAnchorElement>(".bookmarklet-drag");

    expect(drag?.draggable).toBe(true);
    expect(drag?.textContent).toBe("⚡ Save to SutraPad");
    expect(drag?.getAttribute("href")).toMatch(/^javascript:/u);
    // The payload has to point back at this deployment, not a hard-coded host.
    // `buildBookmarklet` embeds the origin as a JSON string literal inside the
    // `javascript:` code, so it appears verbatim rather than percent-encoded.
    expect(drag?.getAttribute("href")).toContain(APP_ROOT);
  });

  it("does not run the bookmarklet when it is clicked on the install page", () => {
    // Clicking is how users test it once it lives on the bar; here it would
    // navigate the install page to a `javascript:` URL.
    const { block } = mount();
    const drag = block("chrome")?.querySelector<HTMLAnchorElement>(".bookmarklet-drag");
    const event = new MouseEvent("click", { cancelable: true, bubbles: true });

    drag?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("buildCapturePage Safari steps", () => {
  it("numbers its three steps and names each one", () => {
    const { steps, stepNumbers } = mount();

    expect(stepNumbers("safari")).toEqual(["1", "2", "3"]);
    expect(steps("safari")).toEqual([
      "Make a throwaway bookmark",
      "Copy the bookmarklet code",
      "Edit the bookmark's URL → paste",
    ]);
  });

  it("shows the bookmarklet code verbatim for pasting", () => {
    const { block } = mount();
    const code = block("safari")?.querySelector(".code-block");

    expect(code?.textContent).toMatch(/^javascript:/u);
    expect(code?.textContent).toContain(APP_ROOT);
  });

  it("hands the copy button straight to the caller", () => {
    const { block, onCopyBookmarklet } = mount();

    const copy = block("safari")?.querySelector<HTMLButtonElement>("button.button");
    expect(copy?.textContent).toBe("Copy code");

    copy?.click();

    expect(onCopyBookmarklet).toHaveBeenCalledOnce();
  });

  it("shows no status line until the caller has something to say", () => {
    const { block } = mount();

    expect(block("safari")?.querySelector(".step-status")).toBeNull();
  });

  it("renders the caller's status message under the button", () => {
    const { block } = mount({ bookmarkletMessage: "Bookmarklet copied." });
    const status = block("safari")?.querySelector(".step-status");

    expect(status?.textContent).toBe("Bookmarklet copied.");
    // Order matters: the confirmation belongs next to the button that caused
    // it, above the code block it refers to.
    expect(status?.nextElementSibling?.className).toBe("code-block");
  });

  it("names the bookmark the user should end up with", () => {
    const { block, paragraphs } = mount();

    expect(block("safari")?.querySelector("strong")?.textContent).toBe("Save to SutraPad");
    expect(paragraphs("safari")).toEqual([
      "Bookmark any page to your Favorites so there's something to edit.",
      "Bookmarks → Edit → replace the URL. Rename it to Save to SutraPad.",
    ]);
  });
});

describe("buildCapturePage iOS steps", () => {
  it("numbers its three steps and names each one", () => {
    const { steps, stepNumbers } = mount();

    expect(stepNumbers("ios")).toEqual(["1", "2", "3"]);
    expect(steps("ios")).toEqual([
      "Download the Shortcut",
      "Add it to the Share Sheet",
      "Share from any app",
    ]);
  });

  it("offers the Shortcut as a download from the caller's URL", () => {
    const { block } = mount();
    const link = block("ios")?.querySelector<HTMLAnchorElement>("a.button");

    expect(link?.getAttribute("href")).toBe(IOS_SHORTCUT);
    // Empty `download` = "keep the server's filename". A value here would
    // rename the Shortcut file and iOS would refuse to open it.
    expect(link?.getAttribute("download")).toBe("");
    expect(link?.textContent).toBe("Get SutraPad Shortcut");
    expect(link?.className).toContain("button-accent");
  });

  it("names both taps the Shortcut install needs", () => {
    // "Add Shortcut" then "Show in Share Sheet" — skipping the second one
    // installs a Shortcut the user can never reach from Safari.
    const { block, paragraphs } = mount();
    const emphasised = [...(block("ios")?.querySelectorAll("strong") ?? [])].map(
      (node) => node.textContent,
    );

    expect(emphasised).toEqual(["Add Shortcut", "Show in Share Sheet"]);
    expect(paragraphs("ios")).toEqual([
      "Open the file, tap Add Shortcut, then enable Show in Share Sheet.",
      "Safari, Mail, Messages — tap Share → Send to SutraPad. Done.",
    ]);
  });
});

describe("buildCapturePage Android steps", () => {
  it("has two steps, not three", () => {
    // The PWA install replaces the bookmarklet dance entirely, so Android is
    // deliberately shorter than the rest.
    const { steps, stepNumbers } = mount();

    expect(stepNumbers("android")).toEqual(["1", "2"]);
    expect(steps("android")).toEqual([
      "Install SutraPad as a PWA",
      "Share from anywhere",
    ]);
  });

  it("names the Chrome menu item and the share target", () => {
    const { block, paragraphs } = mount();
    const emphasised = [...(block("android")?.querySelectorAll("strong") ?? [])].map(
      (node) => node.textContent,
    );

    expect(emphasised).toEqual(["Install app", "SutraPad"]);
    expect(paragraphs("android")).toEqual([
      "In Chrome → menu → Install app. SutraPad then appears in your system share sheet.",
      "Any URL → Share → pick SutraPad. A new note opens, pre-filled.",
    ]);
  });
});

describe("buildCapturePage preview mock", () => {
  it("draws a browser frame with three window dots and a URL", () => {
    const { page } = mount();
    const chrome = page.querySelector(".preview-browser .pb-chrome");

    expect(chrome?.querySelectorAll(".pb-dot")).toHaveLength(3);
    expect(chrome?.querySelector(".pb-url")?.textContent).toContain("example.com");
  });

  it("glows only the SutraPad bookmark on the mock bookmarks bar", () => {
    // The glow is the whole point of the mock: it shows the user what they are
    // about to install, next to an ordinary bookmark for contrast.
    const { page } = mount();
    const bookmarks = [...page.querySelectorAll<HTMLElement>(".pb-bar .pb-bm")];

    expect(bookmarks.map((node) => node.textContent)).toEqual([
      "📓 Reading list",
      "⚡ Save to SutraPad",
    ]);
    expect(bookmarks.map((node) => node.classList.contains("is-glow"))).toEqual([
      false,
      true,
    ]);
  });

  it("renders the mock article and hides its decorative hero", () => {
    const { page } = mount();
    const body = page.querySelector(".pb-body");

    expect(body?.querySelector(".pb-title")?.textContent).toBe(
      "On walking as an operating system",
    );
    expect(body?.querySelector(".pb-eyebrow")?.textContent).toContain("12 min read");
    expect(body?.querySelector(".pb-hero")?.getAttribute("aria-hidden")).toBe("true");
    expect(body?.querySelector(".pb-excerpt")?.textContent).toContain("pace of thought");
  });

  it("quotes the mock article's title in the caption", () => {
    // The caption explains the screenshot above it; a mismatch between the two
    // titles makes the example incoherent.
    const { page } = mount();
    const caption = page.querySelector(".capture-caption");

    expect(caption?.querySelector(".panel-eyebrow")?.textContent).toBe(
      "When you click the bookmarklet",
    );
    expect(caption?.querySelector("strong")?.textContent).toBe(
      "“On walking as an operating system”",
    );
    expect(caption?.querySelectorAll("p")[1]?.textContent).toBe(
      "SutraPad opens with a new note titled “On walking as an operating system”, " +
        "the URL saved, and the page context — title, description, OG image, author, " +
        "scroll position — attached to the note.",
    );
  });
});
