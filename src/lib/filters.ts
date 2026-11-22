export interface IssueFilterState {
  regionId: string;
  constituencyId: string;
  pollingStationId: string;
  categoryId: string;
  priority: string;
  status: string;
  assignedToUserId: string;
  level: string;
  essentialOnly: boolean;
  overdueOnly: boolean;
  fromDate: string;
  toDate: string;
  search: string;
}

export const EMPTY_FILTERS: IssueFilterState = {
  regionId: '',
  constituencyId: '',
  pollingStationId: '',
  categoryId: '',
  priority: '',
  status: '',
  assignedToUserId: '',
  level: '',
  essentialOnly: false,
  overdueOnly: false,
  fromDate: '',
  toDate: '',
  search: '',
};

export function buildFilterQueryString(filters: IssueFilterState): string {
  const params = new URLSearchParams();
  if (filters.regionId) params.set('regionId', filters.regionId);
  if (filters.constituencyId) params.set('constituencyId', filters.constituencyId);
  if (filters.pollingStationId) params.set('pollingStationId', filters.pollingStationId);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.status) params.set('status', filters.status);
  if (filters.assignedToUserId) params.set('assignedToUserId', filters.assignedToUserId);
  if (filters.level) params.set('level', filters.level);
  if (filters.essentialOnly) params.set('essentialOnly', 'true');
  if (filters.overdueOnly) params.set('overdueOnly', 'true');
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  if (filters.search.trim()) params.set('search', filters.search.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
