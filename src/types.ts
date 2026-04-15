export interface SutraPadDocument {
  id: string;
  title: string;
  body: string;
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
  activeNoteId: string | null;
  notes: SutraPadNoteSummary[];
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
