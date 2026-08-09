import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { usePublicSession } from "./PublicSessionProvider";
import { PublicSearchCombobox } from "./PublicSearchCombobox";
import { PublicSearchOverlay } from "./PublicSearchOverlay";
import { searchResultsUrl } from "../../lib/api/public";
import { markPendingSearch } from "../../lib/api/search";

const links = [
  { label: "Home", href: "/index.html" },
  { label: "News", href: "/news.html" },
  { label: "FAQ", href: "/faq.html" },
  { label: "Contact", href: "/contact.html" },
];

const repositoryLink = { label: "Browse Repository", href: "/pages/searchResultsPage.html" };

export function PublicNavbar() {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const suppressSearchFocusRef = useRef(false);
  const suppressSearchFocusTimerRef = useRef<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const alwaysGreen = usesAlwaysGreenNavbar();
  const { session, signOut } = usePublicSession();
  const isAdmin = session?.role === "admin";
  const authenticated = Boolean(session?.authenticated && isAdmin);
  const userName = String(session?.user?.name ?? session?.username ?? session?.userId ?? "Administrator");
  const userImage = normalizeProfileImage(session?.user?.image);

  useEffect(() => {
    if (alwaysGreen) return;

    const updateScrolled = () => {
      const nextScrolled = window.scrollY > 16;
      setScrolled((current) => (current === nextScrolled ? current : nextScrolled));
    };

    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, [alwaysGreen]);

  useEffect(() => () => {
    if (suppressSearchFocusTimerRef.current !== null) window.clearTimeout(suppressSearchFocusTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const handleLogout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const closeSearch = useCallback(() => {
    suppressSearchFocusRef.current = true;
    setSearchOpen(false);
    if (suppressSearchFocusTimerRef.current !== null) window.clearTimeout(suppressSearchFocusTimerRef.current);
    suppressSearchFocusTimerRef.current = window.setTimeout(() => {
      suppressSearchFocusRef.current = false;
      suppressSearchFocusTimerRef.current = null;
    }, 300);
  }, []);

  return (
    <header className={`peas-public-navbar${alwaysGreen || scrolled ? " is-scrolled" : ""}`}>
      <a className="peas-public-brand" href="/index.html" aria-label="PeAS home">
        <img src="/Components/images/spud_logo_s.png" alt="" />
        <span>
          <strong>Office of Research & Publications</strong>
          <small>St. Paul University – Dumaguete</small>
        </span>
      </a>

      <nav className="peas-public-navlinks" aria-label="Public navigation">
        {links.map((link) => <a href={link.href} key={link.href} aria-current={isActivePath(link.href) ? "page" : undefined}>{link.label}</a>)}
      </nav>

      <NavbarSearch className="peas-public-navbar-search" onFocus={() => { if (!suppressSearchFocusRef.current) setSearchOpen(true); }} />

      <div className="peas-public-nav-actions">
        <a
          className="peas-public-repository-button"
          href={repositoryLink.href}
          aria-current={isActivePath(repositoryLink.href) ? "page" : undefined}
        >
          {repositoryLink.label}
        </a>
        {authenticated ? (
          <>
            <AccountMenu userImage={userImage} userName={userName} onLogout={handleLogout} />
          </>
        ) : null}
      </div>

      <button className="peas-public-mobile-toggle" type="button" aria-label="Open navigation" onClick={() => setOpen(true)}>
        <Menu aria-hidden="true" />
      </button>

      {open ? (
        <div className="peas-public-mobile-menu" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <div className="peas-public-mobile-panel" role="dialog" aria-modal="true" aria-labelledby="peas-mobile-menu-title">
            <div className="peas-public-mobile-head">
              <span id="peas-mobile-menu-title">PeAS</span>
              <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <NavbarSearch className="peas-public-mobile-search" />
            {links.map((link) => (
              <a
                href={link.href}
                key={link.href}
                aria-current={isActivePath(link.href) ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a
              className="peas-public-repository-button"
              href={repositoryLink.href}
              aria-current={isActivePath(repositoryLink.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {repositoryLink.label}
            </a>
            {authenticated ? (
              <>
                <MobileAccountIdentity userImage={userImage} userName={userName} />
                <a href="/admin/dashboard.html"><LayoutDashboard aria-hidden="true" /> Administrator dashboard</a>
                <Button variant="outline" onClick={handleLogout}>
                  Logout
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {searchOpen ? <PublicSearchOverlay onClose={closeSearch} /> : null}
    </header>
  );
}

function NavbarSearch({ className, onFocus }: { className: string; onFocus?: () => void }) {
  const [query, setQuery] = useState("");

  const submitSearch = useCallback(() => {
    window.location.href = searchResultsUrl(query, "All");
  }, [query]);

  return (
    <form
      className={className}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        markPendingSearch(query, "results");
        submitSearch();
      }}
    >
      <PublicSearchCombobox
        value={query}
        category="All"
        source="results"
        onChange={setQuery}
        onSubmit={submitSearch}
        ariaLabel="Search the repository from navigation"
        placeholder="Search the repository"
        onFocus={onFocus}
      />
    </form>
  );
}

function AccountMenu({ userImage, userName, onLogout }: { userImage: string; userName: string; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const initials = getInitials(userName);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="peas-public-account-trigger" type="button" aria-label={`Open account menu for ${userName}`}>
          <AccountAvatar image={userImage} initials={initials} />
          <span className="peas-public-account-trigger__name">{userName}</span>
          <ChevronDown className="peas-public-account-trigger__chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="peas-public-account-menu" align="end" sideOffset={10} collisionPadding={12}>
        <div className="peas-public-account-surface">
          <div className="peas-public-account-surface__body">
            <div className="peas-public-account-menu__content">
              <div className="peas-public-account-menu__identity">
                <AccountAvatar image={userImage} initials={initials} large />
                <div>
                  <strong>{userName}</strong>
                  <small>Administrator</small>
                </div>
              </div>
              <div className="peas-public-account-menu__items">
                <DropdownMenuItem asChild><a href="/admin/dashboard.html"><LayoutDashboard aria-hidden="true" /><span>Administrator dashboard</span></a></DropdownMenuItem>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="peas-public-account-menu__logout" onSelect={() => void onLogout()}>
                <LogOut aria-hidden="true" />
                <span>Logout</span>
              </DropdownMenuItem>
            </div>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileAccountIdentity({ userImage, userName }: { userImage: string; userName: string }) {
  return (
    <div className="peas-public-mobile-identity">
      <AccountAvatar image={userImage} initials={getInitials(userName)} large />
      <div>
        <strong>{userName}</strong>
        <small>Signed in to PeAS</small>
      </div>
    </div>
  );
}

function AccountAvatar({ image, initials, large = false }: { image: string; initials: string; large?: boolean }) {
  return (
    <span className={`peas-public-account-avatar${large ? " is-large" : ""}`} aria-hidden="true">
      {image ? <img src={image} alt="" /> : <span>{initials}</span>}
    </span>
  );
}

function normalizeProfileImage(value: unknown) {
  const image = String(value ?? "").trim();
  if (!image) return "";
  return image.startsWith("http") || image.startsWith("/") || image.startsWith("data:") ? image : `/${image}`;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (parts[0]?.[0] || "U").toUpperCase();
}

function usesAlwaysGreenNavbar() {
  return ["/news.html", "/faq.html", "/contact", "/contact.html"].includes(window.location.pathname);
}

function isActivePath(href: string) {
  const current = window.location.pathname;
  if (href === "/index.html") return current === "/" || current === "/index.html";
  return current === href;
}
