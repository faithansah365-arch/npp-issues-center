import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import type { UserRecord } from '../../shared/types.ts';
import { config, isSmtpConfigured } from '../config.ts';
import { store } from '../db/store.ts';
import { setSessionCookie } from '../middleware/auth.ts';
import { logAuditEvent } from '../security/audit.ts';
import {
  buildOtpAuthUri,
  decryptText,
  encryptText,
  generateBackupCodes,
  generateToken,
  generateTotpSecret,
  hashIp,
  hashPassword,
  safeEqualStrings,
  sha256,
  validatePasswordStrength,
  verifyTotpCode,
} from '../security/crypto.ts';
import { setupRateLimiter } from '../security/rateLimit.ts';

interface PendingAdminBootstrap {
  fullName: string;
  email: string;
  passwordHash: string;
  totpSecret: string;
  expiresAtMs: number;
}

export const setupRouter = express.Router();

setupRouter.get('/status', async (_req, res) => {
  const users = await store.listUsers();
  const hasSuperAdmin = users.some((u) => u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE');

  res.json({
    hasSuperAdmin,
    bootstrapConfigured: Boolean(config.bootstrapAdminSecret),
    storageMode: store.getStorageMode(),
    smtpConfigured: isSmtpConfigured(),
  });
});

setupRouter.post('/first-admin/initiate', setupRateLimiter, async (req, res) => {
  try {
    const users = await store.listUsers();
    const existingAdmin = users.find((u) => u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE');
    if (existingAdmin) {
      res.status(409).json({
        error: 'A Super Admin account already exists. Public bootstrap is permanently disabled.',
      });
      return;
    }

    if (!config.bootstrapAdminSecret) {
      res.status(503).json({
        error:
          'BOOTSTRAP_ADMIN_SECRET is not configured on the server. Set BOOTSTRAP_ADMIN_SECRET in server environment variables or run npm run bootstrap-admin.',
      });
      return;
    }

    const { bootstrapSecret, fullName, email, password } = req.body ?? {};
    if (
      typeof bootstrapSecret !== 'string' ||
      !safeEqualStrings(bootstrapSecret.trim(), config.bootstrapAdminSecret)
    ) {
      await logAuditEvent({
        actorUserId: null,
        actorName: String(email || 'Unknown'),
        actorRole: 'ANONYMOUS',
        action: 'BOOTSTRAP_ADMIN_DENIED',
        targetType: 'SYSTEM',
        severity: 'CRITICAL',
        details: 'Invalid BOOTSTRAP_ADMIN_SECRET supplied during first-admin setup attempt.',
        ip: req.ip,
      });
      res.status(403).json({ error: 'Invalid server bootstrap secret.' });
      return;
    }

    if (typeof fullName !== 'string' || fullName.trim().length < 3) {
      res.status(400).json({ error: 'Full name must be at least 3 characters.' });
      return;
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'Provide a valid administrator email address.' });
      return;
    }

    const pwdError = validatePasswordStrength(password);
    if (pwdError) {
      res.status(400).json({ error: pwdError });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingEmail = await store.getUserByEmail(normalizedEmail);
    if (existingEmail) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const totpSecret = generateTotpSecret();
    const otpauthUri = buildOtpAuthUri(normalizedEmail, totpSecret, 'NPP Portal Admin');
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 220, margin: 1 });

    const payload: PendingAdminBootstrap = {
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash,
      totpSecret,
      expiresAtMs: Date.now() + 10 * 60 * 1000,
    };
    const setupToken = encryptText(JSON.stringify(payload));

    res.json({
      setupToken,
      qrDataUrl,
      manualSecret: totpSecret,
      email: normalizedEmail,
    });
  } catch (err) {
    console.error('[setup/initiate]', err);
    res.status(500).json({ error: 'Unable to initiate Super Admin setup.' });
  }
});

setupRouter.post('/first-admin/complete', setupRateLimiter, async (req, res) => {
  try {
    const users = await store.listUsers();
    if (users.some((u) => u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE')) {
      res.status(409).json({ error: 'A Super Admin account already exists.' });
      return;
    }

    const { setupToken, totpCode } = req.body ?? {};
    if (typeof setupToken !== 'string' || typeof totpCode !== 'string') {
      res.status(400).json({ error: 'Setup token and 6-digit MFA code are required.' });
      return;
    }

    let pending: PendingAdminBootstrap | null = null;
    try {
      pending = JSON.parse(decryptText(setupToken)) as PendingAdminBootstrap;
    } catch {
      pending = null;
    }

    if (!pending || typeof pending.expiresAtMs !== 'number' || pending.expiresAtMs < Date.now()) {
      res.status(400).json({ error: 'Setup session expired. Please restart first-admin setup.' });
      return;
    }

    const verification = verifyTotpCode(pending.totpSecret, totpCode, null);
    if (!verification.valid) {
      res.status(400).json({ error: 'Invalid 6-digit authenticator code. Please try again.' });
      return;
    }

    const backup = generateBackupCodes(8);
    const now = new Date().toISOString();
    const adminId = crypto.randomUUID();

    const adminUser: UserRecord = {
      id: adminId,
      fullName: pending.fullName,
      email: pending.email,
      titleOrOffice: 'Platform Super Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      regionId: null,
      constituencyId: null,
      pollingStationId: null,
      passwordHash: pending.passwordHash,
      mfaEnabled: true,
      mfaSecretEncrypted: encryptText(pending.totpSecret),
      mfaBackupCodeHashes: backup.hashes,
      lastTotpStepUsed: verification.matchedStep,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: now,
      invitedByUserId: null,
      approvedByUserId: adminId,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await store.saveUser(adminUser);

    const settings = await store.getSettings();
    const maxHours = settings?.sessionMaxHours ?? 12;
    const idleMinutes = settings?.sessionIdleMinutes ?? 45;
    const rawSessionToken = generateToken(32);

    await store.saveSession({
      id: crypto.randomUUID(),
      userId: adminId,
      tokenHash: sha256(rawSessionToken),
      mfaVerified: true,
      expiresAt: new Date(Date.now() + maxHours * 3600 * 1000).toISOString(),
      idleExpiresAt: new Date(Date.now() + idleMinutes * 60 * 1000).toISOString(),
      revokedAt: null,
      ipHash: hashIp(req.ip || ''),
      userAgentSummary: String(req.get('user-agent') || '').slice(0, 120),
      createdAt: now,
      lastSeenAt: now,
    });

    setSessionCookie(res, rawSessionToken, maxHours * 3600 * 1000);

    await logAuditEvent({
      actorUserId: adminId,
      actorName: adminUser.fullName,
      actorRole: 'SUPER_ADMIN',
      action: 'FIRST_SUPER_ADMIN_CREATED',
      targetType: 'USER',
      targetId: adminId,
      severity: 'CRITICAL',
      details: `First Super Admin account (${adminUser.email}) bootstrapped with mandatory TOTP MFA.`,
      ip: req.ip,
    });

    res.json({
      success: true,
      backupCodes: backup.plain,
      user: {
        id: adminUser.id,
        fullName: adminUser.fullName,
        email: adminUser.email,
        role: adminUser.role,
      },
    });
  } catch (err) {
    console.error('[setup/complete]', err);
    res.status(500).json({ error: 'Unable to complete Super Admin setup.' });
  }
});
