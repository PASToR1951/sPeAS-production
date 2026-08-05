import type { DocumentCategory } from "../../lib/constants/categories";

interface CategoryIconProps {
  category: DocumentCategory;
}

export function CategoryIcon({ category }: CategoryIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      {category === "All" ? <AllGlyph /> : null}
      {category === "THESIS" ? <ThesisGlyph /> : null}
      {category === "DISSERTATION" ? <DissertationGlyph /> : null}
      {category === "CONFLUENCE" ? <ConfluenceGlyph /> : null}
      {category === "SYNERGY" ? <SynergyGlyph /> : null}
    </svg>
  );
}

const glyphProps = {
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.7,
};

function AllGlyph() {
  return (
    <g {...glyphProps}>
      <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1" />
      <rect x="12" y="2.5" width="5.5" height="5.5" rx="1" />
      <rect x="2.5" y="12" width="5.5" height="5.5" rx="1" />
      <rect x="12" y="12" width="5.5" height="5.5" rx="1" />
    </g>
  );
}

function ThesisGlyph() {
  return (
    <g {...glyphProps}>
      <path d="M5 2.75h7.25L15.5 6v11.25H5z" />
      <path d="M12.25 2.75V6h3.25M7.5 9.25h5.5M7.5 12h5.5M7.5 14.75h3.25" />
    </g>
  );
}

function DissertationGlyph() {
  return (
    <g {...glyphProps}>
      <path d="M4.25 3.25h8.25L15.75 6v10.75H4.25z" />
      <path d="M12.5 3.25V6h3.25M6.75 8.75h6.5M6.75 11.5h4.25M6.75 14.25h5.5" />
      <path d="M6.75 5.75h2.5" />
    </g>
  );
}

function ConfluenceGlyph() {
  return (
    <g {...glyphProps}>
      <path d="M6.25 2.5h8L16.5 4.75v10.5H6.25z" />
      <path d="M4 5.25v12.25h9.75" />
      <path d="M13.25 2.5v2.25h3.25M8.5 8h5.5M8.5 10.75h5.5" />
    </g>
  );
}

function SynergyGlyph() {
  return (
    <g {...glyphProps}>
      <path d="M3.25 5.25 6 2.75h8.25L16.75 5v10.25L14 17.5H5.75l-2.5-2.25z" />
      <path d="M3.25 8h10.5M6 2.75v5.5M10 8v9.5M6 11.25h7.75M6 14h5.25" />
    </g>
  );
}
