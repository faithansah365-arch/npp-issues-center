import { useEffect, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import {
  ISSUE_LEVEL_LABELS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type CategoryRecord,
  type ConstituencyRecord,
  type IssueLevel,
  type IssueRecord,
  type PollingStationRecord,
  type PublicUser,
  type RegionRecord,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { buildFilterQueryString, EMPTY_FILTERS, type IssueFilterState } from '../lib/filters';

interface IssueWithOverdue extends IssueRecord {
  isOverdue?: boolean;
}

export function IssueList({
  filters,
  onFiltersChange,
  onSelectIssue,
  onNewIssue,
  refreshKey,
  effectiveLevel,
}: {
  filters: IssueFilterState;
  onFiltersChange: (next: IssueFilterState) => void;
  onSelectIssue: (issueId: string) => void;
  onNewIssue: () => void;
  refreshKey: number;
  effectiveLevel?: IssueLevel;
}) {
  const { user } = useAuth();
  const [issues, setIssues] = useState<IssueWithOverdue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueMode, setQueueMode] = useState<'all' | 'here' | 'urgent' | 'overdue' | 'closed'>('all');

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
    apiRequest<{ issues: IssueWithOverdue[] }>(`/api/issues${qs}`)
      .then((res) => {
        setIssues(res.issues);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [filters, refreshKey]);

  if (!user) return null;

  const activeLevel: IssueLevel =
    effectiveLevel ?? (user.role === 'SUPER_ADMIN' ? 'NATIONAL' : (user.role as IssueLevel));

  function applySegment(mode: typeof queueMode) {
    setQueueMode(mode);
    if (mode === 'all') {
      onFiltersChange({ ...filters, level: '', priority: '', overdueOnly: false, status: '' });
    } else if (mode === 'here') {
      const targetLevel =
        activeLevel === 'POLLING_STATION' ? 'CONSTITUENCY' : activeLevel;
      onFiltersChange({
        ...filters,
        level: targetLevel,
        priority: '',
        overdueOnly: false,
        status: '',
      });
    } else if (mode === 'urgent') {
      onFiltersChange({ ...filters, priority: 'Urgent', overdueOnly: false, status: '' });
    } else if (mode === 'overdue') {
      onFiltersChange({ ...filters, overdueOnly: true, priority: '', status: '' });
    } else if (mode === 'closed') {
      onFiltersChange({ ...filters, status: 'Resolved', overdueOnly: false, priority: '' });
    }
  }

  const priorityTextColor = (p: string) => {
    if (p === 'Urgent') return 'text-[#D41118] font-semibold';
    if (p === 'High') return 'text-[#B30E14] font-medium';
    if (p === 'Normal') return 'text-slate-700';
    return 'text-slate-500';
  };

  const statusTextColor = (s: string) => {
    if (s === 'Resolved') return 'text-emerald-700 font-medium';
    if (s === 'Escalated') return 'text-[#D41118] font-semibold';
    if (s === 'Closed with reason') return 'text-slate-500 font-medium';
    if (s === 'New') return 'text-[#0B2B7E] font-semibold';
    return 'text-slate-800 font-medium';
  };

  const filteredConstituencies = filters.regionId
    ? constituencies.filter((c) => c.regionId === filters.regionId)
    : constituencies;
  const filteredStations = filters.constituencyId
    ? pollingStations.filter((p) => p.constituencyId === filters.constituencyId)
    : pollingStations;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Issues Queue</h1>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            Showing {issues.length} report{issues.length === 1 ? '' : 's'} within {user.role === 'SUPER_ADMIN' ? 'selected portal view' : 'your approved jurisdiction'}
          </p>
        </div>

        {/* Segmented Queue Tabs (interactive button controls) */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto no-scrollbar ios-scroll">
          {[
            { id: 'all', label: 'All Scoped' },
            {
              id: 'here',
              label:
                activeLevel === 'POLLING_STATION'
                  ? 'At Constituency'
                  : `At ${ISSUE_LEVEL_LABELS[activeLevel] || 'My'} Level`,
            },
            { id: 'urgent', label: 'Urgent' },
            { id: 'overdue', label: 'Overdue' },
            { id: 'closed', label: 'Resolved' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => applySegment(tab.id as typeof queueMode)}
              className={`min-h-[40px] sm:min-h-[36px] px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                queueMode === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={filters.search}
              onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
              placeholder="Search by reference code, title, description, or station…"
              className="w-full min-h-[44px] pl-10 pr-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B2B7E]"
            />
          </div>
          <label className="min-h-[44px] px-3.5 rounded-lg border border-slate-300 flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap shrink-0">
            <input
              type="checkbox"
              checked={filters.essentialOnly}
              onChange={(e) => onFiltersChange({ ...filters, essentialOnly: e.target.checked })}
              className="w-4 h-4 accent-[#0B2B7E]"
            />
            <span>Essential Only</span>
          </label>
          <button
            type="button"
            onClick={() => {
              setQueueMode('all');
              onFiltersChange(EMPTY_FILTERS);
            }}
            className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Clear Filters
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {regions.length > 1 && (
            <select
              aria-label="Filter by region"
              value={filters.regionId}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  regionId: e.target.value,
                  constituencyId: '',
                  pollingStationId: '',
                })
              }
              className="min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
            >
              <option value="">All Regions</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          {filteredConstituencies.length > 1 && (
            <select
              aria-label="Filter by constituency"
              value={filters.constituencyId}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  constituencyId: e.target.value,
                  pollingStationId: '',
                })
              }
              className="min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
            >
              <option value="">All Constituencies</option>
              {filteredConstituencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {filteredStations.length > 1 && (
            <select
              aria-label="Filter by polling station"
              value={filters.pollingStationId}
              onChange={(e) => onFiltersChange({ ...filters, pollingStationId: e.target.value })}
              className="min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
            >
              <option value="">All Stations</option>
              {filteredStations.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Filter by category"
            value={filters.categoryId}
            onChange={(e) => onFiltersChange({ ...filters, categoryId: e.target.value })}
            className="min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by priority"
            value={filters.priority}
            onChange={(e) => onFiltersChange({ ...filters, priority: e.target.value })}
            className="min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
          >
            <option value="">All Priorities</option>
            {ISSUE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={filters.status}
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
            className="min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
          >
            <option value="">All Statuses</option>
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by assigned owner"
            value={filters.assignedToUserId}
            onChange={(e) => onFiltersChange({ ...filters, assignedToUserId: e.target.value })}
            className="min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
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
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-16 px-5 py-4 animate-pulse bg-slate-50/40" />
          ))}
        </div>
      )}

      {!loading && issues.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm font-medium text-slate-900">
            No issue reports match your current scope and filters
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Concerns submitted after party meetings will appear here with full history, priority tracking, and follow-up dates.
          </p>
          <button
            type="button"
            onClick={onNewIssue}
            className="min-h-[44px] px-5 rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C]"
          >
            Submit First Concern
          </button>
        </div>
      )}

      {/* Desktop Table + Mobile Tap List (Zero-pill clean inline metadata) */}
      {!loading && issues.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Reference & Concern</th>
                  <th className="py-3 px-4">Location & Level</th>
                  <th className="py-3 px-4">Priority / Tag</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Owner & Follow-Up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {issues.map((issue) => (
                  <tr
                    key={issue.id}
                    onClick={() => onSelectIssue(issue.id)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="py-3.5 px-4 max-w-md">
                      <p className="font-medium text-slate-900 line-clamp-1">
                        {issue.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        <span className="font-mono text-slate-700">{issue.referenceCode}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{issue.categoryName}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="tabular-nums">Meeting {issue.meetingDate}</span>
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700">
                      <p className="font-medium text-slate-800">{issue.pollingStationName}</p>
                      <p className="text-slate-500">
                        {issue.constituencyName}, {issue.regionName} ·{' '}
                        {ISSUE_LEVEL_LABELS[issue.currentLevel]}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                      <span className={priorityTextColor(issue.priority)}>{issue.priority}</span>
                      {issue.isEssential && (
                        <>
                          <span aria-hidden="true" className="text-slate-400"> · </span>
                          <span className="text-[#0B2B7E] font-semibold">Essential</span>
                        </>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                      <span className={statusTextColor(issue.status)}>{issue.status}</span>
                      {issue.isOverdue && (
                        <>
                          <span aria-hidden="true" className="text-slate-400"> · </span>
                          <span className="text-[#D41118] font-semibold">Overdue</span>
                        </>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600">
                      <p className="text-slate-800">{issue.assignedToName || 'Unassigned'}</p>
                      <p className="font-mono tabular-nums text-slate-500">
                        {issue.followUpDate ? `Due ${issue.followUpDate}` : 'No follow-up date'}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Touch Cards */}
          <div className="md:hidden divide-y divide-slate-200">
            {issues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => onSelectIssue(issue.id)}
                className="w-full text-left p-4 hover:bg-slate-50 active:bg-slate-100 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-slate-500">
                    <span className="font-mono text-slate-700">{issue.referenceCode}</span>
                    <span aria-hidden="true"> · </span>
                    <span className={priorityTextColor(issue.priority)}>{issue.priority}</span>
                    {issue.isEssential && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="text-[#0B2B7E] font-semibold">Essential</span>
                      </>
                    )}
                    {issue.isOverdue && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="text-[#D41118] font-semibold">Overdue</span>
                      </>
                    )}
                  </p>
                  <p className="text-sm font-semibold text-slate-900 line-clamp-2">
                    {issue.title}
                  </p>
                  <p className="text-xs text-slate-600 truncate">
                    <span className={statusTextColor(issue.status)}>{issue.status}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{issue.pollingStationName}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{ISSUE_LEVEL_LABELS[issue.currentLevel]}</span>
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
