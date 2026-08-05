import { useEffect, useState } from "react";

export function PublicRouteLoadingScreen() {
  return (
    <div className="peas-public-route-loader peas-public-route-loader--initial" role="status" aria-live="polite" aria-label="Loading page">
      <RouteLoaderContent />
    </div>
  );
}

export function PublicRouteLoader() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const markNavigation = (event: MouseEvent) => {
      if (!isInternalNavigation(event)) return;
      setVisible(true);
    };
    const clearNavigation = () => setVisible(false);
    document.addEventListener("click", markNavigation, true);
    window.addEventListener("pageshow", clearNavigation);
    return () => {
      document.removeEventListener("click", markNavigation, true);
      window.removeEventListener("pageshow", clearNavigation);
    };
  }, []);

  if (!visible) return null;
  return (
    <div className="peas-public-route-loader" role="status" aria-live="polite" aria-label="Opening page">
      <RouteLoaderContent />
    </div>
  );
}

function RouteLoaderContent() {
  return (
    <img
      className="peas-public-route-loader__logo"
      src="/Components/images/spud_logo_s.png"
      alt="St. Paul University Dumaguete"
    />
  );
}

function isInternalNavigation(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!target || target.target === "_blank" || target.hasAttribute("download")) return false;
  const destination = new URL(target.href, window.location.href);
  if (destination.origin !== window.location.origin) return false;
  return destination.pathname !== window.location.pathname || destination.search !== window.location.search;
}
