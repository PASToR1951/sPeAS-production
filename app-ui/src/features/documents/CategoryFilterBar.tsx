import { CATEGORY_ORDER, getCategoryMeta, type DocumentCategory } from "../../lib/constants/categories";
import type { CategoryCount } from "../../lib/api/types";
import { CategoryIcon } from "../../components/documents/CategoryIcon";

interface CategoryFilterBarProps {
  categories: CategoryCount[];
  selectedCategory: DocumentCategory;
  onSelectCategory: (category: DocumentCategory) => void;
}

export function CategoryFilterBar({ categories, selectedCategory, onSelectCategory }: CategoryFilterBarProps) {
  const countByCategory = new Map(categories.map((category) => [category.name, category.count]));
  const allCount = categories.reduce((sum, category) => sum + category.count, 0);

  return (
    <div className="peas-category-filter-bar" role="group" aria-label="Document categories">
      {CATEGORY_ORDER.map((categoryValue) => {
        const category = getCategoryMeta(categoryValue);
        const count = categoryValue === "All" ? allCount : countByCategory.get(categoryValue) ?? 0;
        const active = selectedCategory === categoryValue;

        return (
          <button
            className={`peas-category-filter peas-category-tone-${category.tone}${active ? " is-active" : ""}`}
            type="button"
            key={category.value}
            aria-pressed={active}
            aria-label={`${category.label}, ${count} ${count === 1 ? "entry" : "entries"}`}
            onClick={() => onSelectCategory(category.value)}
          >
            <span className="peas-category-filter__icon">
              <CategoryIcon category={category.value} />
            </span>
            <span className="peas-category-filter__copy">
              <span>{category.label}</span>
              <span>{count} {count === 1 ? "entry" : "entries"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
