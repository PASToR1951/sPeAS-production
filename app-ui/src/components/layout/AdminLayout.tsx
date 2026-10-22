import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Archive,
  Bell,
  ChevronDown,
  FileText,
  Tags,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  MailQuestion,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UploadCloud,
  UsersRound,
  X,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchSession, fetchUserProfile, logout, type SessionResponse, type UserProfile } from "../../lib/api/auth";
import { Button } from "../ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { fetchAdminContactSummary } from "../../lib/api/adminContact";
import { clearAdminNotifications, fetchAdminNotifications, markAdminNotificationRead, type AdminNotification, type AdminNotificationSummary } from "../../lib/api/notifications";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface AdminLayoutProps {
  children: ReactNode;
  allowedRoles?: WorkspaceRole[];
}

export type WorkspaceRole = "admin";
type AdminNavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: WorkspaceRole[];
  activePaths?: string[];
};
const ADMIN_ONLY_ROLES: WorkspaceRole[] = ["admin"];
const WORKSPACE_BOOTSTRAP_KEY = "peas-admin-workspace-bootstrap-v1";
const WORKSPACE_BOOTSTRAP_MAX_AGE = 15 * 60 * 1000;

interface WorkspaceBootstrap {
  session: SessionResponse;
  profile: UserProfile | null;
  cachedAt: number;
}

interface AdminIdentity {
  userId: string;
  userName: string;
  role: WorkspaceRole;
  roleLabel: "Administrator";
  profile: UserProfile | null;
  updateProfile: (update: Partial<UserProfile>) => void;
}

const AdminIdentityContext = createContext<AdminIdentity | null>(null);

const navItems: AdminNavigationItem[] = [
  { label: "Dashboard", href: "/admin/dashboard.html", icon: LayoutDashboard, roles: ["admin"] as WorkspaceRole[] },
  { label: "Documents", href: "/admin/Components/documents_list.html", icon: FileText, roles: ["admin"] as WorkspaceRole[] },
  { label: "Classification", href: "/admin/Components/classification-management.html", icon: Tags, roles: ["admin"] as WorkspaceRole[] },
  { label: "Archived Documents", href: "/admin/Components/archive-documents.html", icon: Archive, roles: ["admin"] as WorkspaceRole[] },
  { label: "Authors", href: "/admin/Components/author-list.html", icon: UsersRound, roles: ["admin"] as WorkspaceRole[] },
  { label: "Department News", href: "/admin/Components/news.html", icon: Newspaper, roles: ["admin"] as WorkspaceRole[] },
  { label: "Contact Inquiries", href: "/admin/Components/contact-inquiries.html", icon: MailQuestion, roles: ["admin"] as WorkspaceRole[] },
];

const utilityItems: AdminNavigationItem[] = [
  { label: "View Site", href: "/index.html", icon: Home, roles: ["admin"] as WorkspaceRole[] },
];

export function AdminLayout({ children, allowedRoles = ADMIN_ONLY_ROLES }: AdminLayoutProps) {
  const [initialBootstrap] = useState(readWorkspaceBootstrap);
  const [session, setSession] = useState<SessionResponse | null>(initialBootstrap?.session ?? null);
  const [sessionLoaded, setSessionLoaded] = useState(Boolean(initialBootstrap));
  const [profile, setProfile] = useState<UserProfile | null>(initialBootstrap?.profile ?? null);
  const [collapsed, setCollapsed] = useStoredSidebarState();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia("(max-width: 980px)").matches);
  const [contactNewCount, setContactNewCount] = useState(0);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [notificationSummary, setNotificationSummary] = useState<AdminNotificationSummary>({ total: 0, unread: 0, urgent: 0 });
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const updateViewport = () => {
      setIsMobileViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([fetchSession(), fetchUserProfile()]).then(([sessionResult, profileResult]) => {
      if (!mounted) return;
      const nextSession = sessionResult.status === "fulfilled" ? sessionResult.value : null;
      const nextProfile = profileResult.status === "fulfilled" ? profileResult.value : null;
      setSession(nextSession);
      setProfile(nextProfile);
      setSessionLoaded(true);
      if (nextSession) writeWorkspaceBootstrap({ session: nextSession, profile: nextProfile, cachedAt: Date.now() });
      else clearWorkspaceBootstrap();
    });

    return () => {
      mounted = false;
    };
  }, []);

  const workspaceRole = normalizeWorkspaceRole(session?.role ?? session?.user?.role);

  const updateProfile = useCallback((update: Partial<UserProfile>) => {
    setProfile((current) => {
      const nextProfile = { ...(current ?? {}), ...update };
      if (session) writeWorkspaceBootstrap({ session, profile: nextProfile, cachedAt: Date.now() });
      return nextProfile;
    });
  }, [session]);

  useEffect(() => {
    if (workspaceRole !== "admin") return;
    fetchAdminContactSummary()
      .then((payload) => setContactNewCount(payload.byStatus.new))
      .catch(() => undefined);
  }, [workspaceRole]);

  const refreshNotifications = useCallback(async () => {
    if (workspaceRole !== "admin") return;
    try {
      const result = await fetchAdminNotifications();
      setNotifications(result.notifications);
      setNotificationSummary(result.summary);
    } catch {
      // The admin shell should remain usable when notifications are unavailable.
    }
  }, [workspaceRole]);

  useEffect(() => { void refreshNotifications(); }, [refreshNotifications]);

  useEffect(() => {
    if (!sessionLoaded) return;
    if (!session) {
      const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.location.replace(`/log-in.html?redirect=${redirect}`);
      return;
    }
    if (!workspaceRole || !allowedRoles.includes(workspaceRole)) {
      const destination = "/index.html";
      const timer = window.setTimeout(() => window.location.replace(destination), 900);
      return () => window.clearTimeout(timer);
    }
  }, [allowedRoles, session, sessionLoaded, workspaceRole]);

  const userName = useMemo(() => {
    const names = [profile?.first_name, profile?.middle_name, profile?.last_name]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    return names.join(" ") || String(session?.user?.name ?? session?.username ?? session?.userId ?? "Administrator");
  }, [profile, session]);
  const userId = String(session?.userId ?? session?.user?.id ?? profile?.id ?? session?.username ?? userName);

  const role = "Administrator";
  const sidebarToggleLabel = isMobileViewport
    ? (mobileOpen ? "Close navigation" : "Open navigation")
    : (collapsed ? "Expand sidebar" : "Collapse sidebar");
  const nameParts = userName.trim().split(/\s+/).filter(Boolean);
  const initials = nameParts.length > 1
    ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
    : (nameParts[0]?.[0] || "A").toUpperCase();

  const handleLogout = useCallback(async () => {
    try {
      localStorage.removeItem("userInfo");
      sessionStorage.removeItem("userInfo");
      clearWorkspaceBootstrap();
      await logout();
    } finally {
      window.location.href = `/index.html?loggedOut=true&t=${Date.now()}`;
    }
  }, []);

  if (!sessionLoaded || !session) {
    return <WorkspaceGate message="Checking your workspace access…" />;
  }

  if (!workspaceRole || !allowedRoles.includes(workspaceRole)) {
    return <WorkspaceGate message="You do not have access to this workspace. Redirecting…" />;
  }

  return (
    <AdminIdentityContext.Provider value={{ userId, userName, role: workspaceRole, roleLabel: role, profile, updateProfile }}>
    <div className={`peas-admin-shell${collapsed ? " is-collapsed" : ""}`}>
      <AdminSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        contactNewCount={contactNewCount}
        role={workspaceRole}
        isMobileViewport={isMobileViewport}
      />

      <div className="peas-admin-frame">
        <header className="peas-admin-topbar">
          <div className="peas-admin-topbar__left">
            <button
              className={`peas-admin-icon-btn peas-admin-sidebar-toggle${mobileOpen ? " is-mobile-open" : ""}`}
              type="button"
              aria-label={sidebarToggleLabel}
              aria-expanded={isMobileViewport ? mobileOpen : !collapsed}
              aria-controls="peas-admin-sidebar"
              title={sidebarToggleLabel}
              onClick={() => {
                if (isMobileViewport) {
                  setMobileOpen((open) => !open);
                  return;
                }
                setCollapsed(!collapsed);
              }}
            >
              <Menu className="peas-admin-sidebar-toggle__mobile-icon" aria-hidden="true" />
              {collapsed ? <PanelLeftOpen className="peas-admin-sidebar-toggle__desktop-icon" aria-hidden="true" /> : <PanelLeftClose className="peas-admin-sidebar-toggle__desktop-icon" aria-hidden="true" />}
            </button>
          </div>

          <div className="peas-admin-topbar__right">
            <div className="peas-admin-notifications">
            <button className="peas-admin-icon-btn" type="button" aria-label={`Notifications${notificationSummary.unread ? `, ${notificationSummary.unread} unread` : ""}`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); if (!notificationsOpen) void refreshNotifications(); }}>
              <Bell aria-hidden="true" />
              {notificationSummary.unread ? <span className="peas-admin-notification-badge" aria-hidden="true">{notificationSummary.unread > 99 ? "99+" : notificationSummary.unread}</span> : null}
            </button>
            {notificationsOpen ? <AdminNotificationPanel notifications={notifications} onClear={async () => { await clearAdminNotifications(); setNotifications([]); setNotificationSummary({ total: 0, unread: 0, urgent: 0 }); }} onClose={() => setNotificationsOpen(false)} onOpen={async (notification) => { if (!notification.isRead) { await markAdminNotificationRead(notification.id).catch(() => undefined); } setNotificationsOpen(false); if (notification.actionPath) window.location.assign(notification.actionPath); }} /> : null}
            </div>
            <AdminProfileMenu
              initials={initials}
              onLogout={handleLogout}
              profile={profile}
              role={workspaceRole}
              roleLabel={role}
              userName={userName}
            />
          </div>
        </header>

        <div className="peas-admin-content">
          {children}
        </div>
      </div>
    </div>
    </AdminIdentityContext.Provider>
  );
}

function AdminNotificationPanel({ notifications, onClear, onClose, onOpen }: { notifications: AdminNotification[]; onClear: () => Promise<void>; onClose: () => void; onOpen: (notification: AdminNotification) => void }) {
  const [clearing, setClearing] = useState(false);
  return <div className="peas-admin-notification-panel" role="dialog" aria-label="Notifications">
    <header><div><strong>Notifications</strong><small>Items requiring administrator attention</small></div><div className="peas-admin-notification-panel__actions">{notifications.length ? <button type="button" className="peas-admin-notification-clear" disabled={clearing} onClick={() => { setClearing(true); void onClear().finally(() => setClearing(false)); }}>{clearing ? "Clearing…" : "Clear notifications"}</button> : null}<button type="button" aria-label="Close notifications" onClick={onClose}>×</button></div></header>
    {notifications.length ? <div className="peas-admin-notification-list">{notifications.map((notification) => <button type="button" className={`peas-admin-notification${notification.isRead ? " is-read" : ""}`} key={notification.id} onClick={() => void onOpen(notification)}><span className={`peas-admin-notification__icon is-${notification.severity}`}><AlertTriangle aria-hidden="true" /></span><span><strong>{notification.title}</strong><small>{notification.message}</small><em>{notificationActionLabel(notification.type)} <ArrowRight aria-hidden="true" /></em></span></button>)}</div> : <p className="peas-admin-notification-empty">You’re all caught up.</p>}
  </div>;
}

function notificationActionLabel(type: string) {
  if (type === "author_profile_incomplete") return "Complete profile";
  if (type === "contact_recipient_not_configured") return "View configuration";
  if (type === "contact_inquiry_new") return "Open inquiry";
  if (type === "contact_delivery_failed") return "Review delivery";
  if (type === "document_review_pending" || type === "compilation_review_pending") return "Review upload";
  if (type === "classification_migration_pending") return "Review classification";
  return "Open";
}

export function useAdminIdentity() {
  const identity = useContext(AdminIdentityContext);
  if (!identity) throw new Error("useAdminIdentity must be used within AdminLayout");
  return identity;
}

function AdminSidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  contactNewCount,
  role,
  isMobileViewport,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  contactNewCount: number;
  role: WorkspaceRole;
  isMobileViewport: boolean;
}) {
  const visibleNavItems = navItems.filter((item) => item.roles.includes(role));
  const visibleUtilityItems = utilityItems.filter((item) => item.roles.includes(role));
  const showCollapsedTooltips = collapsed && !isMobileViewport;

  return (
    <TooltipProvider delayDuration={180}>
      {mobileOpen ? <button className="peas-admin-sidebar-backdrop" type="button" aria-label="Close navigation" onClick={onCloseMobile} /> : null}
      <aside id="peas-admin-sidebar" className={`peas-admin-sidebar${mobileOpen ? " is-mobile-open" : ""}`} aria-label="Admin navigation">
        <div className="peas-admin-sidebar__brand">
          <img className="peas-admin-sidebar__brand-university" src="/admin/Components/img/logo1.png" alt="" />
          <img className="peas-admin-sidebar__brand-office" src="/admin/Components/img/logo_2.png" alt="" />
          <span>
            <strong>Office of Research & Publications</strong>
          </span>
          {mobileOpen ? (
            <button className="peas-admin-icon-btn peas-admin-sidebar__close" type="button" aria-label="Close navigation" onClick={onCloseMobile}>
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <SidebarTooltip enabled={showCollapsedTooltips} label="Upload Document">
          <a className="peas-admin-upload-link" href="/admin/Components/upload_document.html" aria-label="Upload Document">
            <UploadCloud className="peas-admin-upload-link__icon" aria-hidden="true" />
            <span>Upload Document</span>
          </a>
        </SidebarTooltip>

        <nav className="peas-admin-nav" aria-label="Workspace">
          <small>Workspace</small>
          {visibleNavItems.map((item) => <AdminNavLink item={item} badge={item.label === "Contact Inquiries" ? contactNewCount : 0} tooltipEnabled={showCollapsedTooltips} key={item.href} />)}
        </nav>

        <nav className="peas-admin-nav peas-admin-nav--utility" aria-label="Utilities">
          {visibleUtilityItems.map((item) => <AdminNavLink item={item} tooltipEnabled={showCollapsedTooltips} key={item.href} />)}
        </nav>
      </aside>
    </TooltipProvider>
  );
}

function AdminProfileMenu({
  initials,
  onLogout,
  profile,
  role,
  roleLabel,
  userName,
}: {
  initials: string;
  onLogout: () => Promise<void>;
  profile: UserProfile | null;
  role: WorkspaceRole;
  roleLabel: string;
  userName: string;
}) {
  const profilePicture = profile?.profile_picture ? normalizeProfilePicture(profile.profile_picture) : "";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="peas-admin-user" type="button" aria-label={`Open profile menu for ${userName}`}>
          <Avatar>
            {profilePicture ? <AvatarImage src={profilePicture} alt="" /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="peas-admin-user__details">
            <strong>{userName}</strong>
            <small>{roleLabel}</small>
          </span>
          <ChevronDown className="peas-admin-user__chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="peas-admin-profile-menu"
        collisionPadding={12}
        sideOffset={10}
      >
        <div className="peas-admin-profile-menu__content">
          <div className="peas-admin-profile-menu__identity">
            <Avatar className="peas-admin-profile-menu__avatar">
              {profilePicture ? <AvatarImage src={profilePicture} alt="" /> : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div>
              <strong>{userName}</strong>
              <small>{roleLabel}</small>
            </div>
          </div>

          <div className="peas-admin-profile-menu__items">
            {role === "admin" ? (
              <DropdownMenuItem asChild>
                <a href="/admin/Components/admin_settings.html">
                  <Settings aria-hidden="true" />
                  <span>Settings</span>
                </a>
              </DropdownMenuItem>
            ) : null}
          </div>

          <DropdownMenuSeparator />
          <DropdownMenuItem className="peas-admin-profile-menu__logout" onSelect={() => void onLogout()}>
            <LogOut aria-hidden="true" />
            <span>Logout</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AdminNavLink({ item, badge = 0, tooltipEnabled }: { item: AdminNavigationItem; badge?: number; tooltipEnabled: boolean }) {
  const Icon = item.icon;
  const currentPath = normalizePath(window.location.pathname);
  const active = [item.href, ...(item.activePaths ?? [])].some((path) => currentPath === normalizePath(path));
  const tooltipLabel = badge > 0 ? `${item.label}, ${badge} new inquiries` : item.label;

  return (
    <SidebarTooltip enabled={tooltipEnabled} label={tooltipLabel}>
      <a className={active ? "is-active" : ""} href={item.href} aria-label={item.label} aria-current={active ? "page" : undefined}>
        <Icon aria-hidden="true" />
        <span>{item.label}</span>
        {badge > 0 ? <small className="peas-admin-nav-badge" aria-label={`${badge} new inquiries`}>{badge > 99 ? "99+" : badge}</small> : null}
      </a>
    </SidebarTooltip>
  );
}

function SidebarTooltip({ enabled, label, children }: { enabled: boolean; label: string; children: ReactElement }) {
  if (!enabled) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} collisionPadding={12}>{label}</TooltipContent>
    </Tooltip>
  );
}

function WorkspaceGate({ message }: { message: string }) {
  return (
    <main className="peas-admin-gate" role="status">
      <img src="/admin/Components/img/logo_2.png" alt="" />
      <h1>PeAS Workspace</h1>
      <p>{message}</p>
    </main>
  );
}

function normalizeWorkspaceRole(value: unknown): WorkspaceRole | null {
  const role = String(value ?? "").toLowerCase();
  return role === "admin" ? role : null;
}

function useStoredSidebarState(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() => localStorage.getItem("peas-admin-sidebar-collapsed") === "true");

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    localStorage.setItem("peas-admin-sidebar-collapsed", String(value));
  }, []);

  return [collapsed, setCollapsed];
}

function normalizePath(path: string) {
  return path.replace(/\/+$/, "");
}

function normalizeProfilePicture(path: string) {
  return path.startsWith("http") || path.startsWith("/") ? path : `/${path}`;
}

function readWorkspaceBootstrap(): WorkspaceBootstrap | null {
  try {
    const raw = sessionStorage.getItem(WORKSPACE_BOOTSTRAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceBootstrap;
    if (!parsed.session || Date.now() - Number(parsed.cachedAt) > WORKSPACE_BOOTSTRAP_MAX_AGE) {
      clearWorkspaceBootstrap();
      return null;
    }
    return parsed;
  } catch {
    clearWorkspaceBootstrap();
    return null;
  }
}

function writeWorkspaceBootstrap(value: WorkspaceBootstrap) {
  try {
    sessionStorage.setItem(WORKSPACE_BOOTSTRAP_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in privacy modes; server validation still works.
  }
}

function clearWorkspaceBootstrap() {
  try {
    sessionStorage.removeItem(WORKSPACE_BOOTSTRAP_KEY);
  } catch {
    // Nothing else to clear.
  }
}
