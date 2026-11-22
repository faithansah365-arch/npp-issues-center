import { useEffect, useState } from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type CategoryRecord,
  type ConstituencyRecord,
  type DashboardAnalytics,
  type IssueLevel,
  type PollingStationRecord,
  type PublicUser,
  type RegionRecord,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { buildFilterQueryString, EMPTY_FILTERS, type IssueFilterState } from '../lib/filters';

export function ExecutiveDashboard({
  filters,
  onFiltersChange,
  onSelectIssue,
  onNavigateQueue,
  refreshKey,
  effectiveLevel,
}: {
  filters: IssueFilterState;
  onFiltersChange: (next: IssueFilterState) => void;
  onSelectIssue: (issueId: string) => void;
  onNavigateQueue: (preset: Partial<IssueFilterState>) => void;
  refreshKey: number;
  effectiveLevel?: IssueLevel;
}) {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [regions, setRegions] = useState<RegionRecord[]>([]);
  const [constituencies, setConstituencies] = useState<ConstituencyRecord[]>([]);
  const [pollingStations, setPollingStations] = useState<PollingStationRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [owners, setOwners] = useState<PublicUser[]>([]);

  useEffect(() => {
    Promise.all([
      apiRequest<{
        regions: RegionRecord[];
        constituencies: ConstituencyRecord[];
        pollingStations: PollingStationRecord[];
      }>('/api/meta/geography'),
      apiRequest<{ categories: CategoryRecord[] }>('/api/meta/categories'),
      apiRequest<{ users: PublicUser[] }>('/api/issues/assignable-users'),
    ])
      .then(([geo, cats, assignables]) => {
        setRegions(geo.regions);
        setConstituencies(geo.constituencies);
        setPollingStations(geo.pollingStations);
        setCategories(cats.categories);
        setOwners(assignables.users);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = buildFilterQueryString(filters);
    apiRequest<DashboardAnalytics>(`/api/issues/analytics${qs}`)
      .then(setAnalytics)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [filters, refreshKey]);

  if (!user) return null;

  const filteredConstituencies = filters.regionId
    ? constituencies.filter((c) => c.regionId === filters.regionId)
    : constituencies;
  const filteredStations = filters.constituencyId
    ? pollingStations.filter((p) => p.constituencyId === filters.constituencyId)
    : filters.regionId
      ? pollingStations.filter((p) => p.regionId === filters.regionId)
      : pollingStations;

  const activeLevel: IssueLevel =
    effectiveLevel ?? (user.role === 'SUPER_ADMIN' ? 'NATIONAL' : (user.role as IssueLevel));

  const selectedRegionName = regions.find((r) => r.id === filters.regionId)?.name;
  const selectedConstituencyName = constituencies.find((c) => c.id === filters.constituencyId)?.name;
  const selectedStationName = pollingStations.find((p) => p.id === filters.pollingStationId)?.name;

  const roleHeadline =
    activeLevel === 'POLLING_STATION'
      ? `Station Reports · ${selectedStationName || user.pollingStationName || 'All Polling Stations'}`
      : activeLevel === 'CONSTITUENCY'
        ? `Constituency Operations · ${selectedConstituencyName || user.constituencyName || 'All Constituencies'}`
        : activeLevel === 'REGIONAL'
          ? `Regional Operations · ${selectedRegionName || user.regionName || 'All 16 Regions'}`
          : 'National Executive Overview · All 16 Regions';

  const maxBreakdownCount = (items: Array<{ label: string; count: number }>) =>
    Math.max(1, ...items.map((i) => i.count));

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-blue-800">
            {user.role === 'SUPER_ADMIN' ? 'Super Admin Portal View' : 'Approved Scope Overview'}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight mt-0.5">
            {roleHeadline}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 whitespace-nowrap"
          >
            <Filter className="w-4 h-4" />
            <span>{showFilters ? 'Hide Filters' : 'Filter Analytics'}</span>
          </button>
          <button
            type="button"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="min-h-[44px] px-3.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1.5 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Super Admin Quick Jurisdiction Scope Bar for Lower Portals */}
      {user.role === 'SUPER_ADMIN' && activeLevel !== 'NATIONAL' && (
        <section
          aria-label="Jurisdiction Scope Selector"
          className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Inspect Region
            </label>
            <select
              value={filters.regionId}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  regionId: e.target.value,
                  constituencyId: '',
                  pollingStationId: '',
                })
              }
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
            >
              <option value="">All 16 Regions</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {(activeLevel === 'CONSTITUENCY' || activeLevel === 'POLLING_STATION') && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Inspect Constituency ({filteredConstituencies.length})
              </label>
              <select
                value={filters.constituencyId}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    constituencyId: e.target.value,
                    pollingStationId: '',
                  })
                }
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
              >
                <option value="">All Constituencies in Scope</option>
                {filteredConstituencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {activeLevel === 'POLLING_STATION' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Inspect Polling Station ({filteredStations.length})
              </label>
              <select
                value={filters.pollingStationId}
                onChange={(e) => onFiltersChange({ ...filters, pollingStationId: e.target.value })}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
              >
                <option value="">All Registered Stations</option>
                {filteredStations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
      )}

      {/* Multi-Filter Bar */}
      {showFilters && (
        <section
          aria-label="Scope Analytics Filters"
          className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From Date</label>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => onFiltersChange({ ...filters, fromDate: e.target.value })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To Date</label>
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => onFiltersChange({ ...filters, toDate: e.target.value })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs"
            />
          </div>
          {regions.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Region</label>
              <select
                value={filters.regionId}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    regionId: e.target.value,
                    constituencyId: '',
                    pollingStationId: '',
                  })
                }
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
              >
                <option value="">All Approved Regions</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {filteredConstituencies.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Constituency</label>
              <select
                value={filters.constituencyId}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    constituencyId: e.target.value,
                    pollingStationId: '',
                  })
                }
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
              >
                <option value="">All Approved Constituencies</option>
                {filteredConstituencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {filteredStations.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Polling Station
              </label>
              <select
                value={filters.pollingStationId}
                onChange={(e) => onFiltersChange({ ...filters, pollingStationId: e.target.value })}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
              >
                <option value="">All Approved Stations</option>
                {filteredStations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            <select
              value={filters.categoryId}
              onChange={(e) => onFiltersChange({ ...filters, categoryId: e.target.value })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
            <select
              value={filters.priority}
              onChange={(e) => onFiltersChange({ ...filters, priority: e.target.value })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
            >
              <option value="">All Priorities</option>
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
            >
              <option value="">All Statuses</option>
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Assigned Owner</label>
            <select
              value={filters.assignedToUserId}
              onChange={(e) => onFiltersChange({ ...filters, assignedToUserId: e.target.value })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs bg-white"
            >
              <option value="">Any Owner</option>
              <option value="UNASSIGNED">Unassigned</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fullName}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((k) => (
            <div
              key={k}
              className="h-28 rounded-xl border border-slate-200 bg-white animate-pulse"
            />
          ))}
        </div>
      )}

      {analytics && (
        <>
          {/* Primary KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => onNavigateQueue({ status: '' })}
              className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors"
            >
              <p className="text-xs font-medium text-slate-500">Open Issues</p>
              <p className="font-display text-3xl font-semibold text-slate-900 tabular-nums mt-2">
                {analytics.openIssues}
              </p>
              <p className="text-xs text-slate-500 mt-1 tabular-nums">
                Out of {analytics.totalInScope} total in scope
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateQueue({ priority: 'Urgent' })}
              className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-red-300 transition-colors"
            >
              <p className="text-xs font-medium text-red-700">Urgent Open</p>
              <p className="font-display text-3xl font-semibold text-red-700 tabular-nums mt-2">
                {analytics.urgentIssues}
              </p>
              <p className="text-xs text-slate-500 mt-1">Immediate attention priority</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateQueue({ essentialOnly: true })}
              className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
            >
              <p className="text-xs font-medium text-blue-800">Essential Tag</p>
              <p className="font-display text-3xl font-semibold text-blue-900 tabular-nums mt-2">
                {analytics.essentialIssues}
              </p>
              <p className="text-xs text-slate-500 mt-1">Core party & operational matters</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateQueue({ overdueOnly: true })}
              className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-amber-300 transition-colors"
            >
              <p className="text-xs font-medium text-amber-800">Overdue Follow-Ups</p>
              <p className="font-display text-3xl font-semibold text-amber-800 tabular-nums mt-2">
                {analytics.overdueFollowUps}
              </p>
              <p className="text-xs text-slate-500 mt-1">Past scheduled follow-up date</p>
            </button>
          </div>

          {/* Secondary Performance Metrics Strip */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-slate-500">Avg. Time to First Response</p>
              <p className="font-mono text-xl font-semibold text-slate-900 tabular-nums mt-1">
                {analytics.avgFirstResponseHours !== null
                  ? `${analytics.avgFirstResponseHours} hrs`
                  : 'No responses yet'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Escalation Rate</p>
              <p className="font-mono text-xl font-semibold text-slate-900 tabular-nums mt-1">
                {analytics.escalationRatePercent}%
              </p>
              <p className="text-xs text-slate-500 tabular-nums">
                {analytics.escalatedIssues} escalated upward
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Resolution & Closure Rate</p>
              <p className="font-mono text-xl font-semibold text-emerald-700 tabular-nums mt-1">
                {analytics.resolutionRatePercent}%
              </p>
              <p className="text-xs text-slate-500 tabular-nums">
                {analytics.resolvedIssues} resolved · {analytics.closedIssues} closed
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Confirmed Recurring Clusters</p>
              <p className="font-mono text-xl font-semibold text-slate-900 tabular-nums mt-1">
                {analytics.recurringClustersCount}
              </p>
              <p className="text-xs text-slate-500">Executive-verified groupings</p>
            </div>
          </div>

          {/* Breakdowns Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[
              { title: 'Issues by Status', rows: analytics.byStatus },
              { title: 'Issues by Category', rows: analytics.byCategory },
              { title: 'Issues by Location', rows: analytics.byLocation },
              { title: 'Issues by Assigned Owner', rows: analytics.byOwner },
            ].map((section) => {
              const maxVal = maxBreakdownCount(section.rows);
              return (
                <div
                  key={section.title}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
                >
                  <h2 className="text-sm font-semibold text-slate-900">{section.title}</h2>
                  {section.rows.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4">
                      No saved reports match the current scope and filters.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {section.rows.slice(0, 6).map((row) => (
                        <div key={row.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-700 truncate pr-3">{row.label}</span>
                            <span className="font-mono tabular-nums font-medium text-slate-900">
                              {row.count}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full bg-blue-800 rounded-full"
                              style={{ width: `${Math.round((row.count / maxVal) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Recent Scoped Activity */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Recent Scoped Activity</h2>
              <span className="text-xs text-slate-500">Audit-tracked actions</span>
            </div>
            {analytics.recentActivity.length === 0 ? (
              <p className="p-6 text-xs text-slate-500">
                No recent activity recorded within your approved jurisdiction.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {analytics.recentActivity.map((act, idx) => (
                  <button
                    key={`${act.issueId}-${idx}`}
                    type="button"
                    onClick={() => onSelectIssue(act.issueId)}
                    className="w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {act.title}
                      </p>
                      <p className="text-xs text-slate-600 truncate">
                        <span className="font-mono text-slate-700">{act.referenceCode}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{act.actorName}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{act.summary}</span>
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                      {new Date(act.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
