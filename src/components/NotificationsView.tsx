import { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationRecord } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';

export function NotificationsView({
  onSelectIssue,
  refreshKey,
}: {
  onSelectIssue: (id: string) => void;
  refreshKey: number;
}) {
  const { setUnreadNotifications } = useAuth();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        notifications: NotificationRecord[];
        unreadCount: number;
      }>('/api/notifications');
      setItems(res.notifications);
      setUnreadNotifications(res.unreadCount);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  async function markRead(n: NotificationRecord) {
    if (!n.readAt) {
      await apiRequest(`/api/notifications/${n.id}/read`, { method: 'POST' });
      setItems((prev) =>
        prev.map((item) =>
          item.id === n.id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
      setUnreadNotifications((c) => Math.max(0, c - 1));
    }
    if (n.issueId) {
      onSelectIssue(n.issueId);
    }
  }

  async function markAllRead() {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    setItems((prev) =>
      prev.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })),
    );
    setUnreadNotifications(0);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Notifications</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time in-app alerts for assignments, updates, escalations, overdue follow-ups, resolutions, and closures.
          </p>
        </div>
        {items.some((i) => !i.readAt) && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="min-h-[42px] px-4 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"
          >
            <CheckCheck className="w-4 h-4" />
            <span>Mark All Read</span>
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && <div className="h-32 bg-white border border-slate-200 rounded-xl animate-pulse" />}

      {!loading && items.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <Bell className="w-6 h-6 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-900">No notifications yet</p>
          <p className="text-xs text-slate-500">
            Alerts appear here when reports are submitted, assigned, escalated, overdue, resolved, or closed.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => void markRead(n)}
              className={`w-full text-left p-4 sm:p-5 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                n.readAt ? 'bg-white' : 'bg-blue-50/40'
              }`}
            >
              <div className="space-y-1 min-w-0">
                <p className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-900">{n.eventType}</span>
                  {!n.readAt && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-blue-800 font-semibold">Unread</span>
                    </>
                  )}
                  {n.issueReferenceCode && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono text-slate-700">{n.issueReferenceCode}</span>
                    </>
                  )}
                </p>
                <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                <p className="text-xs text-slate-600">{n.message}</p>
                {n.emailStatusNote && (
                  <p className="text-[11px] text-slate-500">
                    Email status: {n.emailSent ? 'Delivered via SMTP' : n.emailStatusNote}
                  </p>
                )}
              </div>
              <span className="font-mono tabular-nums text-xs text-slate-500 shrink-0">
                {new Date(n.createdAt).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
