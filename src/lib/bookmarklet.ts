export function buildBookmarklet(appUrl: string): string {
  const target = new URL(appUrl);
  target.search = "";
  target.hash = "";

  const bookmarkletCode = `
    (() => {
      const target = new URL(${JSON.stringify(target.toString())});
      target.searchParams.set("url", window.location.href);
      if (document.title) {
        target.searchParams.set("title", document.title);
      }
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
