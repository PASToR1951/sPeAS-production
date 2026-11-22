import { BookOpen, FileText, GraduationCap, LayoutGrid, LibraryBig, type LucideIcon } from "lucide-react";
import type { DocumentCategory } from "../../lib/constants/categories";

interface CategoryIconProps {
  category: DocumentCategory;
}

const categoryIcons: Record<DocumentCategory, LucideIcon> = {
  All: LayoutGrid,
  THESIS: FileText,
  DISSERTATION: GraduationCap,
  CONFLUENCE: BookOpen,
  SYNERGY: LibraryBig,
};

export function CategoryIcon({ category }: CategoryIconProps) {
  const Icon = categoryIcons[category];

  return <Icon aria-hidden="true" focusable="false" strokeWidth={1.75} />;
}
