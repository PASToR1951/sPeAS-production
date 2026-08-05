export interface DocumentAuthorSelection {
  id?: number | string;
  fullName: string;
  source: "existing" | "new";
}

export type DocumentAuthorReference = string | {
  id?: number | string;
  full_name: string;
};
