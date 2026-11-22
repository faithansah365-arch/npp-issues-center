import crypto from 'node:crypto';
import express from 'express';
import type { IssueLevel, RecurringGroupRecord, RecurringSuggestion } from '../../shared/types.ts';
import { store } from '../db/store.ts';
import {
  canAccessIssue,
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { logAuditEvent } from '../security/audit.ts';
import { findRecurringSuggestions } from '../services/similarity.ts';

export const recurringRouter = express.Router();

recurringRouter.use(requireAuth);
recurringRouter.use(
  requireRole('POLLING_STATION', 'CONSTITUENCY', 'REGIONAL', 'NATIONAL', 'SUPER_ADMIN'),
);

recurringRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const [allIssues, allGroups, dismissals] = await Promise.all([
    store.listIssues(),
    store.listRecurringGroups(),
    store.listRecurringDismissals(),
  ]);

  const scopedIssues = allIssues.filter((i) => canAccessIssue(actor, i));
  const scopedIssueIds = new Set(scopedIssues.map((i) => i.id));
  const issueMap = new Map(scopedIssues.map((i) => [i.id, i]));

  const groups = allGroups
    .filter((g) => g.issueIds.some((id) => scopedIssueIds.has(id)))
    .map((g) => ({
      ...g,
      issues: g.issueIds
        .map((id) => issueMap.get(id))
        .filter((i): i is NonNullable<typeof i> => Boolean(i)),
    }));

  // Compute unique top suggested pairs across scoped issues
  const seenPairs = new Set<string>();
  const suggestions: Array<{
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
  }> = [];

  for (const issue of scopedIssues) {
    const matches = findRecurringSuggestions(issue, scopedIssues, dismissals);
    for (const match of matches) {
      const pairKey = [issue.id, match.relatedIssueId].sort().join('::');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      suggestions.push({
        primaryIssue: {
          id: issue.id,
          referenceCode: issue.referenceCode,
          title: issue.title,
          categoryName: issue.categoryName,
          location: `${issue.pollingStationName}, ${issue.constituencyName}`,
          status: issue.status,
          createdAt: issue.createdAt,
        },
        suggestion: match,
      });
    }
  }

  res.json({
    groups,
    suggestions: suggestions.slice(0, 20),
  });
});

recurringRouter.post(
  '/confirm',
  requireRole('CONSTITUENCY', 'REGIONAL', 'NATIONAL', 'SUPER_ADMIN'),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.authUser!;
    const { issueIds, title, summary } = req.body ?? {};
    if (!Array.isArray(issueIds) || issueIds.length < 2) {
      res.status(400).json({ error: 'Select at least two related issues to confirm a recurring concern.' });
      return;
    }

    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    const cleanSummary = typeof summary === 'string' ? summary.trim() : '';
    if (cleanTitle.length < 5) {
      res.status(400).json({ error: 'Provide a descriptive title for the recurring concern.' });
      return;
    }

    const loaded = await Promise.all(issueIds.map((id) => store.getIssueById(String(id))));
    const validIssues = loaded.filter((i): i is NonNullable<typeof i> => Boolean(i));
    if (validIssues.length < 2) {
      res.status(404).json({ error: 'One or more selected issues could not be found.' });
      return;
    }

    for (const issue of validIssues) {
      if (!canAccessIssue(actor, issue)) {
        res.status(403).json({
          error: 'Access denied: all grouped reports must be within your approved scope.',
        });
        return;
      }
    }

    const now = new Date().toISOString();
    const existingGroupId = validIssues.find((i) => i.recurringGroupId)?.recurringGroupId;
    let group: RecurringGroupRecord | undefined;

    if (existingGroupId) {
      const allGroups = await store.listRecurringGroups();
      group = allGroups.find((g) => g.id === existingGroupId);
    }

    if (group) {
      const mergedIds = Array.from(new Set([...group.issueIds, ...validIssues.map((i) => i.id)]));
      group.issueIds = mergedIds;
      group.title = cleanTitle;
      if (cleanSummary) group.summary = cleanSummary;
    } else {
      group = {
        id: crypto.randomUUID(),
        title: cleanTitle,
        summary: cleanSummary || `Executive-confirmed recurring concern linking ${validIssues.length} separate reports.`,
        categoryId: validIssues[0].categoryId,
        categoryName: validIssues[0].categoryName,
        scopeLevel: actor.role === 'SUPER_ADMIN' ? 'NATIONAL' : (actor.role as IssueLevel),
        regionId: actor.regionId,
        constituencyId: actor.constituencyId,
        issueIds: validIssues.map((i) => i.id),
        confirmedByUserId: actor.id,
        confirmedByName: actor.fullName,
        confirmedAt: now,
        createdAt: now,
      };
    }

    await store.saveRecurringGroup(group);

    // Keep all original reports completely separate and intact; only link recurringGroupId + history
    for (const issue of validIssues) {
      issue.recurringGroupId = group.id;
      issue.history.push({
        id: crypto.randomUUID(),
        actorUserId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'RECURRING_CONFIRMED',
        summary: `Linked to recurring concern "${group.title}" (original report preserved intact).`,
        createdAt: now,
      });
      issue.updatedAt = now;
      await store.saveIssue(issue);
    }

    await logAuditEvent({
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'RECURRING_CONCERN_CONFIRMED',
      targetType: 'RECURRING_GROUP',
      targetId: group.id,
      severity: 'INFO',
      details: `Confirmed recurring concern "${group.title}" across ${validIssues.length} separate reports.`,
      ip: req.ip,
    });

    res.json({ group });
  },
);

recurringRouter.post(
  '/dismiss',
  requireRole('CONSTITUENCY', 'REGIONAL', 'NATIONAL', 'SUPER_ADMIN'),
  async (req: AuthenticatedRequest, res) => {
    const actor = req.authUser!;
    const { issueIdA, issueIdB } = req.body ?? {};
    if (typeof issueIdA !== 'string' || typeof issueIdB !== 'string') {
      res.status(400).json({ error: 'Both issue IDs are required.' });
      return;
    }
    const [a, b] = await Promise.all([
      store.getIssueById(issueIdA),
      store.getIssueById(issueIdB),
    ]);
    if (!a || !b || !canAccessIssue(actor, a) || !canAccessIssue(actor, b)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    await store.saveRecurringDismissal({
      id: crypto.randomUUID(),
      issueIdA,
      issueIdB,
      dismissedByUserId: actor.id,
      createdAt: new Date().toISOString(),
    });

    res.json({ success: true });
  },
);
