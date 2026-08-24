import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { AdminLayout, type WorkspaceRole } from "./components/layout/AdminLayout";
import { PeasLoadingState } from "./components/feedback/PeasStates";
import "./styles/globals.css";
import "./styles/admin-layout.css";

type AdminRoute = {
  title: string;
  allowedRoles?: WorkspaceRole[];
  Component: ComponentType;
};

const ADMIN_ROLES: WorkspaceRole[] = ["admin"];
const routes: Record<string, AdminRoute> = {
  "/admin/dashboard.html": {
    title: "Dashboard | PeAS Admin",
    Component: lazyNamed(() => import("./features/dashboard/DashboardPage"), "DashboardPage"),
  },
  "/admin/Components/documents_list.html": {
    title: "Documents | PeAS Admin",
    Component: lazyNamed(() => import("./features/documents/DocumentsAdminPage"), "DocumentsAdminPage"),
  },
  "/admin/Components/classification-management.html": {
    title: "Classification Management | PeAS Admin",
    Component: lazyNamed(() => import("./features/classification/ClassificationManagementPage"), "ClassificationManagementPage"),
  },
  "/admin/Components/upload_document.html": {
    title: "Upload Document | PeAS",
    allowedRoles: ADMIN_ROLES,
    Component: lazyNamed(() => import("./features/upload/UploadDocumentPage"), "UploadDocumentPage"),
  },
  "/admin/Components/archive-documents.html": {
    title: "Archived Documents | PeAS Admin",
    Component: lazyNamed(() => import("./features/archive/ArchiveDocumentsPage"), "ArchiveDocumentsPage"),
  },
  "/admin/Components/author-list.html": {
    title: "Authors | PeAS Admin",
    Component: lazyNamed(() => import("./features/authors/AuthorsAdminPage"), "AuthorsAdminPage"),
  },
  "/admin/Components/reports.html": {
    title: "Operational Reports | PeAS Admin",
    Component: lazyNamed(() => import("./features/reports/OperationalReportsPage"), "OperationalReportsPage"),
  },
  "/admin/Components/most-viewed-works.html": {
    title: "Most Viewed Works | PeAS Admin",
    Component: lazyNamed(() => import("./features/topActivity/TopActivityDetailPage"), "MostViewedWorksPage"),
  },
  "/admin/Components/most-viewed-authors.html": {
    title: "Most Viewed Authors | PeAS Admin",
    Component: lazyNamed(() => import("./features/topActivity/TopActivityDetailPage"), "MostViewedAuthorsPage"),
  },
  "/admin/Components/trending-topics.html": {
    title: "Trending Topics | PeAS Admin",
    Component: lazyNamed(() => import("./features/topActivity/TopActivityDetailPage"), "TrendingTopicsPage"),
  },
  "/admin/Components/search-analytics.html": {
    title: "Search Analytics | PeAS Admin",
    Component: lazyNamed(() => import("./features/searchAnalytics/SearchAnalyticsPage"), "SearchAnalyticsPage"),
  },
  "/admin/Components/news.html": {
    title: "Department News | PeAS",
    allowedRoles: ADMIN_ROLES,
    Component: lazyNamed(() => import("./features/news/AdminNewsPage"), "AdminNewsPage"),
  },
  "/admin/Components/newsletter.html": {
    title: "Newsletter | PeAS Admin",
    allowedRoles: ADMIN_ROLES,
    Component: lazyNamed(() => import("./features/newsletter/NewsletterAdminPage"), "NewsletterAdminPage"),
  },
  "/admin/Components/role-management.html": {
    title: "Role Management | PeAS Admin",
    Component: lazyNamed(() => import("./features/roles/RoleManagementPage"), "RoleManagementPage"),
  },
  "/admin/Components/contact-inquiries.html": {
    title: "Contact Inquiries | PeAS Admin",
    Component: lazyNamed(() => import("./features/contact/AdminContactInquiriesPage"), "AdminContactInquiriesPage"),
  },
  "/admin/Components/admin_logs.html": {
    title: "System Logs | PeAS Admin",
    Component: lazyNamed(() => import("./features/logs/SystemLogsPage"), "SystemLogsPage"),
  },
  "/admin/Components/admin_settings.html": {
    title: "Settings | PeAS Admin",
    Component: lazyNamed(() => import("./features/settings/AdminSettingsPage"), "AdminSettingsPage"),
  },
};

const root = document.querySelector<HTMLElement>("[data-peas-admin-root], [id^='react-'][id$='-admin-root']");
if (root) createRoot(root).render(<AdminApplication />);

function AdminApplication() {
  const [pathname, setPathname] = useState(normalizePath(window.location.pathname));
  const route = routes[pathname] ?? routes["/admin/dashboard.html"];

  useEffect(() => {
    const onPopState = () => setPathname(normalizePath(window.location.pathname));
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      const nextPath = normalizePath(url.pathname);
      if (url.origin !== window.location.origin || !routes[nextPath]) return;
      event.preventDefault();
      window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
      setPathname(nextPath);
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    document.title = route.title;
  }, [route.title]);

  const Page = route.Component;
  return (
    <AdminLayout allowedRoles={route.allowedRoles}>
      <Suspense fallback={<div className="peas-admin-route-loading"><PeasLoadingState /></div>}>
        <Page />
      </Suspense>
    </AdminLayout>
  );
}

function lazyNamed<Module extends Record<Key, ComponentType>, Key extends keyof Module>(
  importer: () => Promise<Module>,
  key: Key,
) {
  return lazy(async () => ({ default: (await importer())[key] }));
}

function normalizePath(path: string) {
  return path.replace(/\/+$/, "") || "/";
}
