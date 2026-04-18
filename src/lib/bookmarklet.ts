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
      const target = new URL(${JSON.stringify(target.toString())});
      target.searchParams.set("url", window.location.href);
      if (document.title) {
        target.searchParams.set("title", document.title);
      }
      target.searchParams.set("capture", JSON.stringify(capture));
      const finalUrl = target.toString();
      const opened = window.open(finalUrl, "_blank");
      if (opened) {
        opened.opener = null;
      } else {
        window.location.href = finalUrl;
      }
    })();
  `;

  return `javascript:${bookmarkletCode.replace(/\s+/g, " ").trim()}`;
}
