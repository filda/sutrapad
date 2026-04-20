import { describe, expect, it } from "vitest";
import { applyFreshNoteDetails } from "../src/app/capture/apply-fresh-note-details";
import { DEFAULT_NOTE_TITLE } from "../src/lib/notebook";
import type { SutraPadDocument } from "../src/types";

function baseNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "note-1",
    title: DEFAULT_NOTE_TITLE,
    body: "",
    urls: [],
    tags: [],
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("applyFreshNoteDetails", () => {
  it("fills in every auto field when the note is still the placeholder default", () => {
    const note = baseNote();
    const patched = applyFreshNoteDetails(note, {
      title: "Morning at the office",
      location: "Prague",
      coordinates: { latitude: 50.08, longitude: 14.43 },
      captureContext: { source: "new-note", timezone: "Europe/Prague" },
    });

    expect(patched).not.toBe(note);
    expect(patched.title).toBe("Morning at the office");
    expect(patched.location).toBe("Prague");
    expect(patched.coordinates).toEqual({ latitude: 50.08, longitude: 14.43 });
    expect(patched.captureContext).toEqual({ source: "new-note", timezone: "Europe/Prague" });
  });

  it("does not bump updatedAt so the backfill stays invisible in the list sort", () => {
    const note = baseNote({ updatedAt: "2026-04-20T10:05:00.000Z" });
    const patched = applyFreshNoteDetails(note, {
      title: "Morning at the office",
      location: "Prague",
    });

    expect(patched.updatedAt).toBe("2026-04-20T10:05:00.000Z");
  });

  it("keeps a user-edited title intact (the user has already taken ownership)", () => {
    const note = baseNote({ title: "My real idea" });
    const patched = applyFreshNoteDetails(note, {
      title: "Morning at the office",
      location: "Prague",
    });

    expect(patched.title).toBe("My real idea");
    // Location still gets filled in — it is not user-editable in the editor.
    expect(patched.location).toBe("Prague");
  });

  it("treats an empty title the user typed as user-owned and does not overwrite it", () => {
    const note = baseNote({ title: "" });
    const patched = applyFreshNoteDetails(note, {
      title: "Morning at the office",
    });

    expect(patched.title).toBe("");
  });

  it("does not overwrite location, coordinates, or captureContext that are already set", () => {
    const note = baseNote({
      location: "Home",
      coordinates: { latitude: 1, longitude: 2 },
      captureContext: { source: "url-capture" },
    });
    const patched = applyFreshNoteDetails(note, {
      title: "Morning at the office",
      location: "Prague",
      coordinates: { latitude: 50, longitude: 14 },
      captureContext: { source: "new-note" },
    });

    expect(patched.location).toBe("Home");
    expect(patched.coordinates).toEqual({ latitude: 1, longitude: 2 });
    expect(patched.captureContext).toEqual({ source: "url-capture" });
    // Only the placeholder title is still open for the auto fill.
    expect(patched.title).toBe("Morning at the office");
  });

  it("returns the original reference when nothing would change (cheap no-op detection)", () => {
    const note = baseNote({
      title: "My real idea",
      location: "Home",
      coordinates: { latitude: 1, longitude: 2 },
      captureContext: { source: "url-capture" },
    });

    const patched = applyFreshNoteDetails(note, {
      title: "Morning at the office",
      location: "Prague",
      coordinates: { latitude: 50, longitude: 14 },
      captureContext: { source: "new-note" },
    });

    expect(patched).toBe(note);
  });

  it("returns the original reference when the resolved title is itself the default (nothing to upgrade to)", () => {
    const note = baseNote();
    const patched = applyFreshNoteDetails(note, { title: DEFAULT_NOTE_TITLE });

    expect(patched).toBe(note);
  });

  it("leaves untouched fields (body, tags, ids, timestamps) verbatim", () => {
    const note = baseNote({
      body: "draft content",
      tags: ["idea", "work"],
      urls: ["https://example.com"],
      createdAt: "2026-04-20T09:00:00.000Z",
      updatedAt: "2026-04-20T09:30:00.000Z",
    });
    const patched = applyFreshNoteDetails(note, {
      title: "Morning at the office",
      location: "Prague",
    });

    expect(patched.id).toBe(note.id);
    expect(patched.body).toBe(note.body);
    expect(patched.tags).toEqual(note.tags);
    expect(patched.urls).toEqual(note.urls);
    expect(patched.createdAt).toBe(note.createdAt);
    expect(patched.updatedAt).toBe(note.updatedAt);
  });
});
