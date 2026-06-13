// @vitest-environment happy-dom
//
// DOM tests for the inline text-fragment builders that replaced the
// `buildStepParagraph(card, html)` / `p.innerHTML` sink on the Capture page.
//
// The guarantee under test: every builder produces a DOM node whose content
// is set as text, so any dynamic value rendered through them is inert — the
// HTML parser is never invoked.

import { describe, expect, it } from "vitest";

import { kbd, strong, text } from "../src/app/view/shared/inline";

describe("inline fragment builders", () => {
  it("text() returns a text node with the verbatim value", () => {
    const node = text("Press ");
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe("Press ");
  });

  it("kbd() returns a <kbd class=\"kbd\"> with the label as text", () => {
    const el = kbd("Ctrl+Shift+B");
    expect(el.tagName.toLowerCase()).toBe("kbd");
    expect(el.className).toBe("kbd");
    expect(el.textContent).toBe("Ctrl+Shift+B");
    expect(el.children).toHaveLength(0);
  });

  it("strong() returns a <strong> with the value as text", () => {
    const el = strong("Save to SutraPad");
    expect(el.tagName.toLowerCase()).toBe("strong");
    expect(el.textContent).toBe("Save to SutraPad");
    expect(el.children).toHaveLength(0);
  });

  it("renders hostile values as inert text, not markup", () => {
    const host = document.createElement("p");
    host.append(
      text("<img src=x onerror=alert(1)>"),
      kbd("<script>evil()</script>"),
      strong("<svg onload=alert(1)>"),
    );
    // No injected elements — only the <kbd> and <strong> we built.
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("svg")).toBeNull();
    expect(host.children).toHaveLength(2); // kbd + strong only
    expect(host.textContent).toBe(
      "<img src=x onerror=alert(1)><script>evil()</script><svg onload=alert(1)>",
    );
  });
});
