import React, { useEffect, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import {
  ISSUE_PRIORITIES,
  type CategoryRecord,
  type ConstituencyRecord,
  type IssueLevel,
  type IssuePriority,
  type IssueRecord,
  type PollingStationRecord,
  type PublicUser,
  type RegionRecord,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

export function IssueFormModal({
  open,
  onClose,
  onCreated,
  effectiveLevel,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (issue: IssueRecord) => void;
  effectiveLevel?: IssueLevel;
}) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [regions, setRegions] = useState<RegionRecord[]>([]);
  const [constituencies, setConstituencies] = useState<ConstituencyRecord[]>([]);
  const [stations, setStations] = useState<PollingStationRecord[]>([]);
  const [assignables, setAssignables] = useState<PublicUser[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [meetingDate, setMeetingDate] = useState(new Date().toISOString().slice(0, 10));
  const [requestedAction, setRequestedAction] = useState('');
  const [priority, setPriority] = useState<IssuePriority>('Normal');
  const [isEssential, setIsEssential] = useState(false);
  const [assignedToUserId, setAssignedToUserId] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [optionalFollowUpContact, setOptionalFollowUpContact] = useState('');
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [selectedConstituencyId, setSelectedConstituencyId] = useState('');
  const [selectedStationId, setSelectedStationId] = useState('');
  const [newStationName, setNewStationName] = useState('');
  const [newStationCode, setNewStationCode] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    Promise.all([
      apiRequest<{ categories: CategoryRecord[] }>('/api/meta/categories'),
      apiRequest<{
        regions: RegionRecord[];
        constituencies: ConstituencyRecord[];
        pollingStations: PollingStationRecord[];
      }>('/api/meta/geography'),
      apiRequest<{ users: PublicUser[] }>('/api/issues/assignable-users'),
    ])
      .then(([cats, geo, owners]) => {
        setCategories(cats.categories);
        if (cats.categories.length > 0 && !categoryId) {
          setCategoryId(cats.categories[0].id);
        }
        setRegions(geo.regions);
        setConstituencies(geo.constituencies);
        setStations(geo.pollingStations);

        const defaultRegion = user.regionId || geo.regions[0]?.id || '';
        setSelectedRegionId(defaultRegion);

        const regionCons = geo.constituencies.filter((c) => c.regionId === defaultRegion);
        const defaultCon = user.constituencyId || regionCons[0]?.id || '';
        setSelectedConstituencyId(defaultCon);

        const conStations = geo.pollingStations.filter((p) => p.constituencyId === defaultCon);
        if (user.pollingStationId) {
          setSelectedStationId(user.pollingStationId);
        } else if (conStations.length > 0) {
          setSelectedStationId(conStations[0].id);
        } else {
          setSelectedStationId('');
        }
        setAssignables(owners.users);
      })
      .catch((err) => setError((err as Error).message));
  }, [open, user]);

  if (!open || !user) return null;

  const filteredConstituencies = selectedRegionId
    ? constituencies.filter((c) => c.regionId === selectedRegionId)
    : constituencies;
  const filteredStations = selectedConstituencyId
    ? stations.filter((s) => s.constituencyId === selectedConstituencyId)
    : [];

  const showNewStationInputs =
    user.role !== 'POLLING_STATION' &&
    (filteredStations.length === 0 || selectedStationId === '__NEW__');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('categoryId', categoryId);
      formData.append('meetingDate', meetingDate);
      formData.append('requestedAction', requestedAction);
      formData.append('priority', priority);
      formData.append('isEssential', String(isEssential));
      if (assignedToUserId) formData.append('assignedToUserId', assignedToUserId);
      if (followUpDate) formData.append('followUpDate', followUpDate);
      if (optionalFollowUpContact.trim()) {
        formData.append('optionalFollowUpContact', optionalFollowUpContact.trim());
      }
      if (user!.role !== 'POLLING_STATION') {
        if (selectedStationId && selectedStationId !== '__NEW__') {
          formData.append('pollingStationId', selectedStationId);
        } else {
          formData.append('constituencyId', selectedConstituencyId);
          formData.append('newPollingStationName', newStationName.trim());
          if (newStationCode.trim()) {
            formData.append('newPollingStationCode', newStationCode.trim());
          }
        }
      }
      if (user!.role === 'SUPER_ADMIN' && effectiveLevel) {
        formData.append('originLevel', effectiveLevel);
      }
      if (attachmentFile) {
        formData.append('attachment', attachmentFile);
      }

      const res = await apiRequest<{ issue: IssueRecord }>('/api/issues', {
        method: 'POST',
        body: formData,
        isFormData: true,
      });

      setTitle('');
      setDescription('');
      setRequestedAction('');
      setPriority('Normal');
      setIsEssential(false);
      setAssignedToUserId('');
      setFollowUpDate('');
      setOptionalFollowUpContact('');
      setNewStationName('');
      setNewStationCode('');
      setAttachmentFile(null);
      onCreated(res.issue);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-form-title"
    >
      <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl border border-slate-200 max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="grid grid-cols-3 h-1 w-full shrink-0" aria-hidden="true">
          <div className="bg-[#D41118]" />
          <div className="bg-white border-b border-slate-200/70" />
          <div className="bg-[#0B2B7E]" />
        </div>
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 id="issue-form-title" className="font-display text-lg font-semibold text-[#071A4D]">
              Submit Party Meeting Concern
            </h2>
            <p className="text-xs text-slate-500">
              {user.role === 'POLLING_STATION'
                ? 'Reports route immediately to your Constituency executives.'
                : 'Location options are restricted to your approved executive scope.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
            aria-label="Close issue form"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto ios-scroll p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 space-y-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              {error}
            </div>
          )}

          {/* Inherited / Scoped Jurisdiction */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-3">
            <p className="text-xs font-medium text-slate-700">
              Jurisdiction (Verified from Approved Account)
            </p>
            {user.role === 'POLLING_STATION' ? (
              <p className="text-xs text-slate-800">
                <strong>{user.pollingStationName}</strong> · {user.constituencyName} · {user.regionName}
              </p>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <select
                    required
                    disabled={regions.length <= 1}
                    value={selectedRegionId}
                    onChange={(e) => {
                      const nextReg = e.target.value;
                      setSelectedRegionId(nextReg);
                      const firstCon = constituencies.find((c) => c.regionId === nextReg)?.id || '';
                      setSelectedConstituencyId(firstCon);
                      const firstPs = stations.find((s) => s.constituencyId === firstCon)?.id || '';
                      setSelectedStationId(firstPs);
                    }}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 disabled:bg-slate-100"
                  >
                    <option value="">Select Region</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <select
                    required
                    disabled={filteredConstituencies.length <= 1 && user.role === 'CONSTITUENCY'}
                    value={selectedConstituencyId}
                    onChange={(e) => {
                      const nextCon = e.target.value;
                      setSelectedConstituencyId(nextCon);
                      const firstPs = stations.find((s) => s.constituencyId === nextCon)?.id || '';
                      setSelectedStationId(firstPs);
                    }}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 disabled:bg-slate-100"
                  >
                    <option value="">Select Constituency</option>
                    {filteredConstituencies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {filteredStations.length > 0 && (
                  <select
                    required
                    value={selectedStationId}
                    onChange={(e) => setSelectedStationId(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                  >
                    {filteredStations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                    <option value="__NEW__">+ Register another polling station in this constituency</option>
                  </select>
                )}

                {showNewStationInputs && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      minLength={2}
                      value={newStationName}
                      onChange={(e) => setNewStationName(e.target.value)}
                      placeholder="Polling station name (e.g. Central Market Presby)"
                      className="sm:col-span-2 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                    />
                    <input
                      type="text"
                      value={newStationCode}
                      onChange={(e) => setNewStationCode(e.target.value)}
                      placeholder="EC Code (optional)"
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="issue-title" className="block text-xs font-medium text-slate-700">
              Issue Title
            </label>
            <input
              id="issue-title"
              type="text"
              required
              minLength={5}
              maxLength={180}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Concise summary of the concern raised"
              className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm text-slate-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="issue-category" className="block text-xs font-medium text-slate-700">
                Category
              </label>
              <select
                id="issue-category"
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 min-w-0">
              <label htmlFor="issue-meeting-date" className="block text-xs font-medium text-slate-700">
                Meeting Date
              </label>
              <input
                id="issue-meeting-date"
                type="date"
                required
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="w-full min-w-0 min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="issue-desc" className="block text-xs font-medium text-slate-700">
              Description of Concern
            </label>
            <textarea
              id="issue-desc"
              required
              minLength={15}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Record the operational details raised at the meeting. Do not include unnecessary personal member details."
              className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="issue-action" className="block text-xs font-medium text-slate-700">
              Requested Action
            </label>
            <textarea
              id="issue-action"
              required
              minLength={5}
              rows={2}
              value={requestedAction}
              onChange={(e) => setRequestedAction(e.target.value)}
              placeholder="What specific support, decision, or intervention is requested?"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div className="space-y-1.5">
              <label htmlFor="issue-priority" className="block text-xs font-medium text-slate-700">
                Priority Level
              </label>
              <select
                id="issue-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority)}
                className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                {ISSUE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <label className="min-h-[44px] px-3.5 rounded-lg border border-slate-300 flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={isEssential}
                onChange={(e) => setIsEssential(e.target.checked)}
                className="w-4 h-4 accent-[#0B2B7E]"
              />
              <span>Mark as Essential (separate tag)</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="issue-owner" className="block text-xs font-medium text-slate-700">
                Assign Owner (Optional — Scoped Executives)
              </label>
              <select
                id="issue-owner"
                value={assignedToUserId}
                onChange={(e) => setAssignedToUserId(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">Leave unassigned in queue</option>
                {assignables.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.titleOrOffice})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 min-w-0">
              <label htmlFor="issue-followup" className="block text-xs font-medium text-slate-700">
                Follow-Up Date (Optional)
              </label>
              <input
                id="issue-followup"
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full min-w-0 min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="issue-contact" className="block text-xs font-medium text-slate-700">
                Follow-Up Contact (Optional — member name NOT required)
              </label>
              <input
                id="issue-contact"
                type="text"
                maxLength={140}
                value={optionalFollowUpContact}
                onChange={(e) => setOptionalFollowUpContact(e.target.value)}
                placeholder="Optional phone or office desk"
                className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="issue-attachment" className="block text-xs font-medium text-slate-700">
                Optional Attachment (JPEG, PNG, WEBP, PDF · max 5 MB)
              </label>
              <label
                htmlFor="issue-attachment"
                className="min-h-[44px] px-3.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-xs text-slate-700 cursor-pointer truncate"
              >
                <Paperclip className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {attachmentFile ? attachmentFile.name : 'Choose private document or photo'}
                </span>
              </label>
              <input
                id="issue-attachment"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
                className="sr-only"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-6 rounded-lg bg-[#0B2B7E] text-white text-sm font-medium hover:bg-[#071E5C] disabled:opacity-60"
            >
              {submitting ? 'Submitting Report…' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
