import express from 'express';
import { store } from '../db/store.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';

export const notificationsRouter = express.Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const notifications = await store.listNotificationsForUser(req.authUser!.id);
  res.json({
    notifications,
    unreadCount: notifications.filter((n) => !n.readAt).length,
  });
});

notificationsRouter.post('/:id/read', async (req: AuthenticatedRequest, res) => {
  const notifications = await store.listNotificationsForUser(req.authUser!.id);
  const target = notifications.find((n) => n.id === String(req.params.id));
  if (!target) {
    res.status(404).json({ error: 'Notification not found.' });
    return;
  }
  if (!target.readAt) {
    target.readAt = new Date().toISOString();
    await store.saveNotification(target);
  }
  res.json({ notification: target });
});

notificationsRouter.post('/read-all', async (req: AuthenticatedRequest, res) => {
  await store.markAllNotificationsRead(req.authUser!.id);
  res.json({ success: true });
});
