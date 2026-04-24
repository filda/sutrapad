/**
 * Builds the SutraPad bookmarklet — a single-line `javascript:` URL the
 * user drags into their browser bookmarks bar. Clicking it on any page
 * captures that page's URL + scraped metadata (and any selected text)
 * into SutraPad.
 *
 * Flow: open SutraPad in a new tab with `?silent=1`. The app boots,
 * detects the silent flag, processes the capture, saves to Drive, and
 * `window.close()`s itself. The user's source page stays focused
 * (browsers return focus to the opener tab on close) and never gets
 * redirected.
 *
 * If anything in the silent runner fails (no auth, save error), the
 * tab stays open and falls through to the normal app flow so the user
 * can sign in / inspect / retry. Capture always works in some form.
 *
 * The bookmarklet code is built as a template literal here, then
 * stripped of whitespace and prefixed with `javascript:` so the whole
 * thing fits on a single line — required by every browser's bookmark
 * format.
 */
export function buildBookmarklet(appUrl: string): string {
  const target = new URL(appUrl);
  target.search = "";
  target.hash = "";

  const bookmarkletCode = `
    (() => {
      const readMetaContent = (selector) =>
        document.querySelector(selector)?.getAttribute("content")?.trim() || "";
      const scrollableHeight = Math.max(
        (document.documentElement?.scrollHeight || 0) - window.innerHeight,
        0,
      );
      const capture = {
        referrer: document.referrer || undefined,
        scroll: {
          x: window.scrollX || 0,
          y: window.scrollY || 0,
          progress: scrollableHeight > 0 ? Math.min(Math.max((window.scrollY || 0) / scrollableHeight, 0), 1) : 0,
        },
        timeOnPageMs: typeof performance?.now === "function" ? Math.round(performance.now()) : undefined,
        page: {
          title: document.title || undefined,
          lang: document.documentElement?.lang || undefined,
          description: readMetaContent("meta[name='description']") || undefined,
          canonicalUrl: document.querySelector("link[rel='canonical']")?.getAttribute("href")?.trim() || undefined,
          ogTitle: readMetaContent("meta[property='og:title']") || undefined,
          ogDescription: readMetaContent("meta[property='og:description']") || undefined,
          ogImage: readMetaContent("meta[property='og:image']") || undefined,
          author: readMetaContent("meta[name='author']") || undefined,
          publishedTime: readMetaContent("meta[property='article:published_time']") || undefined,
        },
      };
      const selection = (window.getSelection && window.getSelection()?.toString()) || "";
      const target = new URL(${JSON.stringify(target.toString())});
      target.searchParams.set("url", window.location.href);
      if (document.title) {
        target.searchParams.set("title", document.title);
      }
      target.searchParams.set("capture", JSON.stringify(capture));
      if (selection.trim()) {
        target.searchParams.set("selection", selection);
      }
      target.searchParams.set("silent", "1");
      const finalUrl = target.toString();
      const opened = window.open(finalUrl, "_blank");
      if (!opened) {
        window.location.href = finalUrl;
      }
    })();
  `;

  return `javascript:${bookmarkletCode.replace(/\s+/g, " ").trim()}`;
}
