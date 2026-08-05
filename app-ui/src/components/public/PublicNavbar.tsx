import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookMarked, ChevronDown, Clock3, Highlighter, LayoutDashboard, LogOut, Menu, UserRound, X } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { usePublicSession } from "./PublicSessionProvider";

const links = [
  { label: "Home", href: "/index.html" },
  { label: "News", href: "/news.html" },
  { label: "Contact", href: "/contact.html" },
];

const repositoryLink = { label: "Browse Repository", href: "/pages/searchResultsPage.html" };

export function PublicNavbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const alwaysGreen = usesAlwaysGreenNavbar();
  const { session, signOut } = usePublicSession();
  const authenticated = Boolean(session?.authenticated);
  const isAdmin = session?.role === "admin";
  const userName = String(session?.user?.name ?? session?.username ?? session?.userId ?? "User");
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
        {links.map((link) => (
          <a href={link.href} key={link.href} aria-current={isActivePath(link.href) ? "page" : undefined}>
            {link.label}
          </a>
        ))}
      </nav>

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
            <AccountMenu isAdmin={isAdmin} userImage={userImage} userName={userName} onLogout={handleLogout} />
          </>
        ) : (
          <Button className="peas-public-login-button" size="sm" onClick={() => (window.location.href = "/log-in.html")}>
            Login
          </Button>
        )}
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
                {isAdmin ? <a href="/admin/dashboard.html"><LayoutDashboard aria-hidden="true" /> Dashboard</a> : null}
                <a href="/pages/SavedDocument.html"><BookMarked aria-hidden="true" /> Saved Items</a>
                <a href="/pages/UserAnnotations.html"><Highlighter aria-hidden="true" /> Annotations</a>
                <a href="/pages/UserHistory.html"><Clock3 aria-hidden="true" /> History</a>
                <a href="/pages/UserProfile.html"><UserRound aria-hidden="true" /> Profile</a>
                <Button variant="outline" onClick={handleLogout}>
                  Logout
                </Button>
              </>
            ) : (
              <Button className="peas-public-login-button" onClick={() => (window.location.href = "/log-in.html")}>Login</Button>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}

function AccountMenu({ isAdmin, userImage, userName, onLogout }: { isAdmin: boolean; userImage: string; userName: string; onLogout: () => Promise<void> }) {
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
                  <small>{isAdmin ? "Administrator" : "Registered User"}</small>
                </div>
              </div>
              <div className="peas-public-account-menu__items">
                {isAdmin ? <AccountMenuLink href="/admin/dashboard.html" icon={<LayoutDashboard aria-hidden="true" />} label="Dashboard" /> : null}
                <AccountMenuLink href="/pages/SavedDocument.html" icon={<BookMarked aria-hidden="true" />} label="Saved Items" />
                <AccountMenuLink href="/pages/UserAnnotations.html" icon={<Highlighter aria-hidden="true" />} label="Annotations" />
                <AccountMenuLink href="/pages/UserHistory.html" icon={<Clock3 aria-hidden="true" />} label="History" />
                <AccountMenuLink href="/pages/UserProfile.html" icon={<UserRound aria-hidden="true" />} label="Profile" />
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

function AccountMenuLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <DropdownMenuItem asChild>
      <a href={href}>
        {icon}
        <span>{label}</span>
      </a>
    </DropdownMenuItem>
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
  return ["/news.html", "/contact", "/contact.html"].includes(window.location.pathname);
}

function isActivePath(href: string) {
  const current = window.location.pathname;
  if (href === "/index.html") return current === "/" || current === "/index.html";
  return current === href;
}
