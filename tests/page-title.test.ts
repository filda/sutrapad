// @vitest-environment happy-dom
//
// DOM tests for the structured page-title renderer that replaced the old
// `titleHtml: string` / `innerHTML` slots on `page-header.ts` and
// `static-page-shell.ts`.
//
// The security-relevant guarantee is that no title part is ever parsed as
// HTML: `before`/`after` become text nodes, `emphasis` becomes a single
// `<em>` whose text is set via `textContent`. These tests pin both the
// happy-path structure and that hostile input in any slot renders as inert
// text rather than executable DOM.

import { beforeEach, describe, expect, it } from "vitest";

import { appendPageTitle } from "../src/app/view/shared/page-title";

function heading(): HTMLElement {
  return document.createElement("h1");
}

describe("appendPageTitle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders before + <em>emphasis</em> + after as DOM nodes", () => {
    const h = heading();
    appendPageTitle(h, {
      before: "A ",
      emphasis: "library",
      after: " of links.",
    });

    expect(h.textContent).toBe("A library of links.");
    const em = h.querySelector("em");
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe("library");
    // Exactly one element child — the <em>; the rest are text nodes.
    expect(h.children).toHaveLength(1);
    expect(h.childNodes).toHaveLength(3);
    expect(h.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(h.childNodes[2]?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("omits the before text node when before is absent or empty", () => {
    const h = heading();
    appendPageTitle(h, { emphasis: "threads", after: "." });
    expect(h.textContent).toBe("threads.");
    expect(h.childNodes[0]?.nodeName.toLowerCase()).toBe("em");

    const h2 = heading();
    appendPageTitle(h2, { before: "", emphasis: "x" });
    // Empty before is falsy → no leading text node.
    expect(h2.childNodes).toHaveLength(1);
    expect(h2.childNodes[0]?.nodeName.toLowerCase()).toBe("em");
  });

  it("omits the after text node when after is absent or empty", () => {
    const h = heading();
    appendPageTitle(h, { before: "The ", emphasis: "handshake." });
    expect(h.textContent).toBe("The handshake.");
    expect(h.childNodes).toHaveLength(2);
    expect(h.childNodes[1]?.nodeName.toLowerCase()).toBe("em");
  });

  it("renders a plain string title via textContent only", () => {
    const h = heading();
    appendPageTitle(h, "Privacy");
    expect(h.textContent).toBe("Privacy");
    expect(h.children).toHaveLength(0);
    expect(h.querySelector("em")).toBeNull();
  });

  it("renders a hostile emphasis as inert text, not markup", () => {
    const h = heading();
    appendPageTitle(h, { emphasis: "<img src=x onerror=alert(1)>" });
    // The payload lands as the <em>'s text — no <img> element is created.
    expect(h.querySelector("img")).toBeNull();
    const em = h.querySelector("em");
    expect(em?.children).toHaveLength(0);
    expect(em?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("renders a hostile profile name in the after slot as inert text", () => {
    const h = heading();
    // Mirrors the Home greeting: `after` carries the user-controlled name.
    appendPageTitle(h, {
      before: "Good ",
      emphasis: "morning",
      after: ", <script>steal(token)</script>.",
    });
    expect(h.querySelector("script")).toBeNull();
    expect(h.children).toHaveLength(1); // only the <em>
    expect(h.textContent).toBe("Good morning, <script>steal(token)</script>.");
  });

  it("renders a hostile before slot as inert text", () => {
    const h = heading();
    appendPageTitle(h, {
      before: "<svg onload=alert(1)>",
      emphasis: "x",
    });
    expect(h.querySelector("svg")).toBeNull();
    expect(h.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(h.textContent).toBe("<svg onload=alert(1)>x");
  });
});
