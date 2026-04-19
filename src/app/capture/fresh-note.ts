import { collectCaptureContext } from "../../lib/capture-context";
import {
  buildNoteCaptureTitle,
  formatCoordinates,
  reverseGeocodeCoordinates,
  resolveCurrentCoordinates,
  type Coordinates,
} from "../../lib/url-capture";
import type { SutraPadCaptureSource, SutraPadCoordinates, SutraPadDocument } from "../../types";

type ResolveCoordinates = () => Promise<Coordinates | null>;
type ReverseGeocode = (coordinates: Coordinates) => Promise<string | null>;
type CaptureContextBuilder = typeof collectCaptureContext;

interface CaptureDetailDependencies {
  now?: Date;
  resolveCoordinates?: ResolveCoordinates;
  reverseGeocode?: ReverseGeocode;
  captureContextBuilder?: CaptureContextBuilder;
}

interface NoteCaptureDetailOptions extends CaptureDetailDependencies {
  source: SutraPadCaptureSource;
  sourceSnapshot?: Partial<NonNullable<SutraPadDocument["captureContext"]>>;
}

async function resolveLocationDetails(
  resolveCoordinates: ResolveCoordinates,
  reverseGeocode: ReverseGeocode,
): Promise<{
  location?: string;
  coordinates?: SutraPadCoordinates;
}> {
  const resolvedCoordinates = await resolveCoordinates();
  const location = resolvedCoordinates
    ? (await reverseGeocode(resolvedCoordinates)) ?? formatCoordinates(resolvedCoordinates)
    : undefined;

  return {
    location,
    coordinates: resolvedCoordinates ?? undefined,
  };
}

export async function generateFreshNoteDetails(
  now = new Date(),
  resolveCoordinates: ResolveCoordinates = resolveCurrentCoordinates,
  reverseGeocode: ReverseGeocode = reverseGeocodeCoordinates,
  captureContextBuilder: CaptureContextBuilder = collectCaptureContext,
): Promise<{
  title: string;
  location?: string;
  coordinates?: SutraPadCoordinates;
  captureContext?: SutraPadDocument["captureContext"];
}> {
  const { location, coordinates } = await resolveLocationDetails(
    resolveCoordinates,
    reverseGeocode,
  );
  const captureContext = await captureContextBuilder({
    source: "new-note",
    coordinates,
    currentDate: now,
  });

  return {
    title: buildNoteCaptureTitle(now, location),
    location,
    coordinates,
    captureContext,
  };
}

export async function collectNoteCaptureDetails({
  source,
  now = new Date(),
  resolveCoordinates = resolveCurrentCoordinates,
  reverseGeocode = reverseGeocodeCoordinates,
  captureContextBuilder = collectCaptureContext,
  sourceSnapshot,
}: NoteCaptureDetailOptions): Promise<{
  location?: string;
  coordinates?: SutraPadCoordinates;
  captureContext?: SutraPadDocument["captureContext"];
}> {
  const { location, coordinates } = await resolveLocationDetails(
    resolveCoordinates,
    reverseGeocode,
  );

  return {
    location,
    coordinates,
    captureContext: await captureContextBuilder({
      source,
      coordinates,
      currentDate: now,
      sourceSnapshot,
    }),
  };
}
