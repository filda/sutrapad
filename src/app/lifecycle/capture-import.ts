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
  type Coordinates,
} from "../../lib/url-capture";
import {
  buildSilentCaptureBody,
  extractSelectionFromUrl,
} from "../logic/silent-capture";
import { collectNoteCaptureDetails, generateFreshNoteDetails } from "../capture/fresh-note";
import type { SutraPadWorkspace } from "../../types";

export interface CaptureImportOptions {
  /**
   * Injected coordinates resolver. Defaults to the real
   * `resolveCurrentCoordinates` (which calls `getCurrentPosition`).
   * The wiring layer in `app.ts` swaps in `async () => null` when the
   * capture-location preference is anything other than `"on"`, so
   * `"unanswered"` and `"off"` users never see a geolocation prompt
   * inside the bookmarklet / URL-capture flow. The prompt is reserved
   * for `+ Add` inside the main app, where the consent card frames
   * it; popping it from a capture iframe with no context would be
   * worse UX than silently skipping location.
   */
  readonly resolveCoordinates?: () => Promise<Coordinates | null>;
}

export async function captureIncomingWorkspaceFromUrl(
  workspace: SutraPadWorkspace,
  options: CaptureImportOptions = {},
): Promise<SutraPadWorkspace> {
  const resolveCoordinates =
    options.resolveCoordinates ?? resolveCurrentCoordinates;

  const notePayload = readNoteCapture(window.location.href);
  if (notePayload) {
    const { title, location, coordinates, captureContext } = await generateFreshNoteDetails(
      new Date(),
      resolveCoordinates,
      reverseGeocodeCoordinates,
      (contextOptions) =>
        collectCaptureContext({ ...contextOptions, source: "text-capture" }),
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
    resolveCoordinates,
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
