import React, { useState } from 'react';
import {
  Bell,
  FilePlus2,
  GitMerge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import { USER_ROLE_LABELS, type IssueLevel } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { BrandMark } from './BrandMark';
import { PrivacyComplianceModal } from './PrivacyComplianceModal';
import { PWAInstallButton } from './PWAInstallButton';

export type ExecutiveTab = 'dashboard' | 'issues' | 'recurring' | 'notifications';
export type SuperAdminWorkspace = 'admin' | IssueLevel;

const WORKSPACE_LABELS: Record<SuperAdminWorkspace, string> = {
  admin: 'Platform Admin Console',
  POLLING_STATION: 'Polling Station Portal',
  CONSTITUENCY: 'Constituency Portal',
  REGIONAL: 'Regional Portal',
  NATIONAL: 'National Portal',
};

export function PortalShell({
  activeTab,
  onTabChange,
  onNewIssue,
  portalLevelOverride,
  onSwitchWorkspace,
  children,
}: {
  activeTab: ExecutiveTab;
  onTabChange: (tab: ExecutiveTab) => void;
  onNewIssue: () => void;
  portalLevelOverride?: IssueLevel;
  onSwitchWorkspace?: (workspace: SuperAdminWorkspace) => void;
  children: React.ReactNode;
}) {
  const { user, unreadNotifications, logout } = useAuth();
  const [privacyOpen, setPrivacyOpen] = useState(false);

  if (!user) return null;

  const effectiveLevel: IssueLevel =
    portalLevelOverride ?? (user.role === 'SUPER_ADMIN' ? 'NATIONAL' : (user.role as IssueLevel));

  const scopeSummary =
    user.role === 'SUPER_ADMIN'
      ? 'Super Admin Access · All 16 Regions'
      : effectiveLevel === 'NATIONAL'
        ? 'Nationwide (All 16 Regions)'
        : effectiveLevel === 'REGIONAL'
          ? `${user.regionName || 'Assigned Region'}`
          : effectiveLevel === 'CONSTITUENCY'
            ? `${user.constituencyName || 'Constituency'} · ${user.regionName || ''}`
            : `${user.pollingStationName || 'Polling Station'} · ${user.constituencyName || ''}`;

  const portalTitle =
    effectiveLevel === 'POLLING_STATION'
      ? 'Polling Station Portal'
      : effectiveLevel === 'CONSTITUENCY'
        ? 'Constituency Portal'
        : effectiveLevel === 'REGIONAL'
          ? 'Regional Portal'
          : 'National Portal';

  const navItems: Array<{
    id: ExecutiveTab;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'dashboard', label: 'Overview', shortLabel: 'Overview', icon: LayoutDashboard },
    { id: 'issues', label: 'Issues Queue', shortLabel: 'Issues', icon: ListChecks },
    { id: 'recurring', label: 'Recurring Concerns', shortLabel: 'Recurring', icon: GitMerge },
    {
      id: 'notifications',
      label: 'Notifications',
      shortLabel: 'Alerts',
      icon: Bell,
      badge: unreadNotifications,
    },
  ];

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col lg:flex-row">
      {/* Desktop Sidebar (260px) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="grid grid-cols-3 h-1 w-full shrink-0" aria-hidden="true">
          <div className="bg-[#D41118]" />
          <div className="bg-white border-b border-slate-200/70" />
          <div className="bg-[#0B2B7E]" />
        </div>
        <div className="h-15 px-5 flex items-center gap-3 border-b border-slate-200">
          <BrandMark size={28} />
          <span className="font-display text-base font-semibold text-[#071A4D] whitespace-nowrap truncate">
            NPP Issue Portal
          </span>
        </div>

        <div className="p-4 border-b border-slate-200 space-y-1 bg-[#EEF3FC]/40">
          <p className="text-xs font-semibold text-[#B30E14]">{portalTitle}</p>
          <p className="text-sm font-medium text-slate-900 truncate">{user.fullName}</p>
          <p className="text-xs text-slate-500 truncate">{user.titleOrOffice}</p>
          <p className="text-xs text-slate-600 pt-1 leading-snug">{scopeSummary}</p>
        </div>

        {user.role === 'SUPER_ADMIN' && onSwitchWorkspace && (
          <div className="p-3 border-b border-slate-200 bg-slate-50/70 space-y-2">
            <label
              htmlFor="sidebar-portal-switch"
              className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider"
            >
              Switch Portal View
            </label>
            <select
              id="sidebar-portal-switch"
              value={effectiveLevel}
              onChange={(e) => onSwitchWorkspace(e.target.value as SuperAdminWorkspace)}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900"
            >
              <option value="POLLING_STATION">{WORKSPACE_LABELS.POLLING_STATION}</option>
              <option value="CONSTITUENCY">{WORKSPACE_LABELS.CONSTITUENCY}</option>
              <option value="REGIONAL">{WORKSPACE_LABELS.REGIONAL}</option>
              <option value="NATIONAL">{WORKSPACE_LABELS.NATIONAL}</option>
            </select>
            <button
              type="button"
              onClick={() => onSwitchWorkspace('admin')}
              className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium text-slate-800 flex items-center gap-2 whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span>Platform Admin Console</span>
            </button>
          </div>
        )}

        <nav className="flex-1 p-3 space-y-1" aria-label="Portal Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`w-full min-h-[44px] px-3.5 rounded-lg flex items-center justify-between text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#EEF3FC] text-[#0B2B7E] font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="text-xs font-mono tabular-nums font-semibold text-[#D41118]">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-1">
          <PWAInstallButton variant="sidebar" />
          <button
            type="button"
            onClick={() => setPrivacyOpen(true)}
            className="w-full min-h-[44px] px-3.5 rounded-lg flex items-center gap-3 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap"
          >
            <Shield className="w-4 h-4 shrink-0" />
            <span>Privacy & Data Notice</span>
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full min-h-[44px] px-3.5 rounded-lg flex items-center gap-3 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-800 whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        {/* Top Bar: 3 zones on desktop, compact 52px on mobile */}
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-slate-200">
          <div className="lg:hidden grid grid-cols-3 h-1 w-full" aria-hidden="true">
            <div className="bg-[#D41118]" />
            <div className="bg-white border-b border-slate-200/70" />
            <div className="bg-[#0B2B7E]" />
          </div>
          <div className="h-14 lg:h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="lg:hidden">
                <BrandMark size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#071A4D] truncate">
                  {portalTitle}
                </p>
                <p className="hidden sm:block text-xs text-slate-500 truncate">
                  {USER_ROLE_LABELS[user.role]} · {scopeSummary}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {user.role === 'SUPER_ADMIN' && onSwitchWorkspace && (
                <div className="lg:hidden flex items-center gap-1.5">
                  <select
                    aria-label="Switch Portal View"
                    value={effectiveLevel}
                    onChange={(e) => onSwitchWorkspace(e.target.value as SuperAdminWorkspace)}
                    className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800"
                  >
                    <option value="POLLING_STATION">Station</option>
                    <option value="CONSTITUENCY">Constituency</option>
                    <option value="REGIONAL">Regional</option>
                    <option value="NATIONAL">National</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              )}
              <div className="lg:hidden">
                <PWAInstallButton variant="header" />
              </div>
              <button
                type="button"
                onClick={onNewIssue}
                className="min-h-[40px] px-3 sm:px-4 rounded-lg bg-[#0B2B7E] text-white text-xs sm:text-sm font-medium hover:bg-[#071E5C] transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0"
              >
                <FilePlus2 className="w-4 h-4 shrink-0" />
                <span className="hidden xs:inline sm:inline">Report Concern</span>
                <span className="xs:hidden sm:hidden">Report</span>
              </button>
              <button
                type="button"
                onClick={() => setPrivacyOpen(true)}
                className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                aria-label="Privacy & Data Notice"
              >
                <Shield className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                aria-label="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-6 pb-24 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Tab Bar with safe-area padding */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 safe-pb"
        aria-label="Mobile Navigation"
      >
        <div className="h-15 grid grid-cols-4 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 relative ${
                  active ? 'text-[#0B2B7E] font-semibold' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] tracking-tight whitespace-nowrap">
                  {item.shortLabel}
                </span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="absolute top-1.5 right-4 text-[10px] font-mono tabular-nums font-bold text-[#D41118]">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <PrivacyComplianceModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}
