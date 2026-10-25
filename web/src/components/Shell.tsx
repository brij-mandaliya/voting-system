import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth, type AuthUser } from "../contexts/Auth";
import { useRealtime } from "../contexts/Realtime";
import { BrandLockup } from "./Brand";
import {
  IconAudit,
  IconChart,
  IconClose,
  IconDashboard,
  IconKey,
  IconLogout,
  IconMenu,
  IconRooms,
  IconTeams,
  IconUsers,
} from "./icons";

/* --------------------------------- nav ---------------------------------- */

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export function Nav({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1">
      {children}
    </nav>
  );
}

export function NavLinkItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? "bg-ink-200/70 text-ink-950"
            : "text-ink-600 hover:bg-ink-900/[0.055] hover:text-ink-900"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export function ConnectionDot({ compact = false }: { compact?: boolean }) {
  const { connected } = useRealtime();
  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 text-xs text-ink-500"
      title={connected ? "Live updates connected" : "Live updates offline. Refreshing every few seconds instead"}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-jade-600" : "bg-gold-500"}`}
      />
      {compact ? <span className="sr-only">{connected ? "Live" : "Reconnecting"}</span> : connected ? "Live updates on" : "Reconnecting…"}
    </span>
  );
}

/* -------------------------------- shell --------------------------------- */

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // close the mobile drawer whenever the route changes
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(frame);
    };
  }, [drawerOpen]);

  if (!user) return <>{children}</>;

  const isAdmin = user.role === "ADMIN";

  const items: NavItem[] = isAdmin
    ? [
        { to: "/admin", label: "Overview", icon: <IconDashboard size={16} />, end: true },
        { to: "/admin/participants", label: "Participants", icon: <IconUsers size={16} /> },
        { to: "/admin/teams", label: "Teams", icon: <IconTeams size={16} /> },
        { to: "/admin/rooms", label: "Rooms", icon: <IconRooms size={16} /> },
        { to: "/admin/audit", label: "Audit log", icon: <IconAudit size={16} /> },
      ]
    : [
        { to: "/rooms", label: "My rooms", icon: <IconRooms size={16} /> },
        { to: "/my-results", label: "My results", icon: <IconChart size={16} /> },
      ];

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate("/login");
    }
  };

  const navGroup = (
    <>
      <p className="px-3 text-xs text-ink-500">{isAdmin ? "Admin" : "Your rooms and results"}</p>
      <nav aria-label="Main navigation" className="mt-2 space-y-0.5">
        {items.map((item) => (
          <SidebarNavItem key={item.to} item={item} />
        ))}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen bg-frame lg:pl-[228px]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-ink-950 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      {/* desktop: the sidebar is the frame's vertical arm, on the frame tint, no rule */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[228px] flex-col bg-frame px-3 pb-3 pt-4 lg:flex">
        <div className="px-2">
          <BrandLockup />
        </div>
        <div className="mt-7 flex-1 overflow-y-auto scrollbar-slim">{navGroup}</div>
        <div className="px-3 pb-2">
          <ConnectionDot />
        </div>
        <UserPanel user={user} onLogout={handleLogout} />
      </aside>

      {/* phone + tablet: the frame folds to a 48px bar on the frame tint */}
      <header className="sticky top-0 z-30 bg-frame lg:hidden">
        <div className="flex h-12 items-center justify-between gap-3 px-3 sm:px-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="grid h-11 w-11 place-items-center rounded-lg text-ink-700 transition-colors hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <IconMenu size={20} />
            </button>
            <BrandLockup />
          </div>
          <ConnectionDot compact />
        </div>
      </header>

      {/* menu sheet: nav and account */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/45" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] animate-drawer-in flex-col bg-frame px-3 pb-3 pt-3 shadow-lift"
          >
            <div className="flex items-center justify-between gap-3 pl-2">
              <BrandLockup to="/" />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="grid h-11 w-11 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconClose size={18} />
              </button>
            </div>
            <div className="mt-6 flex-1 overflow-y-auto scrollbar-slim">{navGroup}</div>
            <div className="px-3 pb-2">
              <ConnectionDot />
            </div>
            <UserPanel user={user} onLogout={handleLogout} />
          </aside>
        </div>
      )}

      {/* the white sheet: inset 8px from the window's top, right and bottom, 1px edge, no shadow */}
      <div className="lg:py-2 lg:pr-2">
        <main
          id="main-content"
          className="min-h-[calc(100vh-3rem)] bg-white px-4 pb-16 pt-5 sm:px-6 lg:min-h-[calc(100vh-1rem)] lg:rounded-2xl lg:border lg:border-line lg:px-8 lg:pb-10 lg:pt-7"
        >
          <div className="mx-auto w-full max-w-[1240px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarNavItem({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
          isActive ? "bg-ink-200/70 font-medium text-ink-950" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
        }`
      }
    >
      <span className="text-ink-500">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function UserPanel({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => Promise<void>;
}) {
  const role = { ADMIN: "Admin", MODERATOR: "Moderator", PARTICIPANT: "Participant" }[user.role] ?? user.role;
  return (
    <div className="mt-2 flex items-center gap-2.5 rounded-lg px-2 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-200 text-xs font-semibold text-ink-800">
        {initials(user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-900">{user.name}</span>
        <span className="block text-xs text-ink-500">{role}</span>
      </span>
      <NavLink
        to="/change-password"
        aria-label={user.hasPassword ? "Change password" : "Set a password"}
        title={user.hasPassword ? "Change password" : "Set a password"}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconKey size={16} />
      </NavLink>
      <button
        type="button"
        onClick={onLogout}
        aria-label="Log out"
        title="Log out"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconLogout size={16} />
      </button>
    </div>
  );
}
