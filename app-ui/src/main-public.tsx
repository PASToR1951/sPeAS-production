import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { PublicErrorBoundary, PublicErrorPage } from "./components/public/PublicPageShell";
import { PublicSessionProvider } from "./components/public/PublicSessionProvider";
import { PublicRouteLoader, PublicRouteLoadingScreen } from "./components/public/PublicRouteLoader";
import "./styles/globals.css";

const routes: Array<{ paths: string[]; component: ComponentType }> = [
  { paths: ["/", "/index.html"], component: lazy(() => import("./features/public/PublicHomePage").then(({ PublicHomePage }) => ({ default: PublicHomePage }))) },
  { paths: ["/news.html"], component: lazy(() => import("./features/public/PublicNewsPage").then(({ PublicNewsPage }) => ({ default: PublicNewsPage }))) },
  { paths: ["/newsletter.html"], component: lazy(() => import("./features/public/PublicNewsletterPage").then(({ PublicNewsletterPage }) => ({ default: PublicNewsletterPage }))) },
  { paths: ["/faq.html"], component: lazy(() => import("./features/public/PublicFaqPage").then(({ PublicFaqPage }) => ({ default: PublicFaqPage }))) },
  { paths: ["/pages/searchResultsPage.html"], component: lazy(() => import("./features/public/PublicSearchPage").then(({ PublicSearchPage }) => ({ default: PublicSearchPage }))) },
  { paths: ["/contact", "/contact.html"], component: lazy(() => import("./features/public/PublicContactPage").then(({ PublicContactPage }) => ({ default: PublicContactPage }))) },
  { paths: ["/log-in.html"], component: lazy(() => import("./features/public/PublicLoginPage").then(({ PublicLoginPage }) => ({ default: PublicLoginPage }))) },
  { paths: ["/reset-password.html"], component: lazy(() => import("./features/public/PublicResetPasswordPage").then(({ PublicResetPasswordPage }) => ({ default: PublicResetPasswordPage }))) },
  { paths: ["/pages/miscellaneous/T&A-Public.html"], component: lazy(() => import("./features/public/PublicLegalPages").then(({ PublicTermsPage }) => ({ default: PublicTermsPage }))) },
  { paths: ["/pages/miscellaneous/Privacy.html"], component: lazy(() => import("./features/public/PublicLegalPages").then(({ PublicPrivacyPage }) => ({ default: PublicPrivacyPage }))) },
  { paths: ["/pages/miscellaneous/404.html"], component: PublicErrorPage },
  { paths: ["/pages/SavedDocument.html", "/pages/UserHistory.html", "/pages/UserProfile.html", "/pages/UserAnnotations.html"], component: RetiredAccountRoute },
  { paths: ["/pages/authorprofile.html"], component: lazy(() => import("./features/public/PublicAuthorPage").then(({ PublicAuthorPage }) => ({ default: PublicAuthorPage }))) },
  { paths: ["/pages/guest-single.html", "/pages/user-single.html", "/pages/guest-compiled.html", "/pages/user-compiled.html"], component: lazy(() => import("./features/public/PublicDocumentDetailPage").then(({ PublicDocumentDetailPage }) => ({ default: PublicDocumentDetailPage }))) },
];

function RetiredAccountRoute() {
  useEffect(() => { window.location.replace("/index.html?account_features_retired=true"); }, []);
  return <PublicRouteLoadingScreen />;
}

const root = document.getElementById("react-public-root");

if (root) {
  const matchedRoute = routes.find((route) => route.paths.includes(window.location.pathname));
  const fallbackRoute = { component: PublicErrorPage };
  const Page = (matchedRoute ?? fallbackRoute).component;

  createRoot(root).render(
    <PublicSessionProvider>
      <PublicErrorBoundary>
        <PublicRouteLoader />
        <Suspense fallback={<PublicRouteLoadingScreen />}><Page /></Suspense>
      </PublicErrorBoundary>
    </PublicSessionProvider>,
  );
}
