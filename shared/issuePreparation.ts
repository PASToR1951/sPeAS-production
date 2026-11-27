/** Inclusive physical PDF ranges; printed page labels are editorial metadata. */
import type { ImportMetadata, PreparationRecipe } from "./imports.ts";
export function issuePaperRange(
  item: { id: string; metadata: ImportMetadata; recipe: PreparationRecipe },
  mainId: string,
) {
  const parts = item.recipe.parts.filter((p) => p.included);
  if (
    !item.metadata.issueReplacementConfirmed && parts.length === 1 &&
    parts[0].assetId === mainId && parts[0].firstPage && parts[0].lastPage
  ) {
    return {
      id: item.id,
      first: parts[0].firstPage,
      last: parts[0].lastPage,
      replacement: false,
    };
  }
  const original = item.metadata.issueSourceRange;
  if (
    item.metadata.issueReplacementConfirmed && original?.assetId === mainId &&
    parts.length && parts.every((p) => p.assetId !== mainId)
  ) {
    return {
      id: item.id,
      first: original.firstPage,
      last: original.lastPage,
      replacement: true,
    };
  }
  throw new Error(
    "Choose a confirmed main-PDF range, or explicitly confirm separate replacement files and their original issue range. Exclude the original range from a replacement paper's components.",
  );
}
export interface IssuePaperRange {
  id: string;
  first: number;
  last: number;
}
export interface IssuePageSection {
  first: number;
  last: number;
  role: "front_matter" | "cover" | "excluded";
  reason?: string;
}
export function describePageRanges(pages: number[]): string {
  const spans: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const first = pages[i];
    let last = first;
    while (pages[i + 1] === last + 1) last = pages[++i];
    spans.push(first === last ? String(first) : `${first}–${last}`);
  }
  return spans.join(", ");
}
export function validateIssueRanges(
  pages: number,
  papers: IssuePaperRange[],
  sections: IssuePageSection[] = [],
  proposedPaper?: Pick<IssuePaperRange, "first" | "last">,
): { errors: string[]; gaps: number[]; proposedError?: string } {
  const errors: string[] = [];
  const proposedErrors: string[] = [];
  const owners = new Map<number, string>();
  if (!Number.isSafeInteger(pages) || pages < 1) {
    return {
      errors: ["Prepare the main PDF before choosing ranges."],
      gaps: [] as number[],
    };
  }
  const mark = (first: number, last: number, label: string, issues = errors) => {
    if (
      !Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
      first < 1 || last < first || last > pages
    ) {
      issues.push(
        `${label}: choose an inclusive range between 1 and ${pages}.`,
      );
      return;
    }
    for (let page = first; page <= last; page++) {
      if (owners.has(page)) {
        issues.push(`${label}: page ${page} overlaps ${owners.get(page)}.`);
      } else owners.set(page, label);
    }
  };
  papers.forEach((p, i) => mark(p.first, p.last, `Paper ${i + 1}`));
  sections.forEach((s, i) => {
    if (!["front_matter", "cover", "excluded"].includes(s.role)) {
      errors.push(`Section ${i + 1}: choose a page role.`);
    }
    if (s.role === "excluded" && !s.reason?.trim()) {
      errors.push(`Section ${i + 1}: explain the exclusion.`);
    }
    mark(s.first, s.last, `Section ${i + 1} (${s.role === "front_matter" ? "front matter" : s.role})`);
  });
  const gaps = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => !owners.has(p));
  if (proposedPaper) mark(proposedPaper.first, proposedPaper.last, "New paper range", proposedErrors);
  return {
    errors,
    gaps,
    ...(proposedErrors.length ? { proposedError: proposedErrors[0] } : {}),
  };
}
