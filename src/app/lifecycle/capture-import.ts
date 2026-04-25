/**
 * Reads the bootstrap URL params (`?note=…`, `?url=…`, `?selection=…`)
 * and folds them into the in-memory workspace as a fresh note. Used
 * by `runAppBootstrap` once on startup; the silent-capture runner
 * has its own (faster) path in `app/silent-capture-runner.ts`.
 *
 * Lifted out of `app.ts` so the wiring layer there can hand it off
 * to `runAppBootstrap` as an injected dependency rather than a local
 * closure.
 */
import { collectCaptureContext } from "../../lib/capture-context";
import {
  createCapturedNoteWorkspace,
  createTextNoteWorkspace,
} from "../../lib/notebook";
import {
  deriveTitleFromUrl,
  reverseGeocodeCoordinates,
  readNoteCapture,
  readUrlCapture,
  resolveTitleFromUrl,
  resolveCurrentCoordinates,
} from "../../lib/url-capture";
import {
  buildSilentCaptureBody,
  extractSelectionFromUrl,
} from "../logic/silent-capture";
import { collectNoteCaptureDetails, generateFreshNoteDetails } from "../capture/fresh-note";
import type { SutraPadWorkspace } from "../../types";

export async function captureIncomingWorkspaceFromUrl(
  workspace: SutraPadWorkspace,
): Promise<SutraPadWorkspace> {
  const notePayload = readNoteCapture(window.location.href);
  if (notePayload) {
    const { title, location, coordinates, captureContext } = await generateFreshNoteDetails(
      new Date(),
      resolveCurrentCoordinates,
      reverseGeocodeCoordinates,
      async (options) => collectCaptureContext({ ...options, source: "text-capture" }),
    );

    return createTextNoteWorkspace(workspace, {
      title,
      body: notePayload.note,
      location,
      coordinates,
      captureContext,
    });
  }

  const urlPayload = readUrlCapture(window.location.href);
  if (!urlPayload) {
    return workspace;
  }

  const resolvedTitle =
    urlPayload.title ??
    (await resolveTitleFromUrl(urlPayload.url)) ??
    deriveTitleFromUrl(urlPayload.url);
  const { captureContext } = await collectNoteCaptureDetails({
    source: "url-capture",
    now: new Date(),
    resolveCoordinates: resolveCurrentCoordinates,
    reverseGeocode: reverseGeocodeCoordinates,
    captureContextBuilder: collectCaptureContext,
    sourceSnapshot: urlPayload.captureContext,
  });

  // The bookmarklet sends `?selection=` alongside `?url=` whenever the
  // user had text selected on the source page. The silent-capture
  // runner consumes both via `buildSilentCaptureBody`; if silent
  // failed and we landed in the fallback flow, that selection would
  // otherwise be silently dropped. Reusing the same builder keeps the
  // selection-prefix-then-URL formatting identical between the two
  // paths so the user's note doesn't read differently depending on
  // which route ran.
  const selection = extractSelectionFromUrl(window.location.href);
  if (selection !== null) {
    const note = createTextNoteWorkspace(workspace, {
      title: resolvedTitle,
      body: buildSilentCaptureBody(selection, urlPayload.url),
      captureContext,
    });
    return note;
  }

  return createCapturedNoteWorkspace(workspace, {
    title: resolvedTitle,
    url: urlPayload.url,
    captureContext,
  });
}
