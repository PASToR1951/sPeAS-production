import { apiFetch } from "./http";

export interface ResearchAgendaItem {
  id: number | string;
  name: string;
  description?: string;
}

export function fetchResearchAgenda(search?: string) {
  return apiFetch<ResearchAgendaItem[]>("/api/research-agendas").then((items) => search?.trim()
    ? items.filter((item) => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    : items);
}

export function fetchDocumentResearchAgenda(documentId: number) {
  return apiFetch<{ classification?: { researchAgendas?: ResearchAgendaItem[] } }>(`/api/documents/${documentId}/classification`).then((payload) => payload.classification?.researchAgendas ?? []);
}
