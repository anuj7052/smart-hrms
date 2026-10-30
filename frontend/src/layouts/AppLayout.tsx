import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

/* Sphere wireframe logomark */
function SphereMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="16" cy="16" rx="13" ry="5"  stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.2" />
      <ellipse cx="16" cy="16" rx="5"  ry="13" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" />
      <line x1="3" y1="16" x2="29" y2="16" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="2.2" fill="currentColor" />
    </svg>
  );
}

type NavItem = {
  to: string;
  label: string;
  icon: string;          // Material Symbols name
  roles: string[];
  badge?: string;
  /** Match active state for these extra paths too (e.g. legacy routes) */
  matchPaths?: string[];
};

type NavSection = {
  id: string;
  /** Section header shown above the items. Omit for the top section. */
  title?: string;
  items: NavItem[];
};

/**
 * Sidebar information architecture.
 *
 * Down from 11 flat items → 6 grouped items, with related pages merged into
 * tabbed hubs (Attendance, Time Off, Devices). Each role only sees what it
 * can actually use, so the sidebar reads cleanly for an Employee, a Manager,
 * HR, an IT Admin or an executive.
 */
const navSections: NavSection[] = [
  {
    id: 'workspace',
    title: 'Workspace',
    items: [
      { to: '/dashboard',  label: 'Home',       icon: 'dashboard',  roles: ['Admin', 'HR', 'Manager', 'Employee'] },
      { to: '/attendance', label: 'Attendance', icon: 'schedule', roles: ['Admin', 'HR', 'Manager', 'Employee'] },
      { to: '/holidays', label: 'Calendar', icon: 'calendar_month', roles: ['Admin', 'HR', 'Manager', 'Employee'] },
      { to: '/essl-live', label: 'ESSL Live', icon: 'fingerprint', roles: ['Admin', 'HR'], badge: 'LIVE' },
      {
        to: '/leaves',
        label: 'Leaves',
        icon: 'event_busy',
        roles: ['Admin', 'HR', 'Manager', 'Employee'],
        matchPaths: ['/leaves', '/wfh', '/approvals'],
      },
    ],
  },
  {
    id: 'people',
    title: 'People',
    items: [
      { to: '/employees', label: 'Employee', icon: 'groups', roles: ['Admin', 'HR'] },
    ],
  },
  {
    id: 'system',
    title: 'System',
    items: [
      {
        to: '/devices',
        label: 'ESSL Control',
        icon: 'security',
        roles: ['Admin', 'HR'],
        matchPaths: ['/essl-manage'],
      },
      { to: '/virtual-login', label: 'Virtual Login', icon: 'cloud_done', roles: ['Admin', 'HR'] },
      { to: '/reports',  label: 'Reports',  icon: 'bar_chart', roles: ['Admin', 'HR'] },
      { to: '/settings', label: 'Settings', icon: 'settings',  roles: ['Admin'] },
    ],
  },
];

const mobileBottomNav = (role?: string) => {
  const items: NavItem[] = [
    { to: '/dashboard',  label: 'Home',       icon: 'dashboard', roles: ['Admin', 'HR', 'Manager', 'Employee'] },
    { to: '/attendance', label: 'Attendance', icon: 'schedule',  roles: ['Admin', 'HR', 'Manager', 'Employee'] },
    { to: '/leaves',   label: 'Leaves',   icon: 'event_busy', roles: ['Admin', 'HR', 'Manager', 'Employee'] },
  ];
  if (role === 'Admin' || role === 'HR') items.push({ to: '/employees', label: 'Staff', icon: 'groups', roles: [] });
  return items.slice(0, 5);
};

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { roleConfig } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => user && item.roles.includes(user.role)),
    }))
    .filter((section) => section.items.length > 0);
  const visibleNav = visibleSections.flatMap((s) => s.items);
  const bottomNav  = mobileBottomNav(user?.role);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const userInitials = user?.name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'SP';

  /* ── Sidebar (shared markup for desktop + mobile drawer) ─────────────── */
  const Sidebar = ({ withClose = false }: { withClose?: boolean }) => (
    <aside className="relative flex h-full w-[clamp(240px,20vw,292px)] overflow-hidden border-r border-[#d7e4f2] bg-[linear-gradient(180deg,#03263f_0%,#06385b_52%,#082c49_100%)] text-white shadow-[0_18px_60px_rgba(0,28,46,0.28)]">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 left-1/2 h-52 w-52 -translate-x-1/2 rounded-full bg-[#6dbdff]/20 blur-[90px]" />
        <div className="absolute top-44 -left-20 h-44 w-44 rounded-full bg-[#0ea5e9]/12 blur-[80px]" />
        <div className="absolute bottom-16 right-[-3.5rem] h-40 w-40 rounded-full bg-[#fd761a]/12 blur-[88px]" />
        <div className="absolute inset-0 bg-noise opacity-[0.07] mix-blend-overlay" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden px-4 py-5">
        {/* Brand */}
        <div className="mb-7 flex items-center gap-3 px-2 shrink-0">
          <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-white/95 text-primary shadow-glow-primary">
            <span className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white to-white/80" />
            <SphereMark size={22} className="relative" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] font-bold leading-none tracking-tight text-white">
              Sphere
            </h1>
            <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-white/[0.52]">Enterprise HR</p>
          </div>
          {withClose && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded-xl p-2 text-white/[0.65] transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>

        <div className="border-t border-white/10 mb-5 shrink-0" />

        {/* Nav (scrollable) */}
        <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1 scrollbar-hide">
        {visibleSections.map((section, idx) => (
          <div key={section.id} className="flex flex-col gap-1.5">
            {section.title && (
              <p
                className={`px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-white/[0.38] ${
                  idx === 0 ? '' : 'mt-1'
                }`}
              >
                {section.title}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {section.items.map(({ to, label, icon, badge, matchPaths }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => {
                    const matched =
                      isActive ||
                      matchPaths?.some((p) => location.pathname.startsWith(p));
                    return `group relative flex items-center gap-3 rounded-2xl px-3.5 py-3 text-[13px] font-semibold tracking-[0.01em] transition-all ${badge ? 'live-border' : ''} ${
                      matched
                        ? 'bg-white/[0.12] text-white shadow-[0_16px_32px_rgba(3,10,20,0.26),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl'
                        : 'text-white/[0.66] hover:bg-white/[0.08] hover:text-white'
                    }`;
                  }}
                >
                  {({ isActive }) => {
                    const matched =
                      isActive ||
                      matchPaths?.some((p) => location.pathname.startsWith(p));
                    return (
                      <>
                        {matched && (
                          <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-white" />
                        )}
                        <span className={`flex h-10 w-10 items-center justify-center rounded-2xl border transition-all ${matched ? 'border-white/[0.12] bg-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'border-transparent bg-white/[0.04] group-hover:border-white/10 group-hover:bg-white/[0.1]'}`}>
                          <span className={`material-symbols-outlined text-[20px] transition-transform ${matched ? 'fill scale-105' : 'group-hover:scale-110'}`}>
                            {icon}
                          </span>
                        </span>
                        <span className="flex-1">{label}</span>
                        {badge && (
                          <span className="flex items-center gap-1 rounded-full border border-red-400/50 bg-red-500/90 px-2 py-1 text-[9px] font-black tracking-[0.18em] text-white shadow-[0_0_12px_rgba(239,68,68,0.6)]">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-80"></span>
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white"></span>
                            </span>
                            {badge}
                          </span>
                        )}
                      </>
                    );
                  }}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        </nav>

        {/* Fixed profile footer */}
        <div className="mt-4 shrink-0 border-t border-white/10 pt-4" ref={profileRef}>
          <div className="relative">
            {profileOpen && (
              <div className="absolute bottom-full left-0 right-0 z-[100] overflow-hidden rounded-t-2xl border border-b-0 border-gray-200 bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.25)] animate-fade-in">
              <div className="border-b border-gray-100 px-4 py-3.5">
                <p className="truncate text-[14px] font-black tracking-tight text-gray-900">{user?.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-gray-500">{user?.email}</p>
                <span
                  className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-[0.16em] text-white"
                  style={{ backgroundColor: roleConfig?.color || '#006591' }}
                >
                  {user?.role}
                </span>
              </div>
              <button
                onClick={() => { navigate('/profile'); setProfileOpen(false); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                <span className="material-symbols-outlined text-[18px]">person</span>
                My Profile
              </button>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
                Sign out
              </button>
              </div>
            )}

            <button
              onClick={() => setProfileOpen((o) => !o)}
              className={`group flex w-full items-center gap-3 border border-white/[0.08] bg-white/[0.06] p-2.5 text-left transition-all hover:bg-white/[0.12] ${profileOpen ? 'rounded-b-2xl rounded-t-none' : 'rounded-2xl'}`}
              aria-label="Open user menu"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-soft-low"
                style={{ backgroundColor: roleConfig?.color || '#006591' }}
              >
                {userInitials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-white">{user?.name}</span>
                <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-white/[0.55]">{user?.role}</span>
              </span>
              <span className="material-symbols-outlined text-[18px] text-white/[0.6] transition-transform group-hover:text-white">
                {profileOpen ? 'expand_more' : 'expand_less'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-background text-on-background antialiased selection:bg-primary-container/30 selection:text-on-primary-container">
      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex fixed left-0 top-0 h-full z-40">
        <Sidebar />
      </div>

      {/* ── Mobile/Tablet Sidebar Drawer ────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative animate-slide-in shadow-2xl">
            <Sidebar withClose />
          </div>
        </div>
      )}

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex-1 lg:ml-[clamp(240px,20vw,292px)] flex flex-col min-w-0">
        {/* Mobile menu trigger (no top bar on desktop) */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed left-3 top-3 z-30 grid h-10 w-10 place-items-center rounded-2xl border border-primary/10 bg-white/90 text-on-surface-variant shadow-[0_8px_20px_rgba(4,32,52,0.08)] backdrop-blur-xl transition-colors hover:bg-white"
          aria-label="Open menu"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>

        {/* Page content */}
        <main className="mx-auto flex-1 w-full max-w-[1480px] px-4 pb-24 pt-16 sm:px-6 md:px-8 md:pb-12 lg:px-10 lg:pt-8">
          <Outlet />
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 backdrop-blur-md border-t border-primary/10 shadow-[0_-4px_20px_rgba(0,101,145,0.08)] flex">
          {bottomNav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-bold transition-colors min-h-[56px] ${
                  isActive
                    ? 'text-primary'
                    : 'text-outline hover:text-on-surface'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${isActive ? 'bg-primary/10' : ''}`}>
                    <span className={`material-symbols-outlined text-[20px] ${isActive ? 'fill' : ''}`}>{icon}</span>
                  </div>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
