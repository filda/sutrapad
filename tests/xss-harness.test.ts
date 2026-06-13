// @vitest-environment happy-dom
//
// Token-leak / XSS regression harness (hardening plan, item 11).
//
// Models the realistic attack class the whole plan defends against:
// attacker-controlled note data — synced from another device, a hand-edited
// Drive file, or a hostile capture — tries to execute JavaScript on the
// SutraPad origin, which is the precondition for stealing the live Google
// access token. We render the surfaces that show the most note-derived data
// through the real page builders and assert the output contains no executable
// sink (no parser-built <script>/<iframe>, no inline `on*` handler, no
// `javascript:` / `data:` navigable target). A future change that routes
// attacker content through an HTML / href / script sink fails here, even if
// the per-component test for that sink is missed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";
import { buildNotesList } from "../src/app/view/shared/notes-list";
import { buildLinksPage } from "../src/app/view/pages/links-page";

const HTML_PAYLOAD = '<img src=x onerror="globalThis.xssSentinel = true">';
const JS_URL = "javascript:globalThis.xssSentinel = true";

function hostileNote(): SutraPadDocument {
  return {
    id: "evil",
    title: `${HTML_PAYLOAD} headline`,
    body: `${HTML_PAYLOAD}\n- [ ] ${HTML_PAYLOAD}\nhttps://ok.example/x`,
    tags: [HTML_PAYLOAD, "reading", "<script>globalThis.xssSentinel = true</script>"],
    urls: ["https://ok.example/x", JS_URL, "data:text/html,<script>1</script>"],
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
  };
}

function assertNoExecutableSinks(root: ParentNode): void {
  // No parser-built executable / embedding elements.
  expect(root.querySelector("script, iframe, object, embed")).toBeNull();

  // No inline event-handler attributes smuggled in via markup. Real
  // handlers are wired with addEventListener, so a legitimate render never
  // carries an `on*` attribute — only injected markup would.
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
    }
  }

  // No navigable `javascript:` / `data:` targets.
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = anchor.getAttribute("href")?.toLowerCase() ?? "";
    expect(href.startsWith("javascript:")).toBe(false);
    expect(href.startsWith("data:")).toBe(false);
  }
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).xssSentinel;
  // Keep stray favicon / og:image fetches deterministic and quiet.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("XSS / token-leak regression harness", () => {
  it("renders hostile note fields in the notes list as inert text", () => {
    const note = hostileNote();
    const list = buildNotesList(note.id, [note], vi.fn(), "list", {
      allNotes: [note],
      dark: false,
    });
    document.body.append(list);

    assertNoExecutableSinks(list);
    // The payload survives as visible text (escaped) — proving it rendered
    // rather than being silently dropped — without ever executing.
    expect(list.textContent).toContain("onerror");
    expect((globalThis as Record<string, unknown>).xssSentinel).toBeUndefined();
  });

  it("renders hostile URLs/tags on the links page without a clickable javascript: sink", () => {
    const note = hostileNote();
    const workspace: SutraPadWorkspace = { notes: [note], activeNoteId: note.id };
    const page = buildLinksPage({
      workspace,
      selectedTagFilters: [],
      linksViewMode: "list",
      onOpenNote: vi.fn(),
      onOpenCapture: vi.fn(),
      onChangeLinksView: vi.fn(),
      onClearTagFilters: vi.fn(),
    });
    document.body.append(page);

    assertNoExecutableSinks(page);
    expect((globalThis as Record<string, unknown>).xssSentinel).toBeUndefined();
  });
});
