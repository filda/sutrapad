/**
 * Guard: every `src/` module that reads a note's `body` must say how it
 * behaves for a Phase 2 placeholder (`hydrated: false`, `body: ""`).
 *
 * The 2026-09-07 incident was three separate places treating "empty body"
 * as "the user wrote nothing" — `isEmptyDraftNote`, the persisted task
 * index, the og:image prewarm — after a new note state made that reading
 * wrong. The `hydrated` flag is opt-in: a reader that forgets it silently
 * keeps the old behaviour. This test makes forgetting loud. A new reader
 * fails until it is listed here with one of:
 *
 *   - `guarded`  — the code checks `hydrated === false` (or is only ever
 *                  reached with a hydrated note by construction, say so);
 *   - `harmless` — a placeholder produces a degraded but safe result
 *                  (a blank stat, a missing decoration), never a write.
 *
 * "Writes an empty body somewhere" is never harmless; that reader must be
 * guarded. Same shape as `tests/mutate-scope.test.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Identifiers that hold a note in this codebase, read through `.body`. */
const BODY_READ = /\b(?:note|displayedNote|targetNote|other|current|candidate|doc)\.body\b/u;

type Verdict = "guarded" | "harmless";

const BODY_READERS: Readonly<Record<string, { verdict: Verdict; reason: string }>> = {
  "src/lib/notebook.ts": {
    verdict: "guarded",
    reason:
      "isEmptyDraftNote returns false for hydrated === false (the incident fix); upsertNote refuses edits on a placeholder; isPristineWorkspace/areWorkspacesEqual compare bodies as data; capture writers only ever build fresh notes.",
  },
  "src/lib/tasks.ts": {
    verdict: "guarded",
    reason:
      "parseTasksFromNote scans the body; reconcileTaskIndexForWorkspace carries a placeholder's entries forward instead of calling it, and saveWorkspace goes through that path.",
  },
  "src/lib/note-card-meta.ts": {
    verdict: "guarded",
    reason:
      "buildNoteSummary derives headline/excerpt from the body; reconcileNoteSummaries and saveNoteFile both carry a placeholder's existing summary forward instead of rebuilding it.",
  },
  "src/services/drive/save-policy.ts": {
    verdict: "guarded",
    reason: "findBlankedNotes skips hydrated === false explicitly — placeholders are never uploaded.",
  },
  "src/app/logic/note-edit-guards.ts": {
    verdict: "guarded",
    reason:
      "Editor no-op detection; the editor inputs are disabled for a placeholder (editor-card.ts) and upsertNote refuses the write regardless.",
  },
  "src/app/render-callbacks.ts": {
    verdict: "guarded",
    reason: "Task toggle rewrites the body through upsertNote, which is a no-op for a placeholder.",
  },
  "src/app/silent-capture-runner.ts": {
    verdict: "guarded",
    reason: "Assigns the body of a note it has just created from a capture; never reads an existing note.",
  },
  "src/app/storage/local-workspace.ts": {
    verdict: "harmless",
    reason:
      "extractUrlsFromText(note.body) is a fallback for a legacy record without a `urls` array; placeholders always carry `urls` from their summary, so the fallback never runs for them and could only yield an empty list.",
  },
  "src/app/logic/note-stats.ts": {
    verdict: "harmless",
    reason:
      "Word count / read time in the detail topbar; shows zero while the placeholder is loading and re-renders on hydration. Display only.",
  },
  "src/lib/notebook-persona.ts": {
    verdict: "harmless",
    reason:
      "Open-task decoration falls back to a body scan when the caller passes no `hasOpenTask`; a placeholder loses the decoration until hydrated. The Notes grid passes the summary's count and never scans.",
  },
  "src/app/view/shared/detail-topbar.ts": {
    verdict: "harmless",
    reason: "Kind chip derived from title + body; a placeholder shows the title-only chip until hydrated. Display only.",
  },
  "src/app/view/shared/editor-card.ts": {
    verdict: "guarded",
    reason: "Renders the body into the textarea but disables title/body inputs and shows 'Loading…' when displayedNote.hydrated === false.",
  },
  "src/app/view/render-app.ts": {
    verdict: "guarded",
    reason:
      "Falls back to note.body only when the editor textarea is absent, for the onInputsChange preview; any resulting write still funnels through upsertNote's placeholder guard.",
  },
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/^\s*\/\/.*$/gmu, "");
}

const readers = walk("src").filter((file) => BODY_READ.test(stripComments(fs.readFileSync(file, "utf8"))));

describe("note body readers are placeholder-aware", () => {
  it("every module that reads a note body is listed with a verdict", () => {
    const unlisted = readers.filter((file) => !(file in BODY_READERS));
    expect(unlisted).toEqual([]);
  });

  it("the list carries no stale entries", () => {
    const stale = Object.keys(BODY_READERS).filter((file) => !readers.includes(file));
    expect(stale).toEqual([]);
  });

  it("every entry explains itself", () => {
    const thin = Object.entries(BODY_READERS)
      .filter(([, entry]) => entry.reason.trim().length < 40)
      .map(([file]) => file);
    expect(thin).toEqual([]);
  });
});
