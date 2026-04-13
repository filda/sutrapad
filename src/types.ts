export interface SutraPadDocument {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface UserProfile {
  name: string;
  email: string;
  picture?: string;
}

export interface DriveFileRecord {
  id: string;
  name: string;
}
