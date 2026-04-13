export interface UrlCapturePayload {
  title?: string;
  url: string;
}

export function readUrlCapture(urlString: string): UrlCapturePayload | null {
  const currentUrl = new URL(urlString);
  const capturedUrl = currentUrl.searchParams.get("url");

  if (!capturedUrl) {
    return null;
  }

  try {
    const normalizedUrl = new URL(capturedUrl).toString();
    const title = currentUrl.searchParams.get("title")?.trim() || undefined;
    return {
      title,
      url: normalizedUrl,
    };
  } catch {
    return null;
  }
}

export function clearUrlCaptureFromLocation(urlString: string): string {
  const currentUrl = new URL(urlString);
  currentUrl.searchParams.delete("url");
  currentUrl.searchParams.delete("title");
  return currentUrl.toString();
}

export function deriveTitleFromUrl(urlString: string): string {
  const url = new URL(urlString);
  const host = url.hostname.replace(/^www\./, "");
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const lastSegment = pathSegments.at(-1);

  if (!lastSegment) {
    return host;
  }

  const decodedSegment = decodeURIComponent(lastSegment)
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim();

  return decodedSegment ? `${decodedSegment} · ${host}` : host;
}

export function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (!match) {
    return null;
  }

  const normalized = match[1]
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  return normalized || null;
}

export async function resolveTitleFromUrl(urlString: string): Promise<string | null> {
  try {
    const response = await fetch(urlString);
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return extractHtmlTitle(html);
  } catch {
    return null;
  }
}
