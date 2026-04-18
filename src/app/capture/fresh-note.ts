import { collectCaptureContext } from "../../lib/capture-context";
import {
  buildNoteCaptureTitle,
  formatCoordinates,
  reverseGeocodeCoordinates,
  resolveCurrentCoordinates,
  type Coordinates,
} from "../../lib/url-capture";
import type { SutraPadCaptureSource, SutraPadCoordinates, SutraPadDocument } from "../../types";

export async function generateFreshNoteDetails(
  now = new Date(),
  resolveCoordinates: () => Promise<Coordinates | null> = resolveCurrentCoordinates,
  reverseGeocode: (coordinates: Coordinates) => Promise<string | null> = reverseGeocodeCoordinates,
  captureContextBuilder: typeof collectCaptureContext = collectCaptureContext,
): Promise<{
  title: string;
  location?: string;
  coordinates?: SutraPadCoordinates;
  captureContext?: SutraPadDocument["captureContext"];
}> {
  const resolvedCoordinates = await resolveCoordinates();
  const location = resolvedCoordinates
    ? (await reverseGeocode(resolvedCoordinates)) ?? formatCoordinates(resolvedCoordinates)
    : undefined;
  const captureContext = await captureContextBuilder({
    source: "new-note",
    coordinates: resolvedCoordinates ?? undefined,
    currentDate: now,
  });

  return {
    title: buildNoteCaptureTitle(now, location),
    location,
    coordinates: resolvedCoordinates ?? undefined,
    captureContext,
  };
}

export async function collectNoteCaptureDetails(
  source: SutraPadCaptureSource,
  now = new Date(),
  resolveCoordinates: () => Promise<Coordinates | null> = resolveCurrentCoordinates,
  reverseGeocode: (coordinates: Coordinates) => Promise<string | null> = reverseGeocodeCoordinates,
  captureContextBuilder: typeof collectCaptureContext = collectCaptureContext,
  sourceSnapshot?: Partial<NonNullable<SutraPadDocument["captureContext"]>>,
): Promise<{
  location?: string;
  coordinates?: SutraPadCoordinates;
  captureContext?: SutraPadDocument["captureContext"];
}> {
  const resolvedCoordinates = await resolveCoordinates();
  const location = resolvedCoordinates
    ? (await reverseGeocode(resolvedCoordinates)) ?? formatCoordinates(resolvedCoordinates)
    : undefined;

  return {
    location,
    coordinates: resolvedCoordinates ?? undefined,
    captureContext: await captureContextBuilder({
      source,
      coordinates: resolvedCoordinates ?? undefined,
      currentDate: now,
      sourceSnapshot,
    }),
  };
}
