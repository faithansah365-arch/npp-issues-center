import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Download,
  GitMerge,
  X,
  XCircle,
} from 'lucide-react';
import {
  ISSUE_LEVEL_LABELS,
  ISSUE_PRIORITIES,
  type IssueLevel,
  type IssuePriority,
  type IssueRecord,
  type IssueStatus,
  type PublicUser,
  type RecurringGroupRecord,
  type RecurringSuggestion,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

const ESCALATION_PATH_ORDER: IssueLevel[] = [
  'POLLING_STATION',
  'CONSTITUENCY',
  'REGIONAL',
  'NATIONAL',
];

export function IssueDetailDrawer({
  issueId,
  onClose,
  onMutated,
  onOpenIssue,
}: {
  issueId: string | null;
  onClose: () => void;
  onMutated: () => void;
  onOpenIssue: (id: string) => void;
}) {
  const { user } = useAuth();
  const [issue, setIssue] = useState<IssueRecord | null>(null);
  const [suggestions, setSuggestions] = useState<RecurringSuggestion[]>([]);
  const [recurringGroup, setRecurringGroup] = useState<RecurringGroupRecord | null>(null);
  const [assignables, setAssignables] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Action states
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<'NOTE' | 'ACTION_TAKEN'>('ACTION_TAKEN');
  const [editStatus, setEditStatus] = useState<IssueStatus>('New');
  const [editPriority, setEditPriority] = useState<IssuePriority>('Normal');
  const [editEssential, setEditEssential] = useState(false);
  const [editOwner, setEditOwner] = useState('');
  const [editFollowUp, setEditFollowUp] = useState('');

  // Modal sub-panels for Escalate / Resolve / Close
  const [workflowAction, setWorkflowAction] = useState<'escalate' | 'resolve' | 'close' | null>(null);
  const [actionText, setActionText] = useState('');
  const [escalateAssignee, setEscalateAssignee] = useState('');
  const [saving, setSaving] = useState(false);

  // Confirm recurring suggestion inline
  const [confirmingSuggestion, setConfirmingSuggestion] = useState<RecurringSuggestion | null>(null);
  const [groupTitle, setGroupTitle] = useState('');

  async function loadIssue(id: string) {
    setLoading(true);
    setError(null);
    try {
      const [detail, owners] = await Promise.all([
        apiRequest<{
          issue: IssueRecord;
          suggestions: RecurringSuggestion[];
          recurringGroup: RecurringGroupRecord | null;
        }>(`/api/issues/${id}`),
        apiRequest<{ users: PublicUser[] }>('/api/issues/assignable-users'),
      ]);
      setIssue(detail.issue);
      setSuggestions(detail.suggestions);
      setRecurringGroup(detail.recurringGroup);
      setAssignables(owners.users);
      setEditStatus(detail.issue.status);
      setEditPriority(detail.issue.priority);
      setEditEssential(detail.issue.isEssential);
      setEditOwner(detail.issue.assignedToUserId || '');
      setEditFollowUp(detail.issue.followUpDate || '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!issueId) {
      setIssue(null);
      return;
    }
    setFeedback(null);
    setWorkflowAction(null);
    setActionText('');
    void loadIssue(issueId);
  }, [issueId]);

  if (!issueId || !user) return null;

  const isClosedOrResolved =
    issue?.status === 'Resolved' || issue?.status === 'Closed with reason';
  const canManage = user.role !== 'POLLING_STATION' && !isClosedOrResolved;

  const canEscalate =
    Boolean(issue) &&
    canManage &&
    issue!.currentLevel !== 'NATIONAL' &&
    (user.role === 'SUPER_ADMIN' ||
      ESCALATION_PATH_ORDER.indexOf(user.role as IssueLevel) >=
        ESCALATION_PATH_ORDER.indexOf(issue!.currentLevel));

  const nextLevel =
    issue && issue.currentLevel === 'CONSTITUENCY'
      ? 'REGIONAL'
      : issue && issue.currentLevel === 'REGIONAL'
        ? 'NATIONAL'
        : issue && issue.currentLevel === 'POLLING_STATION'
          ? 'CONSTITUENCY'
          : null;

  const nextLevelOwners = nextLevel
    ? assignables.filter((u) => u.role === nextLevel)
    : [];

  async function handleSaveUpdates(e: React.FormEvent) {
    e.preventDefault();
    if (!issue) return;
    setError(null);
    setFeedback(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (canManage) {
        if (editStatus !== issue.status && !['Escalated', 'Resolved', 'Closed with reason'].includes(editStatus)) {
          payload.status = editStatus;
        }
        if (editPriority !== issue.priority) payload.priority = editPriority;
        if (editEssential !== issue.isEssential) payload.isEssential = editEssential;
        if ((editOwner || null) !== issue.assignedToUserId) {
          payload.assignedToUserId = editOwner || null;
        }
        if ((editFollowUp || null) !== issue.followUpDate) {
          payload.followUpDate = editFollowUp || null;
        }
      }
      if (noteText.trim()) {
        payload.note = noteText.trim();
        payload.noteType = noteType;
      }

      await apiRequest(`/api/issues/${issue.id}`, {
        method: 'PATCH',
        body: payload,
      });
      setNoteText('');
      setFeedback('Issue record updated and audit history logged.');
      await loadIssue(issue.id);
      onMutated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleWorkflowSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!issue || !workflowAction) return;
    setError(null);
    setFeedback(null);
    setSaving(true);
    try {
      if (workflowAction === 'escalate') {
        await apiRequest(`/api/issues/${issue.id}/escalate`, {
          method: 'POST',
          body: {
            reason: actionText,
            assignedToUserId: escalateAssignee || undefined,
          },
        });
        setFeedback(`Escalated to ${nextLevel} level. Original report and history preserved.`);
      } else if (workflowAction === 'resolve') {
        await apiRequest(`/api/issues/${issue.id}/resolve`, {
          method: 'POST',
          body: { resolutionSummary: actionText },
        });
        setFeedback('Issue marked Resolved and outcome sent to original polling-station submitter.');
      } else if (workflowAction === 'close') {
        await apiRequest(`/api/issues/${issue.id}/close`, {
          method: 'POST',
          body: { closureReason: actionText },
        });
        setFeedback('Issue closed with recorded reason and submitter notified.');
      }
      setWorkflowAction(null);
      setActionText('');
      await loadIssue(issue.id);
      onMutated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmSuggestion(s: RecurringSuggestion) {
    if (!issue) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/api/recurring/confirm', {
        method: 'POST',
        body: {
          issueIds: [issue.id, s.relatedIssueId],
          title: groupTitle.trim() || `${issue.categoryName}: ${issue.title.slice(0, 60)}`,
        },
      });
      setConfirmingSuggestion(null);
      setGroupTitle('');
      setFeedback('Confirmed recurring concern grouping. Both original reports remain separate.');
      await loadIssue(issue.id);
      onMutated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDismissSuggestion(s: RecurringSuggestion) {
    if (!issue) return;
    try {
      await apiRequest('/api/recurring/dismiss', {
        method: 'POST',
        body: { issueIdA: issue.id, issueIdB: s.relatedIssueId },
      });
      setSuggestions((prev) => prev.filter((item) => item.relatedIssueId !== s.relatedIssueId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Issue Detail Dossier"
    >
      <div className="bg-white w-full max-w-3xl h-full flex flex-col border-l border-slate-200 overflow-hidden">
        <div className="grid grid-cols-3 h-1 w-full shrink-0" aria-hidden="true">
          <div className="bg-[#D41118]" />
          <div className="bg-white border-b border-slate-200/70" />
          <div className="bg-[#0B2B7E]" />
        </div>
        {/* Sticky Drawer Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-white">
          <div className="min-w-0">
            <p className="text-xs font-mono text-slate-600 truncate">
              {issue?.referenceCode || 'Loading…'}
            </p>
            <h2 className="font-display text-base sm:text-lg font-semibold text-[#071A4D] truncate">
              {issue?.title || 'Issue Report'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
            aria-label="Close issue details"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              {error}
            </div>
          )}
          {feedback && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
              {feedback}
            </div>
          )}

          {loading && !issue && (
            <div className="space-y-4">
              <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
              <div className="h-40 bg-slate-100 rounded-xl animate-pulse" />
            </div>
          )}

          {issue && (
            <>
              {/* Unboxed Metadata Summary */}
              <div className="border-b border-slate-200 pb-4 space-y-2">
                <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-slate-900">{issue.status}</span>
                  <span aria-hidden="true">·</span>
                  <span className={issue.priority === 'Urgent' ? 'text-[#D41118] font-semibold' : 'font-medium text-slate-800'}>
                    Priority: {issue.priority}
                  </span>
                  {issue.isEssential && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#0B2B7E] font-semibold">Essential</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>Current Level: {ISSUE_LEVEL_LABELS[issue.currentLevel]}</span>
                  <span aria-hidden="true">·</span>
                  <span>Category: {issue.categoryName}</span>
                </p>
                <p className="text-xs text-slate-600">
                  Origin: <strong className="text-slate-900">{issue.pollingStationName}</strong> ({issue.constituencyName}, {issue.regionName}) · Meeting Date:{' '}
                  <span className="font-mono tabular-nums">{issue.meetingDate}</span> · Submitted by {issue.submittedByName}
                </p>
                {recurringGroup && (
                  <p className="text-xs text-[#071A4D] bg-[#EEF3FC] border border-[#C7D4F2] rounded-lg px-3 py-2">
                    Confirmed Recurring Concern: <strong>{recurringGroup.title}</strong> ({recurringGroup.issueIds.length} linked reports — original report preserved)
                  </p>
                )}
              </div>

              {/* Preserved Original Report */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Original Meeting Report
                </h3>
                <div className="space-y-3 text-sm text-slate-800 leading-relaxed">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Description of Concern</p>
                    <p className="mt-1 whitespace-pre-line">{issue.description}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Requested Action</p>
                    <p className="mt-1 whitespace-pre-line">{issue.requestedAction}</p>
                  </div>
                  {issue.optionalFollowUpContact && (
                    <div>
                      <p className="text-xs font-medium text-slate-500">Follow-Up Contact</p>
                      <p className="mt-0.5 text-xs text-slate-700">{issue.optionalFollowUpContact}</p>
                    </div>
                  )}
                </div>

                {issue.attachments.length > 0 && (
                  <div className="pt-2 space-y-2">
                    <p className="text-xs font-medium text-slate-500">Private Attachments</p>
                    <div className="flex flex-wrap gap-2">
                      {issue.attachments.map((att) => (
                        <a
                          key={att.id}
                          href={`/api/issues/${issue.id}/attachments/${att.id}`}
                          className="min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-800 inline-flex items-center gap-2"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{att.originalName}</span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            ({Math.round(att.sizeBytes / 1024)} KB)
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Outcome if Resolved or Closed */}
              {(issue.resolutionSummary || issue.closureReason) && (
                <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-1.5">
                  <p className="text-xs font-semibold text-emerald-900">
                    {issue.resolutionSummary ? 'Recorded Resolution Outcome' : 'Recorded Closure Reason'}
                  </p>
                  <p className="text-sm text-slate-900">
                    {issue.resolutionSummary || issue.closureReason}
                  </p>
                </section>
              )}

              {/* Escalation / Resolution / Closure Controls */}
              {canManage && (
                <section className="border-t border-slate-200 pt-5 space-y-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {canEscalate && (
                      <button
                        type="button"
                        onClick={() => {
                          setWorkflowAction(workflowAction === 'escalate' ? null : 'escalate');
                          setActionText('');
                        }}
                        className="min-h-[42px] px-4 rounded-lg border border-[#F5C6C8] bg-[#FDF2F2] text-[#A60D13] text-xs font-semibold hover:bg-[#FCE5E6] inline-flex items-center gap-1.5"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                        <span>
                          Escalate to{' '}
                          {nextLevel === 'CONSTITUENCY'
                            ? 'Constituency'
                            : nextLevel === 'REGIONAL'
                              ? 'Region'
                              : 'National'}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setWorkflowAction(workflowAction === 'resolve' ? null : 'resolve');
                        setActionText('');
                      }}
                      className="min-h-[42px] px-4 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Resolve Issue</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWorkflowAction(workflowAction === 'close' ? null : 'close');
                        setActionText('');
                      }}
                      className="min-h-[42px] px-4 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Close with Reason</span>
                    </button>
                  </div>

                  {workflowAction && (
                    <form
                      onSubmit={handleWorkflowSubmit}
                      className="rounded-xl border border-slate-300 bg-slate-50 p-4 space-y-3"
                    >
                      <p className="text-xs font-semibold text-slate-900">
                        {workflowAction === 'escalate'
                          ? `Escalate to ${nextLevel} Executive Level`
                          : workflowAction === 'resolve'
                            ? 'Resolve Issue & Notify Originating Station'
                            : 'Close Issue with Recorded Reason'}
                      </p>
                      <textarea
                        required
                        minLength={10}
                        rows={3}
                        value={actionText}
                        onChange={(e) => setActionText(e.target.value)}
                        placeholder={
                          workflowAction === 'escalate'
                            ? 'Explain why this level cannot resolve the issue and what intervention is needed…'
                            : workflowAction === 'resolve'
                              ? 'Describe the action taken and final resolution sent back to the polling station…'
                              : 'State the reason for closing this issue without further action…'
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm"
                      />
                      {workflowAction === 'escalate' && nextLevelOwners.length > 0 && (
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Optional Handoff Owner at {nextLevel} Level
                          </label>
                          <select
                            value={escalateAssignee}
                            onChange={(e) => setEscalateAssignee(e.target.value)}
                            className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
                          >
                            <option value="">Leave in {nextLevel} queue</option>
                            {nextLevelOwners.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.fullName} ({u.titleOrOffice})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setWorkflowAction(null)}
                          className="min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={saving}
                          className="min-h-[40px] px-4 rounded-lg bg-[#0B2B7E] text-white text-xs font-medium hover:bg-[#071E5C] disabled:opacity-60"
                        >
                          {saving ? 'Processing…' : 'Confirm Action'}
                        </button>
                      </div>
                    </form>
                  )}
                </section>
              )}

              {/* Assignment, Priority, Follow-Up & Notes Form */}
              <form
                onSubmit={handleSaveUpdates}
                className="border-t border-slate-200 pt-5 space-y-4"
              >
                <h3 className="text-sm font-semibold text-slate-900">
                  {canManage ? 'Assignment, Priority & Follow-Up Controls' : 'Add Station Follow-Up Note'}
                </h3>

                {canManage && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as IssueStatus)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
                      >
                        {['New', 'Under review', 'Assigned', 'Awaiting update'].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        {editStatus === 'Escalated' && <option value="Escalated">Escalated</option>}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Assigned Owner
                      </label>
                      <select
                        value={editOwner}
                        onChange={(e) => setEditOwner(e.target.value)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
                      >
                        <option value="">Unassigned</option>
                        {assignables.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.fullName} ({u.role})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value as IssuePriority)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
                      >
                        {ISSUE_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Follow-Up Date
                      </label>
                      <input
                        type="date"
                        value={editFollowUp}
                        onChange={(e) => setEditFollowUp(e.target.value)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 text-xs"
                      />
                    </div>
                    <label className="sm:col-span-2 min-h-[42px] px-3 rounded-lg border border-slate-300 flex items-center gap-2.5 text-xs font-medium text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editEssential}
                        onChange={(e) => setEditEssential(e.target.checked)}
                        className="w-4 h-4 accent-[#0B2B7E]"
                      />
                      <span>Essential Issue Tag (tracked separately from priority)</span>
                    </label>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-600">
                      Record Note or Action Taken
                    </label>
                    <select
                      value={noteType}
                      onChange={(e) => setNoteType(e.target.value as 'NOTE' | 'ACTION_TAKEN')}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="ACTION_TAKEN">Action Taken</option>
                      <option value="NOTE">Internal Note</option>
                    </select>
                  </div>
                  <textarea
                    rows={2}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Document progress, calls, or meeting follow-up…"
                    className="w-full rounded-lg border border-slate-300 p-3 text-sm"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="min-h-[44px] px-5 rounded-lg bg-[#0B2B7E] text-white text-xs sm:text-sm font-medium hover:bg-[#071E5C] disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save Updates & Notes'}
                  </button>
                </div>
              </form>

              {/* Suggested Recurring Concerns (Human confirmation required) */}
              {suggestions.length > 0 && (
                <section className="border-t border-slate-200 pt-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Suggested Related Reports (Requires Executive Confirmation)
                    </h3>
                  </div>
                  <p className="text-xs text-slate-600">
                    System suggestions are based on shared issue terms and category. Confirming links reports under a recurring concern while keeping all original reports separate.
                  </p>
                  <div className="space-y-2.5">
                    {suggestions.map((s) => (
                      <div
                        key={s.relatedIssueId}
                        className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-2"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenIssue(s.relatedIssueId)}
                              className="text-xs font-semibold text-[#0B2B7E] hover:underline text-left"
                            >
                              {s.relatedReferenceCode} · {s.relatedTitle}
                            </button>
                            <p className="text-xs text-slate-600">
                              {s.relatedLocation} · {s.relatedStatus} · Suggested match ({Math.round(s.similarityScore * 100)}% overlap: {s.matchedTerms.join(', ')})
                            </p>
                          </div>
                          {user.role !== 'POLLING_STATION' && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmingSuggestion(s);
                                  setGroupTitle(`Recurring: ${issue.title.slice(0, 60)}`);
                                }}
                                className="min-h-[36px] px-3 rounded-lg bg-[#071A4D] hover:bg-[#0B2B7E] text-white text-xs font-medium inline-flex items-center gap-1"
                              >
                                <GitMerge className="w-3.5 h-3.5" />
                                <span>Confirm Match</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDismissSuggestion(s)}
                                className="min-h-[36px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-700"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                        </div>
                        {confirmingSuggestion?.relatedIssueId === s.relatedIssueId && (
                          <div className="pt-2 border-t border-amber-200 flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={groupTitle}
                              onChange={(e) => setGroupTitle(e.target.value)}
                              placeholder="Shared recurring concern title"
                              className="flex-1 min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs"
                            />
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void handleConfirmSuggestion(s)}
                              className="min-h-[38px] px-4 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs font-medium"
                            >
                              Save Confirmed Group
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Notes & Actions Log */}
              {issue.notes.length > 0 && (
                <section className="border-t border-slate-200 pt-5 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">Notes & Actions Recorded</h3>
                  <div className="space-y-3">
                    {issue.notes.map((n) => (
                      <div key={n.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1">
                        <p className="text-slate-600">
                          <strong className="text-slate-900">{n.authorName}</strong> · {n.noteType.replace('_', ' ')} ·{' '}
                          <span className="font-mono tabular-nums">
                            {new Date(n.createdAt).toLocaleString()}
                          </span>
                        </p>
                        <p className="text-sm text-slate-800 whitespace-pre-line">{n.content}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Full Immutable History Timeline */}
              <section className="border-t border-slate-200 pt-5 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Complete Audit History</h3>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {[...issue.history].reverse().map((h) => (
                    <div key={h.id} className="px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div>
                        <span className="font-medium text-slate-900">{h.actorName}</span>
                        <span className="text-slate-500"> · {h.summary}</span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-500 shrink-0">
                        {new Date(h.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
