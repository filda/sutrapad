// @vitest-environment happy-dom
//
// First focused test for `src/app/lifecycle/drag-drop-import.ts`. Its
// deferred-list reason was "only covered via the smoke test", and the smoke
// test never drops a file — so the only part of this module that had ever
// run was the two `addEventListener` calls.
//
// What it actually owns:
//
//   - **the drop-target contract.** `dragover` must `preventDefault()`, or
//     the browser never fires `drop` at all and the whole feature is dead.
//     `dropEffect = "copy"` is what turns the cursor into the plus badge.
//     Both are invisible in the DOM and only assertable through the event.
//   - **the re-entrancy latch.** A second drop while an import is in flight
//     is dropped on the floor. Without it, two overlapping `importNotes`
//     runs interleave their progress callbacks and the counter jumps around.
//     The latch has to clear in a `finally` — after a *failed* import too, or
//     the feature is permanently dead until reload.
//   - **the progress copy.** Four phases, one of which (`empty`) renders
//     nothing at all, plus a pluralisation and a conditional failure suffix.
//     "Imported 1 notes" and a swallowed failure count are exactly the sort
//     of thing that ships.
//   - **the auto-hide.** The done line disappears after a delay; the failure
//     line deliberately does not.
//
// `handleImportDrop` is mocked here, unusually for this codebase, because
// driving the real one needs a `DataTransfer` with live `File` objects and
// the module already has its own suite. What is asserted is the boundary:
// the exact arguments handed to it, and every status it can emit.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportDropStatus } from "../src/app/logic/drop-import";

const handleImportDrop = vi.hoisted(() => vi.fn());
vi.mock("../src/app/logic/drop-import", () => ({ handleImportDrop }));

const { installDragDropImport } = await import("../src/app/lifecycle/drag-drop-import");

const HIDE_DELAY_MS = 4000;

function install() {
  const host = document.createElement("div");
  document.body.append(host);
  const importNotes = vi.fn(() => Promise.resolve({ done: 0, failed: 0, total: 0 }));
  installDragDropImport({ host, importNotes });
  const status = host.querySelector<HTMLElement>(".import-progress");
  return { host, importNotes, status };
}

/** A `DataTransfer` stand-in — happy-dom's constructor is not reliable here. */
function transfer(): DataTransfer {
  return { files: [], getData: () => "", dropEffect: "none" } as unknown as DataTransfer;
}

function fire(host: HTMLElement, type: "drop" | "dragover", dataTransfer: unknown) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  host.dispatchEvent(event);
  return event as DragEvent;
}

/**
 * Drains the promise chain behind a drop. Fake timers are frozen (no
 * `shouldAdvanceTime`), so `vi.waitFor` is unusable here — but the chain is
 * pure microtasks, so yielding a handful of times settles it.
 */
async function settle(): Promise<void> {
  // Sequential on purpose: each yield lets one more `.then` in the chain run.
  // oxlint-disable-next-line no-await-in-loop
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

/** Runs one drop to completion, emitting the statuses the caller lists. */
async function drop(host: HTMLElement, statuses: readonly ImportDropStatus[]) {
  handleImportDrop.mockImplementationOnce((_data: unknown, deps: {
    onStatus?: (status: ImportDropStatus) => void;
  }) => {
    for (const status of statuses) deps.onStatus?.(status);
    return Promise.resolve(null);
  });
  fire(host, "drop", transfer());
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  handleImportDrop.mockReset();
  handleImportDrop.mockResolvedValue(null);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("installDragDropImport status element", () => {
  it("mounts a hidden polite live region on the host", () => {
    const { host, status } = install();

    expect(status?.className).toBe("import-progress");
    // Hidden until there is something to say — a permanently visible empty
    // pill would sit over the notes list.
    expect(status?.hidden).toBe(true);
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.parentElement).toBe(host);
  });

  it("styles itself through CSSOM so no stylesheet is needed", () => {
    // Inline via `style.cssText` on purpose: the service worker caches CSS,
    // and the indicator has to be visible on the very first import after a
    // deploy. `pointer-events:none` keeps it from eating clicks.
    const { status } = install();

    expect(status?.style.position).toBe("fixed");
    expect(status?.style.pointerEvents).toBe("none");
    expect(status?.style.zIndex).toBe("2147483647");
  });

  it("paints itself legibly rather than inheriting the page", () => {
    // The layout half of the inline style is asserted above; this is the
    // appearance half, and it is the half that actually decides whether the
    // pill is readable. It sits over arbitrary note content, so the dark
    // backing plate and the explicit light text are what keep it from
    // rendering as invisible text on whatever card is underneath.
    const { status } = install();

    expect(status?.style.backgroundColor).toBe("rgba(20, 20, 20, 0.92)");
    expect(status?.style.color).toBe("#fff");
    expect(status?.style.fontFamily).toBe("system-ui, sans-serif");
    expect(status?.style.fontSize).toBe("14px");
  });
});

describe("installDragDropImport dragover", () => {
  it("claims the host as a drop target", () => {
    // Without preventDefault on dragover the browser never fires `drop`.
    const { host } = install();
    const dataTransfer = transfer();

    const event = fire(host, "dragover", dataTransfer);

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("ignores a dragover with no payload", () => {
    const { host } = install();

    expect(fire(host, "dragover", null).defaultPrevented).toBe(false);
  });
});

describe("installDragDropImport drop", () => {
  it("hands the payload and the importer straight to the orchestrator", () => {
    const { host, importNotes } = install();
    const dataTransfer = transfer();

    fire(host, "drop", dataTransfer);

    expect(handleImportDrop).toHaveBeenCalledOnce();
    expect(handleImportDrop.mock.calls[0]?.[0]).toBe(dataTransfer);
    expect(handleImportDrop.mock.calls[0]?.[1]).toMatchObject({
      importNotes,
      onStatus: expect.any(Function),
    });
  });

  it("claims the drop event", () => {
    // Otherwise the browser navigates away to the dropped file.
    const { host } = install();

    expect(fire(host, "drop", transfer()).defaultPrevented).toBe(true);
  });

  it("ignores a drop with no payload without claiming it", () => {
    const { host } = install();

    const event = fire(host, "drop", null);

    expect(event.defaultPrevented).toBe(false);
    expect(handleImportDrop).not.toHaveBeenCalled();
  });
});

describe("installDragDropImport progress copy", () => {
  it("shows the counter as soon as the import starts", async () => {
    const { host, status } = install();

    await drop(host, [{ phase: "start", total: 12 }]);

    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe("Importing 0/12…");
  });

  it("counts up as notes land", async () => {
    const { host, status } = install();

    await drop(host, [
      { phase: "start", total: 3 },
      { phase: "progress", done: 1, failed: 0, total: 3 },
      { phase: "progress", done: 2, failed: 0, total: 3 },
    ]);

    expect(status?.textContent).toBe("Importing 2/3…");
  });

  it("stays silent and hidden for a drop that carried nothing", async () => {
    // A dragged image or an empty selection: nothing to say, so no pill.
    const { host, status } = install();

    await drop(host, [{ phase: "empty" }]);

    expect(status?.hidden).toBe(true);
    expect(status?.textContent).toBe("");
  });

  it("pluralises the finished count", async () => {
    const { host, status } = install();

    await drop(host, [{ phase: "done", done: 1, failed: 0, total: 1 }]);
    expect(status?.textContent).toBe("Imported 1 note");

    await drop(host, [{ phase: "done", done: 4, failed: 0, total: 4 }]);
    expect(status?.textContent).toBe("Imported 4 notes");

    // Zero is plural too — "Imported 0 note" reads as a typo.
    await drop(host, [{ phase: "done", done: 0, failed: 0, total: 2 }]);
    expect(status?.textContent).toBe("Imported 0 notes");
  });

  it("reports failures alongside the successes", async () => {
    // A silently dropped failure count is the difference between "my import
    // worked" and "three of my notes are missing".
    const { host, status } = install();

    await drop(host, [{ phase: "done", done: 7, failed: 3, total: 10 }]);

    expect(status?.textContent).toBe("Imported 7 notes, 3 failed");
  });

  it("leaves the suffix off a clean import", async () => {
    const { host, status } = install();

    await drop(host, [{ phase: "done", done: 5, failed: 0, total: 5 }]);

    expect(status?.textContent).toBe("Imported 5 notes");
  });

  it("hides the finished line after the delay, not before", async () => {
    const { host, status } = install();
    await drop(host, [{ phase: "start", total: 1 }, { phase: "done", done: 1, failed: 0, total: 1 }]);

    vi.advanceTimersByTime(HIDE_DELAY_MS - 1);
    expect(status?.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(status?.hidden).toBe(true);
  });
});

describe("installDragDropImport failure and re-entrancy", () => {
  it("surfaces a failed import and leaves the message up", async () => {
    // No auto-hide on failure: the user needs to see that it did not work.
    const { host, status } = install();
    handleImportDrop.mockRejectedValueOnce(new Error("network"));

    fire(host, "drop", transfer());
    await settle();

    expect(status?.textContent).toBe("Import failed");
    expect(status?.hidden).toBe(false);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 2);
    expect(status?.hidden).toBe(false);
  });

  it("ignores a second drop while one import is still running", async () => {
    // Two overlapping imports interleave their progress callbacks and the
    // counter jumps back and forth.
    const { host } = install();
    let release: (() => void) | undefined;
    handleImportDrop.mockImplementationOnce(
      () => new Promise<null>((resolve) => {
        release = () => resolve(null);
      }),
    );

    fire(host, "drop", transfer());
    fire(host, "drop", transfer());

    expect(handleImportDrop).toHaveBeenCalledOnce();
    release?.();
    await settle();
  });

  it("accepts the next drop once the import settles", async () => {
    const { host } = install();
    await drop(host, [{ phase: "done", done: 1, failed: 0, total: 1 }]);

    await drop(host, [{ phase: "done", done: 2, failed: 0, total: 2 }]);

    expect(handleImportDrop).toHaveBeenCalledTimes(2);
  });

  it("releases the latch after a failed import too", async () => {
    // The reset lives in `finally`; in `then` it would leave the feature
    // dead until a reload after the first network blip.
    const { host, status } = install();
    handleImportDrop.mockRejectedValueOnce(new Error("network"));
    fire(host, "drop", transfer());
    await settle();
    expect(status?.textContent).toBe("Import failed");

    await drop(host, [{ phase: "done", done: 1, failed: 0, total: 1 }]);

    expect(handleImportDrop).toHaveBeenCalledTimes(2);
    expect(status?.textContent).toBe("Imported 1 note");
  });
});
