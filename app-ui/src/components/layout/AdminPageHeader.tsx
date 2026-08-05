import type { ReactNode } from "react";

interface AdminPageHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  titleId?: string;
}

export function AdminPageHeader({
  title,
  description,
  actions,
  titleId,
}: AdminPageHeaderProps) {
  return (
    <header className="peas-admin-page-header">
      <div>
        <h1 id={titleId}>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="peas-admin-page-header__actions">{actions}</div> : null}
    </header>
  );
}
