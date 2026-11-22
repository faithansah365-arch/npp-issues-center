import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.ts';
import { store } from '../db/store.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';

export const metaRouter = express.Router();

metaRouter.get('/slides', async (_req, res) => {
  const slides = await store.listHomepageSlides();
  res.json({
    slides: slides
      .filter((s) => s.active)
      .map(({ imageDataBase64: _omit, storageKey: _omitKey, ...pub }) => pub),
  });
});

metaRouter.get('/slides/:id/image', async (req, res) => {
  const slide = await store.getHomepageSlideById(String(req.params.id));
  if (!slide) {
    res.status(404).json({ error: 'Slide image not found.' });
    return;
  }

  const mimeType = slide.mimeType || 'image/jpeg';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (slide.storageKey) {
    const filePath = path.join(config.uploadsDir, 'slides', path.basename(slide.storageKey));
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
      return;
    }
  }

  if (slide.imageDataBase64) {
    const buf = Buffer.from(slide.imageDataBase64, 'base64');
    res.send(buf);
    return;
  }

  res.status(404).json({ error: 'Slide image bytes unavailable.' });
});

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
