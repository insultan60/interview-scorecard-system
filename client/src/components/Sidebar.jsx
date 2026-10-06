import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, GitBranch, Users, ScrollText,
  Settings as SettingsIcon, LogOut, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import redstarIcon from '../assets/redstar-icon.png';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/requisitions', label: 'Job Openings', icon: Briefcase },
  { to: '/pipelines', label: 'Hiring Process', icon: GitBranch },
  { to: '/candidates', label: 'Candidates', icon: Users },
  { to: '/audit-log', label: 'Audit Log', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const SIDEBAR_COLLAPSED_KEY = 'interview_scorecard_sidebar_collapsed';

export default function Sidebar({ isOpen = false, onClose = () => { } }) {
  const { user, logout } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    }
    return false;
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-screen flex-shrink-0 flex-col border-r border-gray-200 bg-white transition-all duration-300 ease-in-out md:relative md:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      } ${isCollapsed ? 'md:w-16' : 'md:w-60'} w-60`}
    >
      {/* Header */}
      <div className="relative flex items-center justify-between gap-2 px-3 py-3.5 border-b border-gray-100 min-h-[60px]">
        <div className={`flex items-center gap-2.5 overflow-hidden ${isCollapsed ? 'md:justify-center md:w-full' : ''}`}>
          <img
            src={redstarIcon}
            alt="Red Star Technologies"
            className="h-8 w-8 flex-shrink-0 object-contain"
            title="Interview Scorecard - Red Star Technologies"
          />
          {!isCollapsed && (
            <div className="min-w-0 transition-opacity duration-200 hidden md:block">
              <h1 className="truncate text-sm font-bold text-gray-900 leading-tight">Interview Scorecard</h1>
              <p className="text-[11px] text-gray-400">Red Star Technologies</p>
            </div>
          )}
          <div className="min-w-0 md:hidden">
            <h1 className="truncate text-sm font-bold text-gray-900 leading-tight">Interview Scorecard</h1>
            <p className="text-[11px] text-gray-400">Red Star Technologies</p>
          </div>
        </div>

        {/* Mobile close button */}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 md:hidden"
          title="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Desktop collapse toggle button */}
        <button
          type="button"
          onClick={toggleCollapse}
          className={`hidden md:flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-100 hover:text-gray-900 transition-colors flex-shrink-0 ${
            isCollapsed ? 'absolute -right-3 top-4 border-gray-300 z-50 bg-white shadow' : ''
          }`}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1.5 px-2 py-3 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            title={isCollapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors ${
                isCollapsed
                  ? 'md:justify-center md:px-0 px-3'
                  : 'px-3'
              } ${
                isActive
                  ? 'bg-[#d21e2b] text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className={`${isCollapsed ? 'md:hidden' : 'block'} truncate`}>
              {label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Footer / User & Logout */}
      <div className="border-t border-gray-200 p-3">
        <div className={`mb-2 text-xs text-gray-500 ${isCollapsed ? 'md:hidden px-2' : 'px-3'}`}>
          <div className="font-medium text-gray-800 truncate">{user?.name}</div>
          <div className="text-gray-400 capitalize truncate">{user?.role}</div>
        </div>

        <button
          type="button"
          onClick={logout}
          title={isCollapsed ? 'Log out' : undefined}
          className={`flex w-full items-center gap-2 rounded-md py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors ${
            isCollapsed ? 'md:justify-center md:px-0 px-3' : 'px-3'
          }`}
        >
          <LogOut className="h-4 w-4 flex-shrink-0 text-gray-500" />
          <span className={isCollapsed ? 'md:hidden' : 'block'}>Log out</span>
        </button>
      </div>
    </aside>
  );
}
