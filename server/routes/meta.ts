import express from 'express';
import { store } from '../db/store.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';

export const metaRouter = express.Router();

metaRouter.get('/privacy', async (_req, res) => {
  const settings = await store.getSettings();
  res.json({
    title: settings?.privacyNoticeTitle ?? 'NPP Internal Issue Portal Privacy Notice',
    body: settings?.privacyNoticeBody ?? '',
    retentionDays: settings?.retentionDays ?? 730,
    maxAttachmentMb: settings?.maxAttachmentMb ?? 5,
    ghanaDpaChecklist: settings?.ghanaDpaChecklist ?? null,
  });
});

metaRouter.get('/geography', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const [regions, constituencies, pollingStations] = await Promise.all([
    store.listRegions(),
    store.listConstituencies(),
    store.listPollingStations(),
  ]);

  if (user.role === 'SUPER_ADMIN' || user.role === 'NATIONAL') {
    res.json({ regions, constituencies, pollingStations });
    return;
  }

  if (user.role === 'REGIONAL') {
    res.json({
      regions: regions.filter((r) => r.id === user.regionId),
      constituencies: constituencies.filter((c) => c.regionId === user.regionId),
      pollingStations: pollingStations.filter((p) => p.regionId === user.regionId),
    });
    return;
  }

  if (user.role === 'CONSTITUENCY') {
    res.json({
      regions: regions.filter((r) => r.id === user.regionId),
      constituencies: constituencies.filter((c) => c.id === user.constituencyId),
      pollingStations: pollingStations.filter((p) => p.constituencyId === user.constituencyId),
    });
    return;
  }

  res.json({
    regions: regions.filter((r) => r.id === user.regionId),
    constituencies: constituencies.filter((c) => c.id === user.constituencyId),
    pollingStations: pollingStations.filter((p) => p.id === user.pollingStationId),
  });
});

metaRouter.get('/categories', requireAuth, async (_req, res) => {
  const categories = await store.listCategories();
  res.json({
    categories: categories.filter((c) => c.active),
  });
});
