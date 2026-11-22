import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  USER_ROLE_LABELS,
  type AccountStatus,
  type CategoryRecord,
  type ConstituencyRecord,
  type HomepageSlideRecord,
  type InviteRecord,
  type PollingStationRecord,
  type UserRecord,
  type UserRole,
} from '../../shared/types.ts';
import { config, isSmtpConfigured } from '../config.ts';
import { store, type BackupPayload } from '../db/store.ts';
import {
  requireAuth,
  requireRole,
  toPublicUser,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import { logAuditEvent } from '../security/audit.ts';
import {
  generateToken,
  hashPassword,
  sha256,
  validatePasswordStrength,
} from '../security/crypto.ts';
import { sendTransactionalEmail } from '../services/email.ts';
import { dispatchNotification } from '../services/notifications.ts';

export const adminRouter = express.Router();

// Every Platform Admin endpoint requires authenticated session + MFA + SUPER_ADMIN role
adminRouter.use(requireAuth);
adminRouter.use(requireRole('SUPER_ADMIN'));

const ALLOWED_SLIDE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const slideUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024, // 4 MB max per homepage slider image
    files: 1,
  },
});

function validateImageMagicBytes(buffer: Buffer, mimeType: string): boolean {
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
  return false;
}

function toPublicSlide(s: HomepageSlideRecord) {
  const { imageDataBase64: _omit, storageKey: _omitKey, ...rest } = s;
  return rest;
}

async function getGeoMaps() {
  const [regions, constituencies, pollingStations] = await Promise.all([
    store.listRegions(),
    store.listConstituencies(),
    store.listPollingStations(),
  ]);
  return {
    regions: new Map(regions.map((r) => [r.id, r])),
    constituencies: new Map(constituencies.map((c) => [c.id, c])),
    pollingStations: new Map(pollingStations.map((p) => [p.id, p])),
  };
}

function validateRoleScope(params: {
  role: UserRole;
  regionId: string | null;
  constituencyId: string | null;
  pollingStationId: string | null;
}): string | null {
  if (params.role === 'POLLING_STATION') {
    if (!params.regionId || !params.constituencyId || !params.pollingStationId) {
      return 'Polling-station executives require region, constituency, and polling station assignment.';
    }
  } else if (params.role === 'CONSTITUENCY') {
    if (!params.regionId || !params.constituencyId) {
      return 'Constituency executives require region and constituency assignment.';
    }
  } else if (params.role === 'REGIONAL') {
    if (!params.regionId) {
      return 'Regional executives require region assignment.';
    }
  }
  return null;
}

adminRouter.get('/overview', async (_req, res) => {
  const [users, categories, settings, logs, regions, constituencies, stations] =
    await Promise.all([
      store.listUsers(),
      store.listCategories(),
      store.getSettings(),
      store.listAuditLogs(50),
      store.listRegions(),
      store.listConstituencies(),
      store.listPollingStations(),
    ]);

  const activeUsers = users.filter((u) => u.status === 'ACTIVE').length;
  const pendingApprovals = users.filter((u) => u.status === 'PENDING_APPROVAL').length;
  const pendingInvites = users.filter((u) => u.status === 'INVITED').length;
  const suspendedUsers = users.filter((u) => u.status === 'SUSPENDED').length;

  res.json({
    storageMode: store.getStorageMode(),
    nodeEnv: config.nodeEnv,
    smtpConfigured: isSmtpConfigured(),
    securityReadiness: {
      mongodbAtlasConfigured: store.getStorageMode() === 'mongodb_atlas',
      persistentSessionSecret: config.hasPersistentSessionSecret,
      persistentEncryptionKey: config.hasPersistentEncryptionKey,
      bootstrapSecretRemoved: !config.bootstrapAdminSecret,
      smtpConfigured: isSmtpConfigured(),
      dpaChecklistComplete: Boolean(
        settings?.ghanaDpaChecklist.dpaRegistrationReviewed &&
          settings?.ghanaDpaChecklist.lawfulBasisDocumented &&
          settings?.ghanaDpaChecklist.retentionPolicyApproved &&
          settings?.ghanaDpaChecklist.officerTrainingCompleted &&
          settings?.ghanaDpaChecklist.breachResponsePlanActive,
      ),
    },
    counts: {
      totalUsers: users.length,
      activeUsers,
      pendingApprovals,
      pendingInvites,
      suspendedUsers,
      activeCategories: categories.filter((c) => c.active).length,
      regions: regions.length,
      constituencies: constituencies.length,
      pollingStations: stations.length,
    },
    recentAuditEvents: logs.slice(0, 10),
  });
});

adminRouter.get('/users', async (_req, res) => {
  const [users, geo] = await Promise.all([store.listUsers(), getGeoMaps()]);
  res.json({
    users: users.map((u) => toPublicUser(u, geo)),
  });
});

adminRouter.post('/users/invite', async (req: AuthenticatedRequest, res) => {
  try {
    const actor = req.authUser!;
    const body = req.body ?? {};

    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const titleOrOffice = typeof body.titleOrOffice === 'string' ? body.titleOrOffice.trim() : '';
    const role: UserRole = body.role;
    const regionId = typeof body.regionId === 'string' && body.regionId ? body.regionId : null;
    const constituencyId =
      typeof body.constituencyId === 'string' && body.constituencyId ? body.constituencyId : null;
    const pollingStationId =
      typeof body.pollingStationId === 'string' && body.pollingStationId
        ? body.pollingStationId
        : null;

    if (fullName.length < 3) {
      res.status(400).json({ error: 'Full name must be at least 3 characters.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Provide a valid email address.' });
      return;
    }
    if (!Object.keys(USER_ROLE_LABELS).includes(role)) {
      res.status(400).json({ error: 'Select a valid account role.' });
      return;
    }

    const scopeErr = validateRoleScope({ role, regionId, constituencyId, pollingStationId });
    if (scopeErr) {
      res.status(400).json({ error: scopeErr });
      return;
    }

    const existing = await store.getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const user: UserRecord = {
      id: userId,
      fullName,
      email,
      titleOrOffice: titleOrOffice || USER_ROLE_LABELS[role],
      role,
      status: 'INVITED',
      regionId: role === 'NATIONAL' || role === 'SUPER_ADMIN' ? null : regionId,
      constituencyId: role === 'POLLING_STATION' || role === 'CONSTITUENCY' ? constituencyId : null,
      pollingStationId: role === 'POLLING_STATION' ? pollingStationId : null,
      passwordHash: null,
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      mfaBackupCodeHashes: [],
      lastTotpStepUsed: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      invitedByUserId: actor.id,
      approvedByUserId: actor.id,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await store.saveUser(user);

    const rawInviteToken = generateToken(24);
    const invite: InviteRecord = {
      id: crypto.randomUUID(),
      userId,
      tokenHash: sha256(rawInviteToken),
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      usedAt: null,
      createdByUserId: actor.id,
      createdAt: now,
    };
    await store.saveInvite(invite);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const inviteUrl = `${baseUrl}/?invite=${rawInviteToken}`;

    const emailRes = await sendTransactionalEmail({
      to: user.email,
      subject: '[NPP Issue Portal] Authorized Executive Invitation',
      text: `You have been invited as ${USER_ROLE_LABELS[role]} on the NPP Internal Issue Resolution Portal.\n\nComplete your password setup within 72 hours:\n${inviteUrl}\n`,
    });

    await logAuditEvent({
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'USER_INVITED',
      targetType: 'USER',
      targetId: user.id,
      severity: role === 'SUPER_ADMIN' || role === 'NATIONAL' ? 'CRITICAL' : 'INFO',
      details: `Invited ${user.email} as ${role} (emailSent=${emailRes.sent}).`,
      ip: req.ip,
    });

    const geo = await getGeoMaps();
    res.status(201).json({
      user: toPublicUser(user, geo),
      inviteToken: rawInviteToken,
      inviteUrl,
      emailSent: emailRes.sent,
      emailStatusNote: emailRes.reason,
    });
  } catch (err) {
    console.error('[admin/users/invite]', err);
    res.status(500).json({ error: 'Unable to create invitation.' });
  }
});

// Direct Admin Enrollment (immediately ACTIVE, no MFA required right now)
adminRouter.post('/users/enroll', async (req: AuthenticatedRequest, res) => {
  try {
    const actor = req.authUser!;
    const body = req.body ?? {};

    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const titleOrOffice = typeof body.titleOrOffice === 'string' ? body.titleOrOffice.trim() : '';
    const role: UserRole = body.role;
    const regionId = typeof body.regionId === 'string' && body.regionId ? body.regionId : null;
    const constituencyId =
      typeof body.constituencyId === 'string' && body.constituencyId ? body.constituencyId : null;
    const pollingStationId =
      typeof body.pollingStationId === 'string' && body.pollingStationId
        ? body.pollingStationId
        : null;

    if (fullName.length < 3) {
      res.status(400).json({ error: 'Full name must be at least 3 characters.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Provide a valid email address.' });
      return;
    }
    const pwdError = validatePasswordStrength(password);
    if (pwdError) {
      res.status(400).json({ error: pwdError });
      return;
    }
    if (!Object.keys(USER_ROLE_LABELS).includes(role)) {
      res.status(400).json({ error: 'Select a valid account role.' });
      return;
    }

    const scopeErr = validateRoleScope({ role, regionId, constituencyId, pollingStationId });
    if (scopeErr) {
      res.status(400).json({ error: scopeErr });
      return;
    }

    const existing = await store.getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const user: UserRecord = {
      id: userId,
      fullName,
      email,
      titleOrOffice: titleOrOffice || USER_ROLE_LABELS[role],
      role,
      status: 'ACTIVE',
      regionId: role === 'NATIONAL' || role === 'SUPER_ADMIN' ? null : regionId,
      constituencyId: role === 'POLLING_STATION' || role === 'CONSTITUENCY' ? constituencyId : null,
      pollingStationId: role === 'POLLING_STATION' ? pollingStationId : null,
      passwordHash: await hashPassword(password),
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      mfaBackupCodeHashes: [],
      lastTotpStepUsed: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      invitedByUserId: actor.id,
      approvedByUserId: actor.id,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await store.saveUser(user);

    const loginUrl = `${req.protocol}://${req.get('host')}/`;
    const emailRes = await sendTransactionalEmail({
      to: user.email,
      subject: '[NPP Issue Portal] Account Enrolled & Approved',
      text: `You have been enrolled as ${USER_ROLE_LABELS[role]} on the NPP Internal Issue Resolution Portal.\n\nSign in at: ${loginUrl}\nEmail: ${user.email}`,
    });

    await logAuditEvent({
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'USER_DIRECTLY_ENROLLED',
      targetType: 'USER',
      targetId: user.id,
      severity: role === 'SUPER_ADMIN' || role === 'NATIONAL' ? 'CRITICAL' : 'INFO',
      details: `Directly enrolled ${user.email} as ${role} (ACTIVE).`,
      ip: req.ip,
    });

    const geo = await getGeoMaps();
    res.status(201).json({
      user: toPublicUser(user, geo),
      emailSent: emailRes.sent,
      emailStatusNote: emailRes.reason,
    });
  } catch (err) {
    console.error('[admin/users/enroll]', err);
    res.status(500).json({ error: 'Unable to enroll account.' });
  }
});

adminRouter.patch('/users/:id', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const target = await store.getUserById(String(req.params.id));
  if (!target) {
    res.status(404).json({ error: 'User account not found.' });
    return;
  }

  const body = req.body ?? {};
  const now = new Date().toISOString();
  const changes: string[] = [];
  const wasPendingApproval = target.status === 'PENDING_APPROVAL';

  if (body.status && ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(body.status)) {
    if (target.id === actor.id && body.status !== 'ACTIVE') {
      res.status(400).json({ error: 'You cannot suspend or deactivate your own Super Admin account.' });
      return;
    }
    const nextStatus = body.status as AccountStatus;
    if (nextStatus !== target.status) {
      changes.push(`status ${target.status} -> ${nextStatus}`);
      target.status = nextStatus;
      if (nextStatus === 'ACTIVE' && !target.approvedAt) {
        target.approvedAt = now;
        target.approvedByUserId = actor.id;
      }
      if (nextStatus === 'SUSPENDED' || nextStatus === 'DEACTIVATED') {
        await store.revokeAllSessionsForUser(target.id);
      }
    }
  }

  if (body.role && Object.keys(USER_ROLE_LABELS).includes(body.role)) {
    if (target.id === actor.id && body.role !== 'SUPER_ADMIN') {
      res.status(400).json({ error: 'You cannot demote your own Super Admin account.' });
      return;
    }
    const nextRole = body.role as UserRole;
    const regionId =
      body.regionId !== undefined ? body.regionId || null : target.regionId;
    const constituencyId =
      body.constituencyId !== undefined ? body.constituencyId || null : target.constituencyId;
    const pollingStationId =
      body.pollingStationId !== undefined ? body.pollingStationId || null : target.pollingStationId;

    const scopeErr = validateRoleScope({
      role: nextRole,
      regionId,
      constituencyId,
      pollingStationId,
    });
    if (scopeErr) {
      res.status(400).json({ error: scopeErr });
      return;
    }

    changes.push(`role/scope updated (${target.role} -> ${nextRole})`);
    target.role = nextRole;
    target.regionId = nextRole === 'NATIONAL' || nextRole === 'SUPER_ADMIN' ? null : regionId;
    target.constituencyId =
      nextRole === 'POLLING_STATION' || nextRole === 'CONSTITUENCY' ? constituencyId : null;
    target.pollingStationId = nextRole === 'POLLING_STATION' ? pollingStationId : null;
    await store.revokeAllSessionsForUser(target.id);
  }

  if (typeof body.titleOrOffice === 'string' && body.titleOrOffice.trim()) {
    target.titleOrOffice = body.titleOrOffice.trim();
    changes.push('title updated');
  }

  if (body.unlockAccount === true) {
    target.failedLoginAttempts = 0;
    target.lockedUntil = null;
    changes.push('account unlocked');
  }

  if (changes.length === 0) {
    res.status(400).json({ error: 'No valid account changes provided.' });
    return;
  }

  target.updatedAt = now;
  await store.saveUser(target);

  if (wasPendingApproval && target.status === 'ACTIVE') {
    await sendTransactionalEmail({
      to: target.email,
      subject: '[NPP Issue Portal] Account Approved',
      text: `Your executive account (${USER_ROLE_LABELS[target.role]}) on the NPP Internal Issue Resolution Portal has been approved by an administrator. You may now sign in.`,
    });
  }

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: wasPendingApproval && target.status === 'ACTIVE' ? 'USER_SIGNUP_APPROVED' : 'USER_PERMISSIONS_UPDATED',
    targetType: 'USER',
    targetId: target.id,
    severity: 'CRITICAL',
    details: `Updated ${target.email}: ${changes.join(', ')}.`,
    ip: req.ip,
  });

  const geo = await getGeoMaps();
  res.json({ user: toPublicUser(target, geo) });
});

adminRouter.post('/users/:id/reinvite', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const target = await store.getUserById(String(req.params.id));
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const rawToken = generateToken(24);
  const now = new Date().toISOString();

  if (target.status === 'INVITED') {
    await store.saveInvite({
      id: crypto.randomUUID(),
      userId: target.id,
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      usedAt: null,
      createdByUserId: actor.id,
      createdAt: now,
    });
    const url = `${req.protocol}://${req.get('host')}/?invite=${rawToken}`;
    const emailRes = await sendTransactionalEmail({
      to: target.email,
      subject: '[NPP Issue Portal] Account Activation Link',
      text: `Use this activation link within 72 hours:\n${url}`,
    });
    await logAuditEvent({
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'USER_INVITE_REISSUED',
      targetType: 'USER',
      targetId: target.id,
      severity: 'INFO',
      details: `Reissued invite link for ${target.email}.`,
      ip: req.ip,
    });
    res.json({
      actionType: 'INVITE',
      url,
      token: rawToken,
      emailSent: emailRes.sent,
      emailStatusNote: emailRes.reason,
    });
    return;
  }

  await store.savePasswordReset({
    id: crypto.randomUUID(),
    userId: target.id,
    tokenHash: sha256(rawToken),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    usedAt: null,
    createdByUserId: actor.id,
    createdAt: now,
  });

  const url = `${req.protocol}://${req.get('host')}/?reset=${rawToken}`;
  const emailRes = await sendTransactionalEmail({
    to: target.email,
    subject: '[NPP Issue Portal] Administrator-Issued Password Reset',
    text: `An administrator generated a 60-minute password reset link for your account (MFA code still required):\n${url}`,
  });

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'ADMIN_PASSWORD_RESET_LINK_ISSUED',
    targetType: 'USER',
    targetId: target.id,
    severity: 'WARNING',
    details: `Issued password reset link for ${target.email}.`,
    ip: req.ip,
  });

  res.json({
    actionType: 'PASSWORD_RESET',
    url,
    token: rawToken,
    emailSent: emailRes.sent,
    emailStatusNote: emailRes.reason,
  });
});

// Categories management
adminRouter.get('/categories', async (_req, res) => {
  res.json({ categories: await store.listCategories() });
});

adminRouter.post('/categories', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (name.length < 2 || name.length > 60) {
    res.status(400).json({ error: 'Category name must be 2–60 characters.' });
    return;
  }

  const existing = await store.listCategories();
  const cat: CategoryRecord = {
    id: `cat-${crypto.randomBytes(4).toString('hex')}`,
    name,
    description: description || `${name} concerns.`,
    active: true,
    sortOrder: existing.length + 1,
    createdAt: new Date().toISOString(),
  };
  await store.saveCategory(cat);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'CATEGORY_CREATED',
    targetType: 'CATEGORY',
    targetId: cat.id,
    severity: 'INFO',
    details: `Created issue category "${cat.name}".`,
    ip: req.ip,
  });

  res.status(201).json({ category: cat });
});

adminRouter.patch('/categories/:id', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const categories = await store.listCategories();
  const cat = categories.find((c) => c.id === String(req.params.id));
  if (!cat) {
    res.status(404).json({ error: 'Category not found.' });
    return;
  }

  if (typeof req.body?.name === 'string' && req.body.name.trim().length >= 2) {
    cat.name = req.body.name.trim();
  }
  if (typeof req.body?.description === 'string') {
    cat.description = req.body.description.trim();
  }
  if (typeof req.body?.active === 'boolean') {
    cat.active = req.body.active;
  }
  await store.saveCategory(cat);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'CATEGORY_UPDATED',
    targetType: 'CATEGORY',
    targetId: cat.id,
    severity: 'INFO',
    details: `Updated category "${cat.name}" (active=${cat.active}).`,
    ip: req.ip,
  });

  res.json({ category: cat });
});

// Geography management
adminRouter.post('/geography/constituency', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const { regionId, name, code } = req.body ?? {};
  if (typeof regionId !== 'string' || typeof name !== 'string' || name.trim().length < 2) {
    res.status(400).json({ error: 'Region and constituency name are required.' });
    return;
  }

  const record: ConstituencyRecord = {
    id: `con-${crypto.randomBytes(4).toString('hex')}`,
    regionId,
    name: name.trim(),
    code: typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : name.trim().slice(0, 6).toUpperCase(),
  };
  await store.saveConstituency(record);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'CONSTITUENCY_ADDED',
    targetType: 'GEOGRAPHY',
    targetId: record.id,
    severity: 'INFO',
    details: `Added constituency "${record.name}" under region ${regionId}.`,
    ip: req.ip,
  });

  res.status(201).json({ constituency: record });
});

adminRouter.post('/geography/polling-station', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const { regionId, constituencyId, name, code } = req.body ?? {};
  if (
    typeof regionId !== 'string' ||
    typeof constituencyId !== 'string' ||
    typeof name !== 'string' ||
    name.trim().length < 2
  ) {
    res.status(400).json({ error: 'Region, constituency, and polling station name are required.' });
    return;
  }

  const record: PollingStationRecord = {
    id: `ps-${crypto.randomBytes(4).toString('hex')}`,
    regionId,
    constituencyId,
    name: name.trim(),
    code: typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : `PS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
  };
  await store.savePollingStation(record);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'POLLING_STATION_ADDED',
    targetType: 'GEOGRAPHY',
    targetId: record.id,
    severity: 'INFO',
    details: `Added polling station "${record.name}" (${record.code}).`,
    ip: req.ip,
  });

  res.status(201).json({ pollingStation: record });
});

// Settings & Retention
adminRouter.get('/settings', async (_req, res) => {
  res.json({ settings: await store.getSettings() });
});

adminRouter.patch('/settings', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const current = await store.getSettings();
  if (!current) {
    res.status(500).json({ error: 'Settings unavailable.' });
    return;
  }

  const body = req.body ?? {};
  if (typeof body.retentionDays === 'number' && body.retentionDays >= 30 && body.retentionDays <= 3650) {
    current.retentionDays = Math.floor(body.retentionDays);
  }
  if (
    typeof body.sessionIdleMinutes === 'number' &&
    body.sessionIdleMinutes >= 10 &&
    body.sessionIdleMinutes <= 240
  ) {
    current.sessionIdleMinutes = Math.floor(body.sessionIdleMinutes);
  }
  if (
    typeof body.sessionMaxHours === 'number' &&
    body.sessionMaxHours >= 1 &&
    body.sessionMaxHours <= 72
  ) {
    current.sessionMaxHours = Math.floor(body.sessionMaxHours);
  }
  if (
    typeof body.maxAttachmentMb === 'number' &&
    body.maxAttachmentMb >= 1 &&
    body.maxAttachmentMb <= 10
  ) {
    current.maxAttachmentMb = Math.floor(body.maxAttachmentMb);
  }
  if (typeof body.privacyNoticeTitle === 'string' && body.privacyNoticeTitle.trim().length >= 5) {
    current.privacyNoticeTitle = body.privacyNoticeTitle.trim();
  }
  if (typeof body.privacyNoticeBody === 'string' && body.privacyNoticeBody.trim().length >= 20) {
    current.privacyNoticeBody = body.privacyNoticeBody.trim();
  }
  if (body.ghanaDpaChecklist && typeof body.ghanaDpaChecklist === 'object') {
    current.ghanaDpaChecklist = {
      dpaRegistrationReviewed: Boolean(body.ghanaDpaChecklist.dpaRegistrationReviewed),
      lawfulBasisDocumented: Boolean(body.ghanaDpaChecklist.lawfulBasisDocumented),
      retentionPolicyApproved: Boolean(body.ghanaDpaChecklist.retentionPolicyApproved),
      officerTrainingCompleted: Boolean(body.ghanaDpaChecklist.officerTrainingCompleted),
      breachResponsePlanActive: Boolean(body.ghanaDpaChecklist.breachResponsePlanActive),
    };
  }

  current.updatedByUserId = actor.id;
  current.updatedAt = new Date().toISOString();
  await store.saveSettings(current);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'SYSTEM_SETTINGS_UPDATED',
    targetType: 'SETTINGS',
    targetId: 'default',
    severity: 'CRITICAL',
    details: `Updated retention (${current.retentionDays}d), session timeouts (${current.sessionIdleMinutes}m/${current.sessionMaxHours}h), or DPA compliance checklist.`,
    ip: req.ip,
  });

  res.json({ settings: current });
});

// Audit logs
adminRouter.get('/audit-logs', async (req, res) => {
  const limit = Math.min(500, Math.max(20, Number(req.query.limit || 200)));
  const logs = await store.listAuditLogs(limit);
  res.json({ logs });
});

// Backups & Restore
adminRouter.get('/backup/export', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const backup = await store.exportBackup();

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'BACKUP_EXPORTED',
    targetType: 'SYSTEM',
    severity: 'CRITICAL',
    details: `Exported encrypted-transport JSON backup (${backup.data.issues.length} issues, ${backup.data.users.length} users).`,
    ip: req.ip,
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="npp-portal-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.send(JSON.stringify(backup, null, 2));
});

adminRouter.post('/backup/restore', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const payload = req.body as BackupPayload;
  if (!payload || payload.schemaVersion !== 1 || !payload.data || !Array.isArray(payload.data.users)) {
    res.status(400).json({ error: 'Invalid backup archive schema.' });
    return;
  }

  await store.restoreBackup(payload);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'BACKUP_RESTORED',
    targetType: 'SYSTEM',
    severity: 'CRITICAL',
    details: `Restored backup exported at ${payload.exportedAt}.`,
    ip: req.ip,
  });

  res.json({ success: true });
});

// Break-glass audited inspection (Audited diagnostic lookup by Issue UUID)
adminRouter.post('/break-glass/issue/:id', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 15) {
    res.status(400).json({
      error: 'Break-glass report inspection requires a written authorization reason (minimum 15 characters).',
    });
    return;
  }

  const issue = await store.getIssueById(String(req.params.id));
  if (!issue) {
    res.status(404).json({ error: 'Issue not found.' });
    return;
  }

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'SUPER_ADMIN_REPORT_ACCESS',
    targetType: 'ISSUE',
    targetId: issue.id,
    severity: 'CRITICAL',
    details: `Audited break-glass inspection of ${issue.referenceCode}. Reason: ${reason}`,
    ip: req.ip,
  });

  // Notify National executives of any break-glass Super Admin access
  const users = await store.listUsers();
  const nationals = users.filter((u) => u.role === 'NATIONAL' && u.status === 'ACTIVE');
  await Promise.all(
    nationals.map((nat) =>
      dispatchNotification({
        recipient: nat,
        issue,
        eventType: 'SECURITY_ALERT',
        title: `Super Admin break-glass access: ${issue.referenceCode}`,
        message: `${actor.fullName} accessed report ${issue.referenceCode} under break-glass justification: ${reason}`,
      }),
    ),
  );

  res.json({ issue });
});

// Homepage Gallery Slider Management
adminRouter.get('/slides', async (_req, res) => {
  const slides = await store.listHomepageSlides();
  res.json({ slides: slides.map(toPublicSlide) });
});

adminRouter.post(
  '/slides',
  slideUpload.single('image'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const actor = req.authUser!;
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Select an image file (JPEG, PNG, or WEBP).' });
        return;
      }
      if (!ALLOWED_SLIDE_MIME_TYPES.has(file.mimetype)) {
        res.status(400).json({ error: 'Only JPEG, PNG, or WEBP images are supported.' });
        return;
      }
      if (!validateImageMagicBytes(file.buffer, file.mimetype)) {
        res.status(400).json({ error: 'Uploaded file failed image signature verification.' });
        return;
      }

      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';
      if (title.length < 2 || title.length > 100) {
        res.status(400).json({ error: 'Slide title must be between 2 and 100 characters.' });
        return;
      }
      if (caption.length > 260) {
        res.status(400).json({ error: 'Slide caption must be 260 characters or fewer.' });
        return;
      }

      const slideId = `slide-${crypto.randomUUID()}`;
      const ext =
        file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const storageKey = `${slideId}.${ext}`;
      const slidesDir = path.join(config.uploadsDir, 'slides');
      fs.mkdirSync(slidesDir, { recursive: true });
      fs.writeFileSync(path.join(slidesDir, storageKey), file.buffer);

      const existing = await store.listHomepageSlides();
      const maxOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), 0);
      const now = new Date().toISOString();

      const slide: HomepageSlideRecord = {
        id: slideId,
        title,
        caption,
        imageUrl: `/api/meta/slides/${slideId}/image`,
        storageKey,
        mimeType: file.mimetype,
        imageDataBase64:
          store.getStorageMode() === 'mongodb_atlas' || config.isVercel
            ? file.buffer.toString('base64')
            : null,
        sortOrder: maxOrder + 1,
        active: true,
        uploadedByUserId: actor.id,
        createdAt: now,
        updatedAt: now,
      };

      await store.saveHomepageSlide(slide);

      await logAuditEvent({
        actorUserId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'HOMEPAGE_SLIDE_ADDED',
        targetType: 'HOMEPAGE_SLIDE',
        targetId: slide.id,
        severity: 'INFO',
        details: `Added homepage slider image "${slide.title}".`,
        ip: req.ip,
      });

      res.status(201).json({ slide: toPublicSlide(slide) });
    } catch (err) {
      console.error('[admin/slides POST]', err);
      res.status(500).json({ error: 'Unable to upload homepage image.' });
    }
  },
);

adminRouter.patch('/slides/:id', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const slide = await store.getHomepageSlideById(String(req.params.id));
  if (!slide) {
    res.status(404).json({ error: 'Homepage slide not found.' });
    return;
  }

  const body = req.body ?? {};
  if (typeof body.title === 'string') {
    const trimmed = body.title.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      res.status(400).json({ error: 'Slide title must be between 2 and 100 characters.' });
      return;
    }
    slide.title = trimmed;
  }
  if (typeof body.caption === 'string') {
    const trimmed = body.caption.trim();
    if (trimmed.length > 260) {
      res.status(400).json({ error: 'Slide caption must be 260 characters or fewer.' });
      return;
    }
    slide.caption = trimmed;
  }
  if (typeof body.active === 'boolean') {
    slide.active = body.active;
  }
  if (typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)) {
    slide.sortOrder = Math.floor(body.sortOrder);
  }
  slide.updatedAt = new Date().toISOString();

  await store.saveHomepageSlide(slide);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'HOMEPAGE_SLIDE_UPDATED',
    targetType: 'HOMEPAGE_SLIDE',
    targetId: slide.id,
    severity: 'INFO',
    details: `Updated homepage slider image "${slide.title}" (active=${slide.active}, order=${slide.sortOrder}).`,
    ip: req.ip,
  });

  res.json({ slide: toPublicSlide(slide) });
});

adminRouter.delete('/slides/:id', async (req: AuthenticatedRequest, res) => {
  const actor = req.authUser!;
  const slide = await store.getHomepageSlideById(String(req.params.id));
  if (!slide) {
    res.status(404).json({ error: 'Homepage slide not found.' });
    return;
  }

  if (slide.storageKey) {
    const filePath = path.join(config.uploadsDir, 'slides', path.basename(slide.storageKey));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  await store.deleteHomepageSlide(slide.id);

  await logAuditEvent({
    actorUserId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'HOMEPAGE_SLIDE_DELETED',
    targetType: 'HOMEPAGE_SLIDE',
    targetId: slide.id,
    severity: 'INFO',
    details: `Removed homepage slider image "${slide.title}".`,
    ip: req.ip,
  });

  res.json({ success: true });
});

