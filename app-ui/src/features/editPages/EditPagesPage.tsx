import { ArrowRight, LayoutTemplate, ListOrdered } from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";

export function EditPagesPage() {
  return (
    <main className="peas-admin-island peas-edit-pages">
      <AdminPageHeader title="Edit Pages" description="Manage content displayed on the public website." />
      <nav className="peas-edit-pages__links" aria-label="Page editors">
        <a className="peas-edit-pages__studio" href="/admin/Components/experience-studio.html">
          <LayoutTemplate aria-hidden="true" />
          <span>
            <strong>Experience Studio</strong>
            <small>Edit and preview the Home and FAQ pages.</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </a>
        <a href="/admin/Components/research-agenda.html">
          <ListOrdered aria-hidden="true" />
          <span>
            <strong>Research Agenda</strong>
            <small>Manage the official research priorities shown on the Home page.</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </a>
      </nav>
    </main>
  );
}
