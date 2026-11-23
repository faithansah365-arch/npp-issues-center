import { Suspense, lazy, useState } from 'react';
import type { IssueLevel } from '../shared/types';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OfflineIndicator } from './components/OfflineIndicator';
import type { ExecutiveTab, SuperAdminWorkspace } from './components/PortalShell';
import { EMPTY_FILTERS, type IssueFilterState } from './lib/filters';

const AuthScreen = lazy(() =>
  import('./components/AuthScreen').then((m) => ({ default: m.AuthScreen })),
);
const PlatformAdminPortal = lazy(() =>
  import('./components/PlatformAdminPortal').then((m) => ({ default: m.PlatformAdminPortal })),
);
const PortalShell = lazy(() =>
  import('./components/PortalShell').then((m) => ({ default: m.PortalShell })),
);
const ExecutiveDashboard = lazy(() =>
  import('./components/ExecutiveDashboard').then((m) => ({ default: m.ExecutiveDashboard })),
);
const IssueList = lazy(() =>
  import('./components/IssueList').then((m) => ({ default: m.IssueList })),
);
const RecurringConcernsView = lazy(() =>
  import('./components/RecurringConcernsView').then((m) => ({
    default: m.RecurringConcernsView,
  })),
);
const NotificationsView = lazy(() =>
  import('./components/NotificationsView').then((m) => ({ default: m.NotificationsView })),
);
const IssueFormModal = lazy(() =>
  import('./components/IssueFormModal').then((m) => ({ default: m.IssueFormModal })),
);
const IssueDetailDrawer = lazy(() =>
  import('./components/IssueDetailDrawer').then((m) => ({ default: m.IssueDetailDrawer })),
);

function RouteLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6 text-xs font-medium text-[#071A4D]/80">
      {label}
    </div>
  );
}

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
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center p-6 text-sm font-medium text-[#071A4D]">
        Loading NPP Internal Issue Portal…
      </div>
    );
  }

  if (isAdminRoute && (!user || user.role !== 'SUPER_ADMIN')) {
    return (
      <Suspense fallback={<RouteLoader label="Loading Platform Admin…" />}>
        <PlatformAdminPortal />
      </Suspense>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<RouteLoader label="Loading NPP Portal…" />}>
        <AuthScreen />
      </Suspense>
    );
  }

  if (user.role === 'SUPER_ADMIN' && adminWorkspace === 'admin') {
    return (
      <Suspense fallback={<RouteLoader label="Loading Platform Admin…" />}>
        <PlatformAdminPortal onSwitchWorkspace={handleSwitchWorkspace} />
      </Suspense>
    );
  }

  const effectiveLevel: IssueLevel | undefined =
    user.role === 'SUPER_ADMIN' && adminWorkspace !== 'admin' ? adminWorkspace : undefined;

  function handleNavigateQueue(preset: Partial<IssueFilterState>) {
    setFilters({ ...EMPTY_FILTERS, ...preset });
    setActiveTab('issues');
  }

  return (
    <Suspense fallback={<RouteLoader label="Loading Executive Portal…" />}>
      <PortalShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNewIssue={() => setCreateOpen(true)}
        portalLevelOverride={effectiveLevel}
        onSwitchWorkspace={user.role === 'SUPER_ADMIN' ? handleSwitchWorkspace : undefined}
      >
        <Suspense fallback={<RouteLoader />}>
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
        </Suspense>
      </PortalShell>

      {createOpen && (
        <Suspense fallback={null}>
          <IssueFormModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            effectiveLevel={effectiveLevel}
            onCreated={(issue) => {
              setRefreshKey((k) => k + 1);
              setSelectedIssueId(issue.id);
            }}
          />
        </Suspense>
      )}

      {selectedIssueId && (
        <Suspense fallback={null}>
          <IssueDetailDrawer
            issueId={selectedIssueId}
            onClose={() => setSelectedIssueId(null)}
            onMutated={() => setRefreshKey((k) => k + 1)}
            onOpenIssue={(id) => setSelectedIssueId(id)}
          />
        </Suspense>
      )}
    </Suspense>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRouter />
        <OfflineIndicator />
      </AuthProvider>
    </ThemeProvider>
  );
}
