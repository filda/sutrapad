export interface SutraPadCoordinates {
  latitude: number;
  longitude: number;
}

export interface SutraPadDocument {
  id: string;
  title: string;
  body: string;
  location?: string;
  coordinates?: SutraPadCoordinates;
  updatedAt: string;
  tags: string[];
}

export interface SutraPadNoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  fileId?: string;
}

export interface SutraPadIndex {
  version: 1;
  updatedAt: string;
  savedAt: string;
  previousIndexId?: string;
  activeNoteId: string | null;
  notes: SutraPadNoteSummary[];
}

export interface SutraPadHead {
  version: 1;
  activeIndexId: string;
  savedAt: string;
}

export interface SutraPadTagEntry {
  tag: string;
  noteIds: string[];
  count: number;
}

export interface SutraPadTagIndex {
  version: 1;
  savedAt: string;
  tags: SutraPadTagEntry[];
}

export interface SutraPadWorkspace {
  notes: SutraPadDocument[];
  activeNoteId: string | null;
}

export interface UserProfile {
  name: string;
  email: string;
  picture?: string;
}

export interface DriveFileRecord {
  id: string;
  name: string;
  mimeType?: string;
  appProperties?: Record<string, string>;
  parents?: string[];
}
