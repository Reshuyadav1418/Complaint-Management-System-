import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import {
  Menu,
  LogOut,
  KeyRound,
  X,
  ChevronDown,
  Search,
  Star,
  Plus,
  HelpCircle,
  Grid,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { NotificationBell } from '../components/NotificationBell.jsx';

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.key === 'Escape' || e.type === 'mousedown') setOpen(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('mousedown', close);
    };
  }, [open]);

  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded px-2 py-1 text-slate-700 hover:bg-slate-100"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white shadow-sm">
          {initials}
        </span>
        <span className="hidden text-xs font-medium text-slate-700 sm:block">
          Log out as <strong className="text-slate-900">{user.name}</strong>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-800">{user.name}</p>
            <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
          </div>
          <NavLink role="menuitem" to="/account/password" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
            <KeyRound className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Change password
          </NavLink>
          <button role="menuitem" type="button" onClick={() => logout(false)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
            <LogOut className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Sign out
          </button>
          <button role="menuitem" type="button" onClick={() => logout(true)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50">
            <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out on all devices
          </button>
        </div>
      )}
    </div>
  );
}

const EQMS_TABS = [
  { label: 'Complaints', to: '/complaints' },
  { label: 'Dashboard', to: '/' },
  { label: 'Settings', to: '/admin/settings' },
  { label: 'Change Control Requests', to: '#' },
  { label: 'Change Controls', to: '#' },
  { label: 'Chatter', to: '#' },
  { label: 'Reports', to: '/reports' },
  { label: 'Dashboards', to: '#' },
  { label: 'Deviations', to: '#' },
  { label: 'Deviation Request', to: '#' },
  { label: 'AuditPlans', to: '/admin/audit-logs' },
];

export function AppShell() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-slate-900 flex flex-col font-sans">
      {/* Salesforce / EQMS Top App Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        {/* Top utility row */}
        <div className="flex h-12 items-center justify-between px-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((o) => !o)}
              className="rounded p-1 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Toggle Navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded bg-blue-600 text-white shadow-sm">
                <Grid className="h-4 w-4" />
              </span>
              <span className="font-bold tracking-tight text-slate-800 text-base">EQMS</span>
            </div>
            <span className="hidden sm:inline-block text-xs text-slate-400 font-medium border-l border-slate-200 pl-2">
              Natural Remedies
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search..."
                className="h-8 w-48 lg:w-64 rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <button type="button" className="hidden sm:flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-amber-500" title="Favorites">
              <Star className="h-3.5 w-3.5" />
            </button>
            <Link to="/complaints" className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50" title="Quick Add">
              <Plus className="h-3.5 w-3.5" />
            </Link>
            <button type="button" className="hidden sm:flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50" title="Help">
              <HelpCircle className="h-3.5 w-3.5" />
            </button>

            {/* In-App Notifications Bell */}
            <NotificationBell />

            {/* User Menu */}
            <UserMenu />
          </div>
        </div>

        {/* Horizontal Navigation Tabs (Salesforce Ribbon style) */}
        <div className="border-t border-slate-200 bg-[#f8fafc] px-3 sm:px-6 overflow-x-auto no-scrollbar">
          <nav className="flex space-x-1 sm:space-x-3 text-xs">
            {EQMS_TABS.map((tab) => {
              const isMatch = tab.to !== '#' && (tab.to === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.to));
              return (
                <NavLink
                  key={tab.label}
                  to={tab.to}
                  className={`whitespace-nowrap px-3 py-2 font-medium transition-colors border-b-2 -mb-[1px] ${
                    isMatch
                      ? 'border-blue-600 text-blue-700 bg-white shadow-xs font-semibold'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
