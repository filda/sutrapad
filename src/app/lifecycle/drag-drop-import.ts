/**
 * Drag-and-drop import wiring.
 *
 * Binds drop handling on the app host and surfaces a lightweight progress
 * line while notes are uploaded. All the parsing/orchestration lives in the
 * node-tested `logic/drop-import` + `logic/import-batches` modules; this file
 * is the thin DOM layer (event listeners + a status element) that connects
 * them to the running app, mirroring the other lifecycle installers.
 */
import { handleImportDrop, type ImportDropStatus } from "../logic/drop-import";
import type { WorkspaceIO } from "../session/workspace-io";

export interface DragDropImportOptions {
  readonly host: HTMLElement;
  readonly importNotes: WorkspaceIO["importNotes"];
}

const STATUS_HIDE_DELAY_MS = 4000;

// Module-scoped: preventing default on dragover is what marks the host as a
// drop target, and the handler captures nothing, so it needn't be rebuilt per
// install.
function handleDragOver(event: DragEvent): void {
  if (event.dataTransfer === null) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

export function installDragDropImport(options: DragDropImportOptions): void {
  const { host, importNotes } = options;
  let importing = false;

  const statusEl = document.createElement("div");
  statusEl.className = "import-progress";
  statusEl.hidden = true;
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");
  // Styled inline (via CSSOM, so it's exempt from the style-src CSP) so the
  // indicator is visible without shipping CSS the service worker might cache.
  statusEl.style.cssText =
    "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);" +
    "z-index:2147483647;padding:8px 16px;border-radius:8px;" +
    "background:rgba(20,20,20,0.92);color:#fff;font:14px/1.4 system-ui,sans-serif;" +
    "box-shadow:0 2px 12px rgba(0,0,0,0.3);pointer-events:none;";
  host.append(statusEl);

  const showStatus = (status: ImportDropStatus): void => {
    if (status.phase === "empty") {
      return;
    }
    if (status.phase === "start") {
      statusEl.hidden = false;
      statusEl.textContent = `Importing 0/${status.total}…`;
      return;
    }
    if (status.phase === "progress") {
      statusEl.textContent = `Importing ${status.done}/${status.total}…`;
      return;
    }
    const failedSuffix = status.failed > 0 ? `, ${status.failed} failed` : "";
    const plural = status.done === 1 ? "" : "s";
    statusEl.textContent = `Imported ${status.done} note${plural}${failedSuffix}`;
    window.setTimeout(() => {
      statusEl.hidden = true;
    }, STATUS_HIDE_DELAY_MS);
  };

  const onDrop = (event: DragEvent): void => {
    const dataTransfer = event.dataTransfer;
    if (dataTransfer === null) {
      return;
    }
    event.preventDefault();
    if (importing) {
      return;
    }
    importing = true;
    void handleImportDrop(dataTransfer, { importNotes, onStatus: showStatus })
      .catch(() => {
        statusEl.hidden = false;
        statusEl.textContent = "Import failed";
      })
      .finally(() => {
        importing = false;
      });
  };

  host.addEventListener("dragover", handleDragOver);
  host.addEventListener("drop", onDrop);
}
