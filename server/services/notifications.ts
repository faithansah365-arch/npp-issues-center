import crypto from 'node:crypto';
import type {
  IssueLevel,
  IssueRecord,
  NotificationRecord,
  UserRecord,
} from '../../shared/types.ts';
import { config } from '../config.ts';
import { store } from '../db/store.ts';
import { sendTransactionalEmail } from './email.ts';

function isUserActiveInScopeForLevel(
  user: UserRecord,
  level: IssueLevel,
  issue: IssueRecord,
): boolean {
  if (user.status !== 'ACTIVE') return false;
  if (user.role !== level) return false;
  if (level === 'POLLING_STATION') return user.pollingStationId === issue.pollingStationId;
  if (level === 'CONSTITUENCY') return user.constituencyId === issue.constituencyId;
  if (level === 'REGIONAL') return user.regionId === issue.regionId;
  if (level === 'NATIONAL') return true;
  return false;
}

export async function dispatchNotification(params: {
  recipient: UserRecord;
  issue: IssueRecord | null;
  eventType: NotificationRecord['eventType'];
  title: string;
  message: string;
  sendEmail?: boolean;
}): Promise<NotificationRecord> {
  let emailSent = false;
  let emailStatusNote: string | null = null;

  if (params.sendEmail !== false) {
    // Keep email payload free of sensitive body details — send reference code + secure portal link only.
    const refText = params.issue ? `Reference: ${params.issue.referenceCode}\n` : '';
    const emailRes = await sendTransactionalEmail({
      to: params.recipient.email,
      subject: `[NPP Portal] ${params.title}`,
      text: `${params.title}\n\n${refText}${params.message}\n\nSign in securely to review details: ${config.appUrl}`,
    });
    emailSent = emailRes.sent;
    emailStatusNote = emailRes.reason;
  }

  const record: NotificationRecord = {
    id: crypto.randomUUID(),
    recipientUserId: params.recipient.id,
    issueId: params.issue?.id || null,
    issueReferenceCode: params.issue?.referenceCode || null,
    eventType: params.eventType,
    title: params.title,
    message: params.message,
    readAt: null,
    emailSent,
    emailStatusNote,
    createdAt: new Date().toISOString(),
  };

  await store.saveNotification(record);
  return record;
}

export async function notifyLevelExecutives(
  issue: IssueRecord,
  level: IssueLevel,
  excludeUserId: string,
  eventType: NotificationRecord['eventType'],
  title: string,
  message: string,
): Promise<void> {
  const users = await store.listUsers();
  const recipients = users.filter(
    (u) => u.id !== excludeUserId && isUserActiveInScopeForLevel(u, level, issue),
  );
  await Promise.all(
    recipients.map((recipient) =>
      dispatchNotification({
        recipient,
        issue,
        eventType,
        title,
        message,
      }),
    ),
  );
}

export async function notifyOriginalSubmitterAndOwner(
  issue: IssueRecord,
  actorUserId: string,
  eventType: NotificationRecord['eventType'],
  title: string,
  message: string,
): Promise<void> {
  const userIds = new Set<string>();
  if (issue.submittedByUserId && issue.submittedByUserId !== actorUserId) {
    userIds.add(issue.submittedByUserId);
  }
  if (issue.assignedToUserId && issue.assignedToUserId !== actorUserId) {
    userIds.add(issue.assignedToUserId);
  }

  const users = await Promise.all([...userIds].map((id) => store.getUserById(id)));
  await Promise.all(
    users
      .filter((u): u is UserRecord => Boolean(u && u.status === 'ACTIVE'))
      .map((recipient) =>
        dispatchNotification({
          recipient,
          issue,
          eventType,
          title,
          message,
        }),
      ),
  );
}

let lastOverdueScanMs = 0;

export async function scanOverdueFollowUps(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastOverdueScanMs < 60_000) return;
  lastOverdueScanMs = nowMs;

  const todayIso = new Date().toISOString().slice(0, 10);
  const issues = await store.listIssues();

  for (const issue of issues) {
    if (issue.status === 'Resolved' || issue.status === 'Closed with reason') continue;
    if (!issue.followUpDate || issue.followUpDate >= todayIso) continue;
    if (issue.followUpOverdueNotifiedAt && issue.followUpOverdueNotifiedAt.slice(0, 10) === todayIso) {
      continue;
    }

    const recipients: UserRecord[] = [];
    if (issue.assignedToUserId) {
      const owner = await store.getUserById(issue.assignedToUserId);
      if (owner && owner.status === 'ACTIVE') recipients.push(owner);
    }

    if (recipients.length === 0) {
      await notifyLevelExecutives(
        issue,
        issue.currentLevel,
        '',
        'OVERDUE',
        `Overdue follow-up: ${issue.referenceCode}`,
        `Follow-up date (${issue.followUpDate}) has passed for issue "${issue.title}".`,
      );
    } else {
      for (const recipient of recipients) {
        await dispatchNotification({
          recipient,
          issue,
          eventType: 'OVERDUE',
          title: `Overdue follow-up: ${issue.referenceCode}`,
          message: `Follow-up date (${issue.followUpDate}) has passed for issue "${issue.title}".`,
        });
      }
    }

    issue.followUpOverdueNotifiedAt = new Date().toISOString();
    await store.saveIssue(issue);
  }
}
