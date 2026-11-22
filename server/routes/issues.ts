import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type AttachmentMeta,
  type DashboardAnalytics,
  type IssueLevel,
  type IssuePriority,
  type IssueRecord,
  type IssueStatus,
  type UserRecord,
} from '../../shared/types.ts';
import { config } from '../config.ts';
import { store } from '../db/store.ts';
import {
  canAccessIssue,
  canManageIssueAtLevel,
  getNextEscalationLevel,
  isAssignableTarget,
  requireAuth,
  requireRole,
  toPublicUser,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { logAuditEvent } from '../security/audit.ts';
import {
  notifyLevelExecutives,
  notifyOriginalSubmitterAndOwner,
  scanOverdueFollowUps,
} from '../services/notifications.ts';
import { findRecurringSuggestions } from '../services/similarity.ts';

export const issuesRouter = express.Router();

issuesRouter.use(requireAuth);
issuesRouter.use(
  requireRole('POLLING_STATION', 'CONSTITUENCY', 'REGIONAL', 'NATIONAL', 'SUPER_ADMIN'),
);

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024, // final limit checked against system settings below
    files: 1,
  },
});

function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  return false;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'attachment';
}

function isOverdue(issue: IssueRecord, todayIso: string): boolean {
  if (issue.status === 'Resolved' || issue.status === 'Closed with reason') return false;
  return Boolean(issue.followUpDate && issue.followUpDate < todayIso);
}

function filterScopedIssues(
  allIssues: IssueRecord[],
  user: UserRecord,
  query: Record<string, unknown>,
): IssueRecord[] {
  const todayIso = new Date().toISOString().slice(0, 10);

  // Enforce strict server-side geographic scope BEFORE user filters
  let scoped = allIssues.filter((issue) => canAccessIssue(user, issue));

  const regionId = typeof query.regionId === 'string' ? query.regionId : '';
  const constituencyId = typeof query.constituencyId === 'string' ? query.constituencyId : '';
  const pollingStationId = typeof query.pollingStationId === 'string' ? query.pollingStationId : '';
  const categoryId = typeof query.categoryId === 'string' ? query.categoryId : '';
  const priority = typeof query.priority === 'string' ? query.priority : '';
  const status = typeof query.status === 'string' ? query.status : '';
  const assignedToUserId = typeof query.assignedToUserId === 'string' ? query.assignedToUserId : '';
  const level = typeof query.level === 'string' ? query.level : '';
  const essentialOnly = query.essentialOnly === 'true';
  const overdueOnly = query.overdueOnly === 'true';
  const fromDate = typeof query.fromDate === 'string' ? query.fromDate : '';
  const toDate = typeof query.toDate === 'string' ? query.toDate : '';
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';

  if (regionId) scoped = scoped.filter((i) => i.regionId === regionId);
  if (constituencyId) scoped = scoped.filter((i) => i.constituencyId === constituencyId);
  if (pollingStationId) scoped = scoped.filter((i) => i.pollingStationId === pollingStationId);
  if (categoryId) scoped = scoped.filter((i) => i.categoryId === categoryId);
  if (priority) scoped = scoped.filter((i) => i.priority === priority);
  if (status) scoped = scoped.filter((i) => i.status === status);
  if (assignedToUserId) {
    if (assignedToUserId === 'UNASSIGNED') scoped = scoped.filter((i) => !i.assignedToUserId);
    else scoped = scoped.filter((i) => i.assignedToUserId === assignedToUserId);
  }
  if (level) scoped = scoped.filter((i) => i.currentLevel === level);
  if (essentialOnly) scoped = scoped.filter((i) => i.isEssential);
  if (overdueOnly) scoped = scoped.filter((i) => isOverdue(i, todayIso));
  if (fromDate) scoped = scoped.filter((i) => i.createdAt.slice(0, 10) >= fromDate);
  if (toDate) scoped = scoped.filter((i) => i.createdAt.slice(0, 10) <= toDate);
  if (search) {
    scoped = scoped.filter(
      (i) =>
        i.title.toLowerCase().includes(search) ||
        i.description.toLowerCase().includes(search) ||
        i.referenceCode.toLowerCase().includes(search) ||
        i.pollingStationName.toLowerCase().includes(search) ||
        i.constituencyName.toLowerCase().includes(search),
    );
  }

  return scoped;
}

function buildBreakdown(items: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

issuesRouter.get('/', async (req: AuthenticatedRequest, res) => {
  await scanOverdueFollowUps();
  const user = req.authUser!;
  const allIssues = await store.listIssues();
  const filtered = filterScopedIssues(allIssues, user, req.query as Record<string, unknown>);
  const todayIso = new Date().toISOString().slice(0, 10);

  res.json({
    issues: filtered.map((issue) => ({
      ...issue,
      isOverdue: isOverdue(issue, todayIso),
    })),
    total: filtered.length,
  });
});

issuesRouter.get('/analytics', async (req: AuthenticatedRequest, res) => {
  await scanOverdueFollowUps();
  const user = req.authUser!;
  const [allIssues, groups] = await Promise.all([
    store.listIssues(),
    store.listRecurringGroups(),
  ]);

  const scoped = filterScopedIssues(allIssues, user, req.query as Record<string, unknown>);
  const todayIso = new Date().toISOString().slice(0, 10);

  const openIssuesList = scoped.filter(
    (i) => i.status !== 'Resolved' && i.status !== 'Closed with reason',
  );
  const resolvedCount = scoped.filter((i) => i.status === 'Resolved').length;
  const closedCount = scoped.filter((i) => i.status === 'Closed with reason').length;
  const escalatedCount = scoped.filter(
    (i) => i.escalationCount > 0 || i.status === 'Escalated',
  ).length;

  const responseHours: number[] = [];
  for (const issue of scoped) {
    if (issue.firstResponseAt) {
      const diffMs = Date.parse(issue.firstResponseAt) - Date.parse(issue.createdAt);
      if (diffMs >= 0) responseHours.push(diffMs / (1000 * 60 * 60));
    }
  }
  const avgFirstResponseHours =
    responseHours.length > 0
      ? Math.round((responseHours.reduce((a, b) => a + b, 0) / responseHours.length) * 10) / 10
      : null;

  const scopedIssueIdSet = new Set(scoped.map((i) => i.id));
  const recurringClustersCount = groups.filter((g) =>
    g.issueIds.some((id) => scopedIssueIdSet.has(id)),
  ).length;

  const locationLabels = scoped.map((i) => {
    if (typeof req.query.constituencyId === 'string' && req.query.constituencyId) {
      return i.pollingStationName;
    }
    if (
      (typeof req.query.regionId === 'string' && req.query.regionId) ||
      user.role === 'REGIONAL'
    ) {
      return i.constituencyName;
    }
    if (user.role === 'NATIONAL' || user.role === 'SUPER_ADMIN') {
      return i.regionName;
    }
    return i.pollingStationName;
  });

  const recentActivity = scoped
    .flatMap((issue) =>
      issue.history
        .filter((h) => h.action !== 'VIEWED')
        .map((h) => ({
          issueId: issue.id,
          referenceCode: issue.referenceCode,
          title: issue.title,
          actorName: h.actorName,
          action: h.action,
          summary: h.summary,
          createdAt: h.createdAt,
        })),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  const analytics: DashboardAnalytics = {
    totalInScope: scoped.length,
    openIssues: openIssuesList.length,
    urgentIssues: openIssuesList.filter((i) => i.priority === 'Urgent').length,
    essentialIssues: openIssuesList.filter((i) => i.isEssential).length,
    overdueFollowUps: openIssuesList.filter((i) => isOverdue(i, todayIso)).length,
    escalatedIssues: escalatedCount,
    resolvedIssues: resolvedCount,
    closedIssues: closedCount,
    avgFirstResponseHours,
    escalationRatePercent:
      scoped.length > 0 ? Math.round((escalatedCount / scoped.length) * 100) : 0,
    resolutionRatePercent:
      scoped.length > 0 ? Math.round(((resolvedCount + closedCount) / scoped.length) * 100) : 0,
    recurringClustersCount,
    byStatus: buildBreakdown(scoped.map((i) => i.status)),
    byCategory: buildBreakdown(scoped.map((i) => i.categoryName)),
    byOwner: buildBreakdown(scoped.map((i) => i.assignedToName || 'Unassigned')),
    byLocation: buildBreakdown(locationLabels),
    recentActivity,
  };

  res.json(analytics);
});

issuesRouter.get('/assignable-users', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const [users, regions, constituencies, pollingStations] = await Promise.all([
    store.listUsers(),
    store.listRegions(),
    store.listConstituencies(),
    store.listPollingStations(),
  ]);

  const geo = {
    regions: new Map(regions.map((r) => [r.id, r])),
    constituencies: new Map(constituencies.map((c) => [c.id, c])),
    pollingStations: new Map(pollingStations.map((p) => [p.id, p])),
  };

  const regionIdQuery = typeof req.query.regionId === 'string' ? req.query.regionId : actor.regionId;
  const constituencyIdQuery =
    typeof req.query.constituencyId === 'string' ? req.query.constituencyId : actor.constituencyId;

  const eligible = users.filter((candidate) => {
    if (candidate.status !== 'ACTIVE' || candidate.role === 'SUPER_ADMIN') return false;

    if (actor.role === 'POLLING_STATION') {
      return candidate.role === 'CONSTITUENCY' && candidate.constituencyId === actor.constituencyId;
    }
    if (actor.role === 'CONSTITUENCY') {
      return (
        (candidate.role === 'CONSTITUENCY' && candidate.constituencyId === actor.constituencyId) ||
        (candidate.role === 'POLLING_STATION' && candidate.constituencyId === actor.constituencyId) ||
        (candidate.role === 'REGIONAL' && candidate.regionId === actor.regionId)
      );
    }
    if (actor.role === 'REGIONAL') {
      return (
        (candidate.role === 'REGIONAL' && candidate.regionId === actor.regionId) ||
        (candidate.role === 'CONSTITUENCY' &&
          candidate.regionId === actor.regionId &&
          (!constituencyIdQuery || candidate.constituencyId === constituencyIdQuery)) ||
        candidate.role === 'NATIONAL'
      );
    }
    if (actor.role === 'NATIONAL') {
      if (regionIdQuery && candidate.regionId && candidate.regionId !== regionIdQuery) return false;
      return candidate.role === 'NATIONAL' || candidate.role === 'REGIONAL' || candidate.role === 'CONSTITUENCY';
    }
    if (actor.role === 'SUPER_ADMIN') {
      if (regionIdQuery && candidate.regionId && candidate.regionId !== regionIdQuery) return false;
      if (constituencyIdQuery && candidate.constituencyId && candidate.constituencyId !== constituencyIdQuery) {
        return false;
      }
      return true;
    }
    return false;
  });

  res.json({
    users: eligible.map((u) => toPublicUser(u, geo)),
  });
});

issuesRouter.post(
  '/',
  upload.single('attachment'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const actor = req.authUser!;
      const body = req.body ?? {};
      const settings = await store.getSettings();
      const maxMb = settings?.maxAttachmentMb ?? 5;

      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const categoryId = typeof body.categoryId === 'string' ? body.categoryId.trim() : '';
      const meetingDate = typeof body.meetingDate === 'string' ? body.meetingDate.trim() : '';
      const requestedAction =
        typeof body.requestedAction === 'string' ? body.requestedAction.trim() : '';
      const priority: IssuePriority = ISSUE_PRIORITIES.includes(body.priority)
        ? body.priority
        : 'Normal';
      const isEssential = body.isEssential === true || body.isEssential === 'true';
      const followUpDate =
        typeof body.followUpDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.followUpDate)
          ? body.followUpDate
          : null;
      const optionalFollowUpContact =
        typeof body.optionalFollowUpContact === 'string' && body.optionalFollowUpContact.trim()
          ? body.optionalFollowUpContact.trim().slice(0, 140)
          : null;
      const assignedToUserId =
        typeof body.assignedToUserId === 'string' && body.assignedToUserId.trim()
          ? body.assignedToUserId.trim()
          : null;

      if (title.length < 5 || title.length > 180) {
        res.status(400).json({ error: 'Issue title must be between 5 and 180 characters.' });
        return;
      }
      if (description.length < 15 || description.length > 4000) {
        res.status(400).json({ error: 'Description must be between 15 and 4000 characters.' });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
        res.status(400).json({ error: 'Valid meeting date (YYYY-MM-DD) is required.' });
        return;
      }
      if (requestedAction.length < 5 || requestedAction.length > 1500) {
        res.status(400).json({ error: 'Requested action must be between 5 and 1500 characters.' });
        return;
      }

      const [categories, regions, constituencies, pollingStations] = await Promise.all([
        store.listCategories(),
        store.listRegions(),
        store.listConstituencies(),
        store.listPollingStations(),
      ]);

      const category = categories.find((c) => c.id === categoryId && c.active);
      if (!category) {
        res.status(400).json({ error: 'Select a valid active issue category.' });
        return;
      }

      // Resolve location strictly inside actor's approved geographic scope
      let ps = actor.pollingStationId
        ? pollingStations.find((p) => p.id === actor.pollingStationId)
        : undefined;

      if (actor.role !== 'POLLING_STATION') {
        const requestedPs =
          typeof body.pollingStationId === 'string' ? body.pollingStationId.trim() : '';
        const newStationName =
          typeof body.newPollingStationName === 'string' ? body.newPollingStationName.trim() : '';
        const newStationCode =
          typeof body.newPollingStationCode === 'string' ? body.newPollingStationCode.trim().toUpperCase() : '';
        const requestedConstituencyId =
          typeof body.constituencyId === 'string' ? body.constituencyId.trim() : '';

        if (requestedPs) {
          ps = pollingStations.find((p) => p.id === requestedPs);
          if (!ps) {
            res.status(400).json({ error: 'Selected polling station was not found.' });
            return;
          }
        } else if (newStationName.length >= 2) {
          const targetConId =
            actor.role === 'CONSTITUENCY' && actor.constituencyId
              ? actor.constituencyId
              : requestedConstituencyId;
          const targetCon = constituencies.find((c) => c.id === targetConId);
          if (!targetCon) {
            res.status(400).json({ error: 'Select a valid constituency for the polling station.' });
            return;
          }
          if (actor.role === 'CONSTITUENCY' && targetCon.id !== actor.constituencyId) {
            res.status(403).json({ error: 'Access denied: constituency is outside your scope.' });
            return;
          }
          if (actor.role === 'REGIONAL' && targetCon.regionId !== actor.regionId) {
            res.status(403).json({ error: 'Access denied: constituency is outside your region.' });
            return;
          }

          const existingMatch = pollingStations.find(
            (p) =>
              p.constituencyId === targetCon.id &&
              p.name.toLowerCase() === newStationName.toLowerCase(),
          );
          if (existingMatch) {
            ps = existingMatch;
          } else {
            const newPs = {
              id: `ps-${crypto.randomBytes(4).toString('hex')}`,
              regionId: targetCon.regionId,
              constituencyId: targetCon.id,
              name: newStationName,
              code: newStationCode || `PS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            };
            await store.savePollingStation(newPs);
            ps = newPs;
          }
        } else {
          res.status(400).json({
            error: 'Select an existing polling station or enter the polling station name.',
          });
          return;
        }
      }

      if (!ps) {
        res.status(400).json({ error: 'Selected polling station was not found.' });
        return;
      }
      if (actor.role === 'CONSTITUENCY' && ps.constituencyId !== actor.constituencyId) {
        res.status(403).json({ error: 'Access denied: polling station is outside your constituency.' });
        return;
      }
      if (actor.role === 'REGIONAL' && ps.regionId !== actor.regionId) {
        res.status(403).json({ error: 'Access denied: polling station is outside your region.' });
        return;
      }

      const region = regions.find((r) => r.id === ps.regionId)!;
      const constituency = constituencies.find((c) => c.id === ps.constituencyId)!;

      // Validate optional attachment
      const attachments: AttachmentMeta[] = [];
      const issueId = crypto.randomUUID();

      if (req.file) {
        if (req.file.size > maxMb * 1024 * 1024) {
          res.status(400).json({ error: `Attachment exceeds maximum allowed size (${maxMb} MB).` });
          return;
        }
        if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
          res.status(400).json({ error: 'Only JPEG, PNG, WEBP images and PDF documents are allowed.' });
          return;
        }
        if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
          res.status(400).json({ error: 'Attachment file signature does not match its declared file type.' });
          return;
        }

        const attId = crypto.randomUUID();
        const storageKey = `${attId}-${sanitizeFilename(req.file.originalname)}`;
        fs.mkdirSync(config.uploadsDir, { recursive: true });
        fs.writeFileSync(path.join(config.uploadsDir, storageKey), req.file.buffer);

        attachments.push({
          id: attId,
          issueId,
          originalName: sanitizeFilename(req.file.originalname),
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          storageKey,
          uploadedByUserId: actor.id,
          uploadedByName: actor.fullName,
          createdAt: new Date().toISOString(),
        });
      }

      // Polling station reports route first to Constituency executives
      const requestedOriginLevel =
        typeof body.originLevel === 'string' &&
        ['POLLING_STATION', 'CONSTITUENCY', 'REGIONAL', 'NATIONAL'].includes(body.originLevel)
          ? (body.originLevel as IssueLevel)
          : null;
      const actorLevel: IssueLevel =
        actor.role === 'SUPER_ADMIN' ? requestedOriginLevel || 'POLLING_STATION' : (actor.role as IssueLevel);
      const initialLevel: IssueLevel =
        actorLevel === 'POLLING_STATION' ? 'CONSTITUENCY' : actorLevel;

      let assignedUser: UserRecord | null = null;
      if (assignedToUserId) {
        const candidate = await store.getUserById(assignedToUserId);
        if (!candidate || candidate.status !== 'ACTIVE' || candidate.role === 'SUPER_ADMIN') {
          res.status(400).json({ error: 'Selected assignee is not an active executive.' });
          return;
        }
        if (
          (candidate.role === 'CONSTITUENCY' && candidate.constituencyId !== constituency.id) ||
          (candidate.role === 'REGIONAL' && candidate.regionId !== region.id) ||
          (candidate.role === 'POLLING_STATION' && candidate.pollingStationId !== ps.id)
        ) {
          res.status(403).json({ error: 'Assignee is outside the issue geographic scope.' });
          return;
        }
        assignedUser = candidate;
      }

      const now = new Date().toISOString();
      const shortRand = crypto.randomBytes(2).toString('hex').toUpperCase();
      const referenceCode = `NPP-${region.code}-${Date.now().toString().slice(-4)}${shortRand}`;

      const issue: IssueRecord = {
        id: issueId,
        referenceCode,
        title,
        description,
        categoryId: category.id,
        categoryName: category.name,
        meetingDate,
        requestedAction,
        regionId: region.id,
        regionName: region.name,
        constituencyId: constituency.id,
        constituencyName: constituency.name,
        pollingStationId: ps.id,
        pollingStationName: ps.name,
        originLevel: actorLevel,
        currentLevel: initialLevel,
        status: assignedUser ? 'Assigned' : 'New',
        priority,
        isEssential,
        submittedByUserId: actor.id,
        submittedByName: actor.fullName,
        assignedToUserId: assignedUser?.id ?? null,
        assignedToName: assignedUser?.fullName ?? null,
        assignedToRole: assignedUser?.role ?? null,
        followUpDate,
        followUpOverdueNotifiedAt: null,
        optionalFollowUpContact,
        resolutionSummary: null,
        closureReason: null,
        escalationCount: 0,
        firstResponseAt: null,
        resolvedAt: null,
        closedAt: null,
        recurringGroupId: null,
        attachments,
        notes: [],
        history: [
          {
            id: crypto.randomUUID(),
            actorUserId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.role,
            action: 'SUBMITTED',
            summary: `Submitted ${priority}${isEssential ? ' / Essential' : ''} issue from ${ps.name} (${constituency.name}) to ${initialLevel} queue.`,
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      await store.saveIssue(issue);

      await logAuditEvent({
        actorUserId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'ISSUE_SUBMITTED',
        targetType: 'ISSUE',
        targetId: issue.id,
        severity: 'INFO',
        details: `Submitted ${issue.referenceCode} (${issue.constituencyName}, ${issue.regionName}).`,
        ip: req.ip,
      });

      await notifyLevelExecutives(
        issue,
        initialLevel,
        actor.id,
        'SUBMITTED',
        `New report ${issue.referenceCode}`,
        `A ${issue.priority}${issue.isEssential ? ' Essential' : ''} concern was submitted from ${issue.pollingStationName}.`,
      );

      res.status(201).json({ issue });
    } catch (err) {
      console.error('[issues/post]', err);
      res.status(500).json({ error: 'Unable to submit issue report.' });
    }
  },
);

issuesRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const issue = await store.getIssueById(String(req.params.id));
  if (!issue) {
    res.status(404).json({ error: 'Issue report not found.' });
    return;
  }

  if (!canAccessIssue(actor, issue)) {
    await logAuditEvent({
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'UNAUTHORIZED_ISSUE_ACCESS_BLOCKED',
      targetType: 'ISSUE',
      targetId: issue.id,
      severity: 'WARNING',
      details: `Blocked access attempt to ${issue.referenceCode} outside approved scope.`,
      ip: req.ip,
    });
    res.status(403).json({
      error: 'Access denied: this report is outside your approved geographic scope.',
    });
    return;
  }

  // Record view in history (throttled per actor within 30 minutes to keep history meaningful)
  const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
  const recentlyViewed = issue.history.some(
    (h) =>
      h.action === 'VIEWED' &&
      h.actorUserId === actor.id &&
      Date.parse(h.createdAt) >= thirtyMinsAgo,
  );
  if (!recentlyViewed) {
    issue.history.push({
      id: crypto.randomUUID(),
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'VIEWED',
      summary: `${actor.fullName} reviewed report.`,
      createdAt: new Date().toISOString(),
    });
    await store.saveIssue(issue);

    if (actor.role === 'SUPER_ADMIN') {
      await logAuditEvent({
        actorUserId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'SUPER_ADMIN_REPORT_VIEWED',
        targetType: 'ISSUE',
        targetId: issue.id,
        severity: 'INFO',
        details: `Super Admin reviewed ${issue.referenceCode} (${issue.constituencyName}, ${issue.regionName}).`,
        ip: req.ip,
      });
    }
  }

  const [allIssues, dismissals, groups] = await Promise.all([
    store.listIssues(),
    store.listRecurringDismissals(),
    store.listRecurringGroups(),
  ]);
  const scopedIssues = allIssues.filter((i) => canAccessIssue(actor, i));
  const suggestions = findRecurringSuggestions(issue, scopedIssues, dismissals);
  const recurringGroup = issue.recurringGroupId
    ? groups.find((g) => g.id === issue.recurringGroupId) ?? null
    : null;

  res.json({
    issue,
    suggestions,
    recurringGroup,
  });
});

issuesRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const issue = await store.getIssueById(String(req.params.id));
  if (!issue) {
    res.status(404).json({ error: 'Issue report not found.' });
    return;
  }

  if (!canAccessIssue(actor, issue)) {
    res.status(403).json({ error: 'Access denied: outside approved geographic scope.' });
    return;
  }

  const body = req.body ?? {};
  const now = new Date().toISOString();

  // Polling station executives may add a follow-up note on their own station's issue,
  // while executive management actions require Constituency+ authority.
  const hasManagementChanges =
    body.status !== undefined ||
    body.priority !== undefined ||
    body.isEssential !== undefined ||
    body.followUpDate !== undefined ||
    body.assignedToUserId !== undefined;

  if (hasManagementChanges && !canManageIssueAtLevel(actor, issue)) {
    res.status(403).json({
      error: 'Polling-station executives cannot reassign or alter executive workflow state.',
    });
    return;
  }

  if (issue.status === 'Resolved' || issue.status === 'Closed with reason') {
    if (hasManagementChanges) {
      res.status(400).json({ error: 'Resolved or closed issues cannot be modified directly.' });
      return;
    }
  }

  let changed = false;

  if (body.priority !== undefined && ISSUE_PRIORITIES.includes(body.priority) && body.priority !== issue.priority) {
    const oldVal = issue.priority;
    issue.priority = body.priority;
    issue.history.push({
      id: crypto.randomUUID(),
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'PRIORITY_CHANGED',
      summary: `Priority changed from ${oldVal} to ${issue.priority}.`,
      field: 'priority',
      oldValue: oldVal,
      newValue: issue.priority,
      createdAt: now,
    });
    changed = true;
  }

  if (typeof body.isEssential === 'boolean' && body.isEssential !== issue.isEssential) {
    const oldVal = String(issue.isEssential);
    issue.isEssential = body.isEssential;
    issue.history.push({
      id: crypto.randomUUID(),
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'ESSENTIAL_CHANGED',
      summary: issue.isEssential ? 'Marked as Essential issue.' : 'Removed Essential tag.',
      field: 'isEssential',
      oldValue: oldVal,
      newValue: String(issue.isEssential),
      createdAt: now,
    });
    changed = true;
  }

  if (body.followUpDate !== undefined) {
    const nextFollowUp =
      typeof body.followUpDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.followUpDate)
        ? body.followUpDate
        : null;
    if (nextFollowUp !== issue.followUpDate) {
      const oldVal = issue.followUpDate;
      issue.followUpDate = nextFollowUp;
      issue.followUpOverdueNotifiedAt = null;
      issue.history.push({
        id: crypto.randomUUID(),
        actorUserId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'FOLLOW_UP_UPDATED',
        summary: nextFollowUp
          ? `Follow-up date set to ${nextFollowUp}.`
          : 'Follow-up date cleared.',
        field: 'followUpDate',
        oldValue: oldVal,
        newValue: nextFollowUp,
        createdAt: now,
      });
      changed = true;
    }
  }

  let newlyAssignedUser: UserRecord | null = null;
  if (body.assignedToUserId !== undefined && body.assignedToUserId !== issue.assignedToUserId) {
    if (!body.assignedToUserId) {
      const oldName = issue.assignedToName;
      issue.assignedToUserId = null;
      issue.assignedToName = null;
      issue.assignedToRole = null;
      issue.history.push({
        id: crypto.randomUUID(),
        actorUserId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'ASSIGNED',
        summary: 'Owner unassigned.',
        field: 'assignedTo',
        oldValue: oldName,
        newValue: null,
        createdAt: now,
      });
      changed = true;
    } else {
      const target = await store.getUserById(String(body.assignedToUserId));
      if (!target || !isAssignableTarget(actor, target, issue)) {
        res.status(403).json({
          error: 'Target user is not within your authorized assignment scope or next escalation level.',
        });
        return;
      }
      const oldName = issue.assignedToName;
      issue.assignedToUserId = target.id;
      issue.assignedToName = target.fullName;
      issue.assignedToRole = target.role;
      if (issue.status === 'New' || issue.status === 'Under review') {
        issue.status = 'Assigned';
      }
      newlyAssignedUser = target;
      issue.history.push({
        id: crypto.randomUUID(),
        actorUserId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'ASSIGNED',
        summary: `Assigned to ${target.fullName}.`,
        field: 'assignedTo',
        oldValue: oldName,
        newValue: target.fullName,
        createdAt: now,
      });
      changed = true;
    }
  }

  if (
    body.status !== undefined &&
    ISSUE_STATUSES.includes(body.status) &&
    body.status !== issue.status
  ) {
    const requestedStatus: IssueStatus = body.status;
    if (
      requestedStatus === 'Escalated' ||
      requestedStatus === 'Resolved' ||
      requestedStatus === 'Closed with reason'
    ) {
      res.status(400).json({
        error: `Use the dedicated ${requestedStatus} workflow action with required justification.`,
      });
      return;
    }
    const oldVal = issue.status;
    issue.status = requestedStatus;
    issue.history.push({
      id: crypto.randomUUID(),
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'STATUS_CHANGED',
      summary: `Status updated from ${oldVal} to ${requestedStatus}.`,
      field: 'status',
      oldValue: oldVal,
      newValue: requestedStatus,
      createdAt: now,
    });
    changed = true;
  }

  if (typeof body.note === 'string' && body.note.trim().length > 0) {
    const noteContent = body.note.trim().slice(0, 2000);
    const noteType = body.noteType === 'ACTION_TAKEN' ? 'ACTION_TAKEN' : 'NOTE';
    issue.notes.push({
      id: crypto.randomUUID(),
      authorUserId: actor.id,
      authorName: actor.fullName,
      authorRole: actor.role,
      level: issue.currentLevel,
      noteType,
      content: noteContent,
      createdAt: now,
    });
    issue.history.push({
      id: crypto.randomUUID(),
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'NOTE_ADDED',
      summary: noteType === 'ACTION_TAKEN' ? `Recorded action: ${noteContent.slice(0, 100)}` : `Added internal note.`,
      createdAt: now,
    });
    changed = true;
  }

  if (!changed) {
    res.status(400).json({ error: 'No valid updates provided.' });
    return;
  }

  if (!issue.firstResponseAt && actor.role !== 'POLLING_STATION') {
    issue.firstResponseAt = now;
  }
  issue.updatedAt = now;
  await store.saveIssue(issue);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'ISSUE_UPDATED',
    targetType: 'ISSUE',
    targetId: issue.id,
    severity: 'INFO',
    details: `Updated ${issue.referenceCode}.`,
    ip: req.ip,
  });

  if (newlyAssignedUser && newlyAssignedUser.id !== actor.id) {
    await notifyOriginalSubmitterAndOwner(
      issue,
      actor.id,
      'ASSIGNED',
      `Assigned: ${issue.referenceCode}`,
      `${issue.title} has been assigned to ${newlyAssignedUser.fullName}.`,
    );
  } else {
    await notifyOriginalSubmitterAndOwner(
      issue,
      actor.id,
      'UPDATED',
      `Updated: ${issue.referenceCode}`,
      `An update was recorded on "${issue.title}" by ${actor.fullName}.`,
    );
  }

  res.json({ issue });
});

issuesRouter.post('/:id/escalate', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const issue = await store.getIssueById(String(req.params.id));
  if (!issue) {
    res.status(404).json({ error: 'Issue report not found.' });
    return;
  }

  if (!canManageIssueAtLevel(actor, issue)) {
    res.status(403).json({ error: 'Access denied: you cannot escalate this report.' });
    return;
  }

  if (issue.status === 'Resolved' || issue.status === 'Closed with reason') {
    res.status(400).json({ error: 'Cannot escalate a resolved or closed report.' });
    return;
  }

  const nextLevel = getNextEscalationLevel(issue.currentLevel);
  if (!nextLevel) {
    res.status(400).json({ error: 'This issue is already at the National executive level.' });
    return;
  }

  // Verify actor holds authority at or above currentLevel to escalate upward
  if (actor.role !== 'SUPER_ADMIN') {
    const rank: Record<IssueLevel, number> = {
      POLLING_STATION: 1,
      CONSTITUENCY: 2,
      REGIONAL: 3,
      NATIONAL: 4,
    };
    if (rank[actor.role as IssueLevel] < rank[issue.currentLevel]) {
      res.status(403).json({
        error: `This issue is currently at ${issue.currentLevel} level and cannot be escalated by ${actor.role}.`,
      });
      return;
    }
  }

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 10) {
    res.status(400).json({ error: 'Escalation reason must be at least 10 characters.' });
    return;
  }

  const now = new Date().toISOString();
  const prevLevel = issue.currentLevel;
  issue.currentLevel = nextLevel;
  issue.status = 'Escalated';
  issue.escalationCount += 1;
  if (!issue.firstResponseAt) issue.firstResponseAt = now;

  // Optional handoff assignment to a user at next level
  if (typeof req.body?.assignedToUserId === 'string' && req.body.assignedToUserId.trim()) {
    const target = await store.getUserById(req.body.assignedToUserId.trim());
    if (target && target.status === 'ACTIVE' && target.role === nextLevel) {
      if (
        (nextLevel === 'REGIONAL' && target.regionId === issue.regionId) ||
        nextLevel === 'NATIONAL'
      ) {
        issue.assignedToUserId = target.id;
        issue.assignedToName = target.fullName;
        issue.assignedToRole = target.role;
      }
    }
  }

  issue.notes.push({
    id: crypto.randomUUID(),
    authorUserId: actor.id,
    authorName: actor.fullName,
    authorRole: actor.role,
    level: prevLevel,
    noteType: 'ESCALATION',
    content: `Escalated from ${prevLevel} to ${nextLevel}: ${reason}`,
    createdAt: now,
  });

  issue.history.push({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'ESCALATED',
    summary: `Escalated from ${prevLevel} to ${nextLevel}. Reason: ${reason}`,
    field: 'currentLevel',
    oldValue: prevLevel,
    newValue: nextLevel,
    createdAt: now,
  });

  issue.updatedAt = now;
  await store.saveIssue(issue);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'ISSUE_ESCALATED',
    targetType: 'ISSUE',
    targetId: issue.id,
    severity: 'INFO',
    details: `Escalated ${issue.referenceCode} from ${prevLevel} to ${nextLevel}.`,
    ip: req.ip,
  });

  await notifyLevelExecutives(
    issue,
    nextLevel,
    actor.id,
    'ESCALATED',
    `Escalated to ${nextLevel}: ${issue.referenceCode}`,
    `${issue.title} was escalated from ${prevLevel}. Reason: ${reason}`,
  );
  await notifyOriginalSubmitterAndOwner(
    issue,
    actor.id,
    'ESCALATED',
    `Escalated: ${issue.referenceCode}`,
    `Your report "${issue.title}" has been escalated to ${nextLevel} level.`,
  );

  res.json({ issue });
});

issuesRouter.post('/:id/resolve', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const issue = await store.getIssueById(String(req.params.id));
  if (!issue) {
    res.status(404).json({ error: 'Issue report not found.' });
    return;
  }

  if (!canManageIssueAtLevel(actor, issue)) {
    res.status(403).json({ error: 'Access denied: you cannot resolve this issue.' });
    return;
  }

  const summary =
    typeof req.body?.resolutionSummary === 'string' ? req.body.resolutionSummary.trim() : '';
  if (summary.length < 10) {
    res.status(400).json({ error: 'Resolution summary must be at least 10 characters.' });
    return;
  }

  const now = new Date().toISOString();
  issue.status = 'Resolved';
  issue.resolutionSummary = summary;
  issue.resolvedAt = now;
  if (!issue.firstResponseAt) issue.firstResponseAt = now;

  issue.notes.push({
    id: crypto.randomUUID(),
    authorUserId: actor.id,
    authorName: actor.fullName,
    authorRole: actor.role,
    level: issue.currentLevel,
    noteType: 'RESOLUTION',
    content: summary,
    createdAt: now,
  });

  issue.history.push({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'RESOLVED',
    summary: `Resolved by ${actor.fullName}: ${summary}`,
    field: 'status',
    oldValue: issue.status,
    newValue: 'Resolved',
    createdAt: now,
  });

  issue.updatedAt = now;
  await store.saveIssue(issue);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'ISSUE_RESOLVED',
    targetType: 'ISSUE',
    targetId: issue.id,
    severity: 'INFO',
    details: `Resolved ${issue.referenceCode}.`,
    ip: req.ip,
  });

  await notifyOriginalSubmitterAndOwner(
    issue,
    actor.id,
    'RESOLVED',
    `Resolved: ${issue.referenceCode}`,
    `Outcome recorded for "${issue.title}": ${summary}`,
  );

  res.json({ issue });
});

issuesRouter.post('/:id/close', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const issue = await store.getIssueById(String(req.params.id));
  if (!issue) {
    res.status(404).json({ error: 'Issue report not found.' });
    return;
  }

  if (!canManageIssueAtLevel(actor, issue)) {
    res.status(403).json({ error: 'Access denied: you cannot close this issue.' });
    return;
  }

  const reason = typeof req.body?.closureReason === 'string' ? req.body.closureReason.trim() : '';
  if (reason.length < 10) {
    res.status(400).json({ error: 'Closure reason must be at least 10 characters.' });
    return;
  }

  const now = new Date().toISOString();
  const prevStatus = issue.status;
  issue.status = 'Closed with reason';
  issue.closureReason = reason;
  issue.closedAt = now;
  if (!issue.firstResponseAt) issue.firstResponseAt = now;

  issue.notes.push({
    id: crypto.randomUUID(),
    authorUserId: actor.id,
    authorName: actor.fullName,
    authorRole: actor.role,
    level: issue.currentLevel,
    noteType: 'CLOSURE',
    content: reason,
    createdAt: now,
  });

  issue.history.push({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'CLOSED',
    summary: `Closed with reason: ${reason}`,
    field: 'status',
    oldValue: prevStatus,
    newValue: 'Closed with reason',
    createdAt: now,
  });

  issue.updatedAt = now;
  await store.saveIssue(issue);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'ISSUE_CLOSED',
    targetType: 'ISSUE',
    targetId: issue.id,
    severity: 'INFO',
    details: `Closed ${issue.referenceCode} with recorded reason.`,
    ip: req.ip,
  });

  await notifyOriginalSubmitterAndOwner(
    issue,
    actor.id,
    'CLOSED',
    `Closed: ${issue.referenceCode}`,
    `"${issue.title}" was closed. Reason: ${reason}`,
  );

  res.json({ issue });
});

issuesRouter.get('/:id/attachments/:attId', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const issue = await store.getIssueById(String(req.params.id));
  if (!issue) {
    res.status(404).json({ error: 'Issue not found.' });
    return;
  }
  if (!canAccessIssue(actor, issue)) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const att = issue.attachments.find((a) => a.id === String(req.params.attId));
  if (!att) {
    res.status(404).json({ error: 'Attachment not found.' });
    return;
  }

  const filePath = path.resolve(config.uploadsDir, path.basename(att.storageKey));
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Attachment file unavailable on server storage.' });
    return;
  }

  res.setHeader('Content-Type', att.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(att.originalName)}"`);
  fs.createReadStream(filePath).pipe(res);
});
