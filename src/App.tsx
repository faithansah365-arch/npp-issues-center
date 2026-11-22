import { useState } from 'react';
import type { IssueLevel } from '../shared/types';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthScreen } from './components/AuthScreen';
import { ExecutiveDashboard } from './components/ExecutiveDashboard';
import { IssueDetailDrawer } from './components/IssueDetailDrawer';
import { IssueFormModal } from './components/IssueFormModal';
import { IssueList } from './components/IssueList';
import { NotificationsView } from './components/NotificationsView';
import { PlatformAdminPortal } from './components/PlatformAdminPortal';
import {
  PortalShell,
  type ExecutiveTab,
  type SuperAdminWorkspace,
} from './components/PortalShell';
import { RecurringConcernsView } from './components/RecurringConcernsView';
import { EMPTY_FILTERS, type IssueFilterState } from './lib/filters';

function AppRouter() {
  const { user, loading } = useAuth();
  const isAdminRoute = window.location.pathname.startsWith('/platform-admin');

  const [adminWorkspace, setAdminWorkspace] = useState<SuperAdminWorkspace>('admin');
  const [activeTab, setActiveTab] = useState<ExecutiveTab>('dashboard');
  const [filters, setFilters] = useState<IssueFilterState>(EMPTY_FILTERS);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSwitchWorkspace(next: SuperAdminWorkspace) {
    setAdminWorkspace(next);
    setFilters(EMPTY_FILTERS);
    setActiveTab('dashboard');
    setSelectedIssueId(null);
    if (next === 'admin') {
      if (!window.location.pathname.startsWith('/platform-admin')) {
        window.history.replaceState({}, '', '/platform-admin');
      }
    } else if (window.location.pathname.startsWith('/platform-admin')) {
      window.history.replaceState({}, '', '/');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center p-6 text-sm text-[#071A4D]">
        Loading NPP Internal Issue Portal…
      </div>
    );
  }

  if (isAdminRoute && (!user || user.role !== 'SUPER_ADMIN')) {
    return <PlatformAdminPortal />;
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (user.role === 'SUPER_ADMIN' && adminWorkspace === 'admin') {
    return <PlatformAdminPortal onSwitchWorkspace={handleSwitchWorkspace} />;
  }

  const effectiveLevel: IssueLevel | undefined =
    user.role === 'SUPER_ADMIN' && adminWorkspace !== 'admin' ? adminWorkspace : undefined;

  function handleNavigateQueue(preset: Partial<IssueFilterState>) {
    setFilters({ ...EMPTY_FILTERS, ...preset });
    setActiveTab('issues');
  }

  return (
    <>
      <PortalShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNewIssue={() => setCreateOpen(true)}
        portalLevelOverride={effectiveLevel}
        onSwitchWorkspace={user.role === 'SUPER_ADMIN' ? handleSwitchWorkspace : undefined}
      >
        {activeTab === 'dashboard' && (
          <ExecutiveDashboard
            filters={filters}
            onFiltersChange={setFilters}
            onSelectIssue={(id) => setSelectedIssueId(id)}
            onNavigateQueue={handleNavigateQueue}
            refreshKey={refreshKey}
            effectiveLevel={effectiveLevel}
          />
        )}

        {activeTab === 'issues' && (
          <IssueList
            filters={filters}
            onFiltersChange={setFilters}
            onSelectIssue={(id) => setSelectedIssueId(id)}
            onNewIssue={() => setCreateOpen(true)}
            refreshKey={refreshKey}
            effectiveLevel={effectiveLevel}
          />
        )}

        {activeTab === 'recurring' && (
          <RecurringConcernsView
            onSelectIssue={(id) => setSelectedIssueId(id)}
            refreshKey={refreshKey}
          />
        )}

        {activeTab === 'notifications' && (
          <NotificationsView
            onSelectIssue={(id) => setSelectedIssueId(id)}
            refreshKey={refreshKey}
          />
        )}
      </PortalShell>

      <IssueFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        effectiveLevel={effectiveLevel}
        onCreated={(issue) => {
          setRefreshKey((k) => k + 1);
          setSelectedIssueId(issue.id);
        }}
      />

      <IssueDetailDrawer
        issueId={selectedIssueId}
        onClose={() => setSelectedIssueId(null)}
        onMutated={() => setRefreshKey((k) => k + 1)}
        onOpenIssue={(id) => setSelectedIssueId(id)}
      />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
