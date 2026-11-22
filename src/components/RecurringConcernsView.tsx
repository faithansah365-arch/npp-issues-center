import { useEffect, useState } from 'react';
import { GitMerge } from 'lucide-react';
import type {
  IssueRecord,
  RecurringGroupRecord,
  RecurringSuggestion,
} from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

interface GroupWithIssues extends RecurringGroupRecord {
  issues: IssueRecord[];
}

interface SuggestionPair {
  primaryIssue: {
    id: string;
    referenceCode: string;
    title: string;
    categoryName: string;
    location: string;
    status: string;
    createdAt: string;
  };
  suggestion: RecurringSuggestion;
}

export function RecurringConcernsView({
  onSelectIssue,
  refreshKey,
}: {
  onSelectIssue: (id: string) => void;
  refreshKey: number;
}) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupWithIssues[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{
        groups: GroupWithIssues[];
        suggestions: SuggestionPair[];
      }>('/api/recurring');
      setGroups(data.groups);
      setSuggestions(data.suggestions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  async function confirmPair(pair: SuggestionPair) {
    const key = `${pair.primaryIssue.id}-${pair.suggestion.relatedIssueId}`;
    setSavingId(key);
    setError(null);
    try {
      await apiRequest('/api/recurring/confirm', {
        method: 'POST',
        body: {
          issueIds: [pair.primaryIssue.id, pair.suggestion.relatedIssueId],
          title:
            confirmTitle[key]?.trim() ||
            `Recurring: ${pair.primaryIssue.title.slice(0, 60)}`,
        },
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function dismissPair(pair: SuggestionPair) {
    try {
      await apiRequest('/api/recurring/dismiss', {
        method: 'POST',
        body: {
          issueIdA: pair.primaryIssue.id,
          issueIdB: pair.suggestion.relatedIssueId,
        },
      });
      setSuggestions((prev) =>
        prev.filter(
          (p) =>
            !(
              p.primaryIssue.id === pair.primaryIssue.id &&
              p.suggestion.relatedIssueId === pair.suggestion.relatedIssueId
            ),
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl font-semibold text-[#071A4D]">
          Recurring Concerns
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Group repeated issues reported across meetings while keeping every original report separate, intact, and accessible.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && <div className="h-32 bg-white border border-slate-200 rounded-xl animate-pulse" />}

      {!loading && (
        <>
          {/* Pending Suggestions */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Suggested Related Reports (Awaiting Executive Confirmation)
            </h2>
            {suggestions.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6 text-xs text-slate-500">
                No unreviewed recurring-concern suggestions in your approved scope.
              </div>
            ) : (
              <div className="space-y-3">
                {suggestions.map((pair) => {
                  const key = `${pair.primaryIssue.id}-${pair.suggestion.relatedIssueId}`;
                  return (
                    <div
                      key={key}
                      className="bg-white border border-[#0B2B7E]/30 rounded-xl p-4 sm:p-5 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#0B2B7E]">
                          System Suggestion · {Math.round(pair.suggestion.similarityScore * 100)}% overlap ({pair.suggestion.matchedTerms.join(', ')})
                        </span>
                        <span className="text-slate-500">Requires authorized confirmation</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => onSelectIssue(pair.primaryIssue.id)}
                          className="text-left p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-[#0B2B7E]"
                        >
                          <p className="font-mono text-slate-600">
                            {pair.primaryIssue.referenceCode} · {pair.primaryIssue.status}
                          </p>
                          <p className="font-semibold text-slate-900 mt-1">
                            {pair.primaryIssue.title}
                          </p>
                          <p className="text-slate-500 mt-1">{pair.primaryIssue.location}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectIssue(pair.suggestion.relatedIssueId)}
                          className="text-left p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-[#0B2B7E]"
                        >
                          <p className="font-mono text-slate-600">
                            {pair.suggestion.relatedReferenceCode} · {pair.suggestion.relatedStatus}
                          </p>
                          <p className="font-semibold text-slate-900 mt-1">
                            {pair.suggestion.relatedTitle}
                          </p>
                          <p className="text-slate-500 mt-1">{pair.suggestion.relatedLocation}</p>
                        </button>
                      </div>

                      {user.role !== 'POLLING_STATION' && (
                        <div className="flex flex-col sm:flex-row gap-2 pt-1">
                          <input
                            type="text"
                            value={confirmTitle[key] || ''}
                            onChange={(e) =>
                              setConfirmTitle((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            placeholder={`Recurring: ${pair.primaryIssue.title.slice(0, 50)}`}
                            className="flex-1 min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs"
                          />
                          <button
                            type="button"
                            disabled={savingId === key}
                            onClick={() => void confirmPair(pair)}
                            className="min-h-[40px] px-4 rounded-lg bg-[#0B2B7E] hover:bg-[#071E5C] text-white text-xs font-medium inline-flex items-center justify-center gap-1.5"
                          >
                            <GitMerge className="w-3.5 h-3.5" />
                            <span>Confirm & Group</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void dismissPair(pair)}
                            className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Confirmed Recurring Clusters */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Confirmed Recurring Concern Groups
            </h2>
            {groups.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6 text-xs text-slate-500">
                No recurring concern clusters have been confirmed yet.
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{g.title}</h3>
                        <p className="text-xs text-slate-500">
                          Confirmed by {g.confirmedByName} ·{' '}
                          <span className="tabular-nums">
                            {g.issues.length} separate reports linked
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                      {g.issues.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelectIssue(item.id)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                        >
                          <span className="font-medium text-slate-900">
                            <span className="font-mono text-slate-600">{item.referenceCode}</span> ·{' '}
                            {item.title}
                          </span>
                          <span className="text-slate-500 shrink-0">
                            {item.pollingStationName} · {item.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
