import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import {
  USER_ROLE_LABELS,
  type PollingStationRecord,
  type UserRecord,
  type UserRole,
} from '../../shared/types.ts';
import { store } from '../db/store.ts';
import {
  clearSessionCookie,
  requireAuth,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  toPublicUser,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
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
  sha256,
  validatePasswordStrength,
  verifyPassword,
  verifyTotpCode,
} from '../security/crypto.ts';
import { authRateLimiter } from '../security/rateLimit.ts';
import { sendTransactionalEmail } from '../services/email.ts';
import { dispatchNotification } from '../services/notifications.ts';

interface PendingInviteMfa {
  inviteId: string;
  userId: string;
  passwordHash: string;
  totpSecret: string;
  expiresAtMs: number;
}

export const authRouter = express.Router();

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

authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const [geo, notifications, settings] = await Promise.all([
    getGeoMaps(),
    store.listNotificationsForUser(user.id),
    store.getSettings(),
  ]);

  res.json({
    user: toPublicUser(user, geo),
    unreadNotifications: notifications.filter((n) => !n.readAt).length,
    sessionExpiresAt: req.authSession?.expiresAt,
    sessionIdleExpiresAt: req.authSession?.idleExpiresAt,
    retentionDays: settings?.retentionDays ?? 730,
  });
});

authRouter.post('/login', authRateLimiter, async (req, res) => {
  try {
    const { email, password, totpCode, backupCode, selectedLevel } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await store.getUserByEmail(normalizedEmail);

    if (!user) {
      await logAuditEvent({
        actorUserId: null,
        actorName: normalizedEmail,
        actorRole: 'ANONYMOUS',
        action: 'LOGIN_FAILED_UNKNOWN_USER',
        targetType: 'AUTH',
        severity: 'WARNING',
        details: `Failed sign-in attempt for unrecognized email ${normalizedEmail}.`,
        ip: req.ip,
      });
      res.status(401).json({ error: 'Invalid credentials or multi-factor code.' });
      return;
    }

    if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      res.status(423).json({
        error: 'Account temporarily locked due to repeated failed attempts. Try again later or contact your administrator.',
      });
      return;
    }

    if (user.status !== 'ACTIVE') {
      await logAuditEvent({
        actorUserId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'LOGIN_BLOCKED_INACTIVE',
        targetType: 'USER',
        targetId: user.id,
        severity: 'WARNING',
        details: `Blocked sign-in attempt for account with status ${user.status}.`,
        ip: req.ip,
      });
      res.status(403).json({
        error:
          user.status === 'PENDING_APPROVAL'
            ? 'Your account is awaiting administrator approval before you can enter the portal.'
            : user.status === 'INVITED'
              ? 'Your invitation has not been activated yet. Open your invitation link to set your password.'
              : 'This account is suspended or deactivated. Contact a Platform Super Admin.',
      });
      return;
    }

    if (!user.passwordHash) {
      res.status(403).json({
        error: 'Account password setup is incomplete. Use your invitation or password reset link.',
      });
      return;
    }

    const passwordValid = await verifyPassword(password, user.passwordHash);
    if (!passwordValid) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      user.updatedAt = new Date().toISOString();
      await store.saveUser(user);

      await logAuditEvent({
        actorUserId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: user.lockedUntil ? 'LOGIN_LOCKED' : 'LOGIN_FAILED_PASSWORD',
        targetType: 'USER',
        targetId: user.id,
        severity: user.lockedUntil ? 'CRITICAL' : 'WARNING',
        details: `Invalid password attempt (${user.failedLoginAttempts}/5).`,
        ip: req.ip,
      });

      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // Verify TOTP or single-use backup code only if MFA is enabled for this account
    let matchedStep: number | null = null;
    if (user.mfaEnabled && user.mfaSecretEncrypted) {
      let mfaOk = false;

      if (typeof totpCode === 'string' && totpCode.trim().length > 0) {
        const secret = decryptText(user.mfaSecretEncrypted);
        const check = verifyTotpCode(secret, totpCode, user.lastTotpStepUsed);
        if (check.valid) {
          mfaOk = true;
          matchedStep = check.matchedStep;
        }
      } else if (typeof backupCode === 'string' && backupCode.trim().length > 0) {
        const normalizedBackup = backupCode.trim().toUpperCase();
        const candidateHash = sha256(normalizedBackup);
        const idx = user.mfaBackupCodeHashes.indexOf(candidateHash);
        if (idx >= 0) {
          mfaOk = true;
          user.mfaBackupCodeHashes.splice(idx, 1);
        }
      }

      if (!mfaOk) {
        user.failedLoginAttempts += 1;
        if (user.failedLoginAttempts >= 5) {
          user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }
        user.updatedAt = new Date().toISOString();
        await store.saveUser(user);

        await logAuditEvent({
          actorUserId: user.id,
          actorName: user.fullName,
          actorRole: user.role,
          action: 'LOGIN_FAILED_MFA',
          targetType: 'USER',
          targetId: user.id,
          severity: 'WARNING',
          details: 'Password succeeded but MFA verification failed.',
          ip: req.ip,
        });

        res.status(401).json({ error: 'Invalid credentials or multi-factor code.' });
        return;
      }
    }

    const now = new Date().toISOString();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now;
    if (matchedStep !== null) {
      user.lastTotpStepUsed = matchedStep;
    }
    user.updatedAt = now;
    await store.saveUser(user);

    const settings = await store.getSettings();
    const maxHours = settings?.sessionMaxHours ?? 12;
    const idleMinutes = settings?.sessionIdleMinutes ?? 45;
    const rawSessionToken = generateToken(32);

    await store.saveSession({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: sha256(rawSessionToken),
      mfaVerified: Boolean(user.mfaEnabled),
      expiresAt: new Date(Date.now() + maxHours * 3600 * 1000).toISOString(),
      idleExpiresAt: new Date(Date.now() + idleMinutes * 60 * 1000).toISOString(),
      revokedAt: null,
      ipHash: hashIp(req.ip || ''),
      userAgentSummary: String(req.get('user-agent') || '').slice(0, 120),
      createdAt: now,
      lastSeenAt: now,
    });

    setSessionCookie(res, rawSessionToken, maxHours * 3600 * 1000);

    // Selecting a level on login never grants access; server always enforces user.role.
    let roleMismatchNotice: string | null = null;
    if (
      typeof selectedLevel === 'string' &&
      selectedLevel.length > 0 &&
      selectedLevel !== user.role
    ) {
      roleMismatchNotice = `Signed in with your server-approved role (${USER_ROLE_LABELS[user.role]}). Selected login preference (${USER_ROLE_LABELS[selectedLevel as UserRole] || selectedLevel}) does not alter access.`;
    }

    await logAuditEvent({
      actorUserId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'LOGIN_SUCCESS',
      targetType: 'USER',
      targetId: user.id,
      severity: 'INFO',
      details: `Signed in with MFA.${roleMismatchNotice ? ' Login role selector differed from server role.' : ''}`,
      ip: req.ip,
    });

    const geo = await getGeoMaps();
    res.json({
      user: toPublicUser(user, geo),
      roleMismatchNotice,
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Unable to complete sign-in.' });
  }
});

authRouter.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (rawToken && typeof rawToken === 'string') {
    const session = await store.getSessionByTokenHash(sha256(rawToken));
    if (session && !session.revokedAt) {
      session.revokedAt = new Date().toISOString();
      await store.saveSession(session);
      const user = await store.getUserById(session.userId);
      if (user) {
        await logAuditEvent({
          actorUserId: user.id,
          actorName: user.fullName,
          actorRole: user.role,
          action: 'LOGOUT',
          targetType: 'AUTH',
          targetId: session.id,
          severity: 'INFO',
          details: 'User signed out.',
          ip: req.ip,
        });
      }
    }
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

authRouter.post('/register', authRateLimiter, async (req, res) => {
  try {
    const body = req.body ?? {};
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const titleOrOffice = typeof body.titleOrOffice === 'string' ? body.titleOrOffice.trim() : '';
    const role: UserRole = body.role;
    const regionId = typeof body.regionId === 'string' && body.regionId ? body.regionId : null;
    const constituencyId =
      typeof body.constituencyId === 'string' && body.constituencyId ? body.constituencyId : null;
    let pollingStationId =
      typeof body.pollingStationId === 'string' && body.pollingStationId
        ? body.pollingStationId
        : null;
    const customPollingStationName =
      typeof body.customPollingStationName === 'string'
        ? body.customPollingStationName.trim()
        : '';

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

    if (!['POLLING_STATION', 'CONSTITUENCY', 'REGIONAL', 'NATIONAL'].includes(role)) {
      res.status(400).json({ error: 'Select a valid executive level.' });
      return;
    }

    const [regions, constituencies, pollingStations] = await Promise.all([
      store.listRegions(),
      store.listConstituencies(),
      store.listPollingStations(),
    ]);

    if (role !== 'NATIONAL') {
      if (!regionId || !regions.some((r) => r.id === regionId)) {
        res.status(400).json({ error: 'Select a valid region.' });
        return;
      }
    }

    if (role === 'CONSTITUENCY' || role === 'POLLING_STATION') {
      const con = constituencies.find((c) => c.id === constituencyId && c.regionId === regionId);
      if (!con) {
        res.status(400).json({ error: 'Select a valid constituency within the chosen region.' });
        return;
      }
    }

    if (role === 'POLLING_STATION') {
      if (pollingStationId) {
        const ps = pollingStations.find(
          (p) => p.id === pollingStationId && p.constituencyId === constituencyId,
        );
        if (!ps) {
          res.status(400).json({ error: 'Select a valid polling station.' });
          return;
        }
      } else if (customPollingStationName.length >= 2 && regionId && constituencyId) {
        const existingMatch = pollingStations.find(
          (p) =>
            p.constituencyId === constituencyId &&
            p.name.toLowerCase() === customPollingStationName.toLowerCase(),
        );
        if (existingMatch) {
          pollingStationId = existingMatch.id;
        } else {
          const newStation: PollingStationRecord = {
            id: `ps-${crypto.randomBytes(4).toString('hex')}`,
            regionId,
            constituencyId,
            name: customPollingStationName,
            code: `PS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          };
          await store.savePollingStation(newStation);
          pollingStationId = newStation.id;
        }
      } else {
        res.status(400).json({
          error: 'Select a polling station or enter your polling station name.',
        });
        return;
      }
    }

    const existing = await store.getUserByEmail(email);
    if (existing) {
      res.status(409).json({
        error:
          existing.status === 'PENDING_APPROVAL'
            ? 'A registration for this email is already awaiting administrator approval.'
            : 'An account with this email already exists.',
      });
      return;
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    const user: UserRecord = {
      id: crypto.randomUUID(),
      fullName,
      email,
      titleOrOffice: titleOrOffice || USER_ROLE_LABELS[role],
      role,
      status: 'PENDING_APPROVAL',
      regionId: role === 'NATIONAL' ? null : regionId,
      constituencyId: role === 'POLLING_STATION' || role === 'CONSTITUENCY' ? constituencyId : null,
      pollingStationId: role === 'POLLING_STATION' ? pollingStationId : null,
      passwordHash,
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      mfaBackupCodeHashes: [],
      lastTotpStepUsed: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      invitedByUserId: null,
      approvedByUserId: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await store.saveUser(user);

    await logAuditEvent({
      actorUserId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'USER_SIGNUP_PENDING_APPROVAL',
      targetType: 'USER',
      targetId: user.id,
      severity: 'INFO',
      details: `${user.email} signed up as ${USER_ROLE_LABELS[role]} and awaits administrator approval.`,
      ip: req.ip,
    });

    const admins = (await store.listUsers()).filter(
      (u) => u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE',
    );
    await Promise.all(
      admins.map((admin) =>
        dispatchNotification({
          recipient: admin,
          issue: null,
          eventType: 'SECURITY_ALERT',
          title: `Account approval requested: ${user.fullName}`,
          message: `${user.fullName} (${user.email}) signed up for ${USER_ROLE_LABELS[role]} access and requires Super Admin approval.`,
        }),
      ),
    );

    res.status(201).json({
      success: true,
      message:
        'Registration submitted. An administrator must approve your account before you can sign in.',
    });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Unable to submit registration.' });
  }
});

authRouter.get('/invite/:token', authRateLimiter, async (req, res) => {
  const token = String(req.params.token || '');
  const invite = await store.getInviteByTokenHash(sha256(token));
  if (!invite || invite.usedAt || Date.parse(invite.expiresAt) <= Date.now()) {
    res.status(404).json({ error: 'Invitation link is invalid or has expired.' });
    return;
  }

  const user = await store.getUserById(invite.userId);
  if (!user || user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    res.status(403).json({ error: 'Invited account is no longer eligible for activation.' });
    return;
  }

  const geo = await getGeoMaps();
  res.json({
    user: toPublicUser(user, geo),
    expiresAt: invite.expiresAt,
  });
});

authRouter.post('/invite/:token/activate', authRateLimiter, async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const invite = await store.getInviteByTokenHash(sha256(token));
    if (!invite || invite.usedAt || Date.parse(invite.expiresAt) <= Date.now()) {
      res.status(404).json({ error: 'Invitation link is invalid or has expired.' });
      return;
    }

    const user = await store.getUserById(invite.userId);
    if (!user || user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      res.status(403).json({ error: 'Invited account is not eligible for activation.' });
      return;
    }

    const { password } = req.body ?? {};
    const pwdError = validatePasswordStrength(password);
    if (pwdError) {
      res.status(400).json({ error: pwdError });
      return;
    }

    const now = new Date().toISOString();
    user.passwordHash = await hashPassword(password);
    user.mfaEnabled = false;
    user.mfaSecretEncrypted = null;
    user.mfaBackupCodeHashes = [];
    user.status = 'ACTIVE';
    user.approvedAt = user.approvedAt || now;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now;
    user.updatedAt = now;
    await store.saveUser(user);

    invite.usedAt = now;
    await store.saveInvite(invite);

    const settings = await store.getSettings();
    const maxHours = settings?.sessionMaxHours ?? 12;
    const idleMinutes = settings?.sessionIdleMinutes ?? 45;
    const rawSessionToken = generateToken(32);

    await store.saveSession({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: sha256(rawSessionToken),
      mfaVerified: false,
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
      actorUserId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'INVITE_ACCEPTED_ACTIVATED',
      targetType: 'USER',
      targetId: user.id,
      severity: 'INFO',
      details: `Invited account activated (${USER_ROLE_LABELS[user.role]}).`,
      ip: req.ip,
    });

    const geo = await getGeoMaps();
    res.json({
      user: toPublicUser(user, geo),
    });
  } catch (err) {
    console.error('[invite/activate]', err);
    res.status(500).json({ error: 'Unable to complete account activation.' });
  }
});

authRouter.post('/invite/:token/initiate-mfa', authRateLimiter, async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const invite = await store.getInviteByTokenHash(sha256(token));
    if (!invite || invite.usedAt || Date.parse(invite.expiresAt) <= Date.now()) {
      res.status(404).json({ error: 'Invitation link is invalid or has expired.' });
      return;
    }

    const user = await store.getUserById(invite.userId);
    if (!user || user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      res.status(403).json({ error: 'Invited account is not eligible for activation.' });
      return;
    }

    const { password } = req.body ?? {};
    const pwdError = validatePasswordStrength(password);
    if (pwdError) {
      res.status(400).json({ error: pwdError });
      return;
    }

    const passwordHash = await hashPassword(password);
    const totpSecret = generateTotpSecret();
    const otpauthUri = buildOtpAuthUri(user.email, totpSecret, 'NPP Issue Portal');
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 220, margin: 1 });

    const payload: PendingInviteMfa = {
      inviteId: invite.id,
      userId: user.id,
      passwordHash,
      totpSecret,
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    };
    const enrollmentToken = encryptText(JSON.stringify(payload));

    res.json({
      enrollmentToken,
      qrDataUrl,
      manualSecret: totpSecret,
    });
  } catch (err) {
    console.error('[invite/initiate-mfa]', err);
    res.status(500).json({ error: 'Could not initialize MFA setup.' });
  }
});

authRouter.post('/invite/:token/complete', authRateLimiter, async (req, res) => {
  try {
    const token = String(req.params.token || '');
    const invite = await store.getInviteByTokenHash(sha256(token));
    if (!invite || invite.usedAt || Date.parse(invite.expiresAt) <= Date.now()) {
      res.status(404).json({ error: 'Invitation link is invalid or has expired.' });
      return;
    }

    const { enrollmentToken, totpCode } = req.body ?? {};
    if (typeof enrollmentToken !== 'string' || typeof totpCode !== 'string') {
      res.status(400).json({ error: 'Enrollment token and 6-digit MFA code are required.' });
      return;
    }

    let pending: PendingInviteMfa | null = null;
    try {
      pending = JSON.parse(decryptText(enrollmentToken)) as PendingInviteMfa;
    } catch {
      pending = null;
    }

    if (
      !pending ||
      pending.inviteId !== invite.id ||
      typeof pending.expiresAtMs !== 'number' ||
      pending.expiresAtMs < Date.now()
    ) {
      res.status(400).json({ error: 'MFA enrollment session expired. Please restart activation.' });
      return;
    }

    const verification = verifyTotpCode(pending.totpSecret, totpCode, null);
    if (!verification.valid) {
      res.status(400).json({ error: 'Invalid 6-digit authenticator code.' });
      return;
    }

    const user = await store.getUserById(pending.userId);
    if (!user) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const backup = generateBackupCodes(8);
    const now = new Date().toISOString();

    user.passwordHash = pending.passwordHash;
    user.mfaEnabled = true;
    user.mfaSecretEncrypted = encryptText(pending.totpSecret);
    user.mfaBackupCodeHashes = backup.hashes;
    user.lastTotpStepUsed = verification.matchedStep;
    user.status = 'ACTIVE';
    user.approvedAt = user.approvedAt || now;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now;
    user.updatedAt = now;
    await store.saveUser(user);

    invite.usedAt = now;
    await store.saveInvite(invite);

    const settings = await store.getSettings();
    const maxHours = settings?.sessionMaxHours ?? 12;
    const idleMinutes = settings?.sessionIdleMinutes ?? 45;
    const rawSessionToken = generateToken(32);

    await store.saveSession({
      id: crypto.randomUUID(),
      userId: user.id,
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
      actorUserId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'INVITE_ACCEPTED_MFA_ENROLLED',
      targetType: 'USER',
      targetId: user.id,
      severity: 'INFO',
      details: `Invited account activated with mandatory TOTP MFA (${USER_ROLE_LABELS[user.role]}).`,
      ip: req.ip,
    });

    const geo = await getGeoMaps();
    res.json({
      user: toPublicUser(user, geo),
      backupCodes: backup.plain,
    });
  } catch (err) {
    console.error('[invite/complete]', err);
    res.status(500).json({ error: 'Unable to complete account activation.' });
  }
});

authRouter.post('/password-reset/request', authRateLimiter, async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }

  const normalized = email.trim().toLowerCase();
  const user = await store.getUserByEmail(normalized);

  let emailDelivered = false;
  let deliveryNote =
    'If an active account matches this email and SMTP is configured, a secure reset link has been sent. Otherwise contact your Super Admin for a one-time reset link.';

  if (user && user.status === 'ACTIVE') {
    const rawToken = generateToken(24);
    const now = new Date().toISOString();
    await store.savePasswordReset({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      usedAt: null,
      createdByUserId: null,
      createdAt: now,
    });

    const resetUrl = `${req.protocol}://${req.get('host')}/?reset=${rawToken}`;
    const emailRes = await sendTransactionalEmail({
      to: user.email,
      subject: '[NPP Portal] Password Reset Request',
      text: `A password reset was requested for your NPP Internal Issue Portal account.\n\nUse this one-time link within 60 minutes (your authenticator MFA code will still be required):\n${resetUrl}\n\nIf you did not request this reset, contact your Platform Super Admin immediately.`,
    });

    emailDelivered = emailRes.sent;
    if (!emailRes.sent) {
      deliveryNote =
        'SMTP email delivery is not configured on this server. Contact your Platform Super Admin to generate a verified one-time reset link.';
    }

    await logAuditEvent({
      actorUserId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'USER',
      targetId: user.id,
      severity: 'INFO',
      details: `Password reset requested (emailSent=${emailRes.sent}).`,
      ip: req.ip,
    });
  }

  res.json({
    accepted: true,
    emailDelivered,
    message: deliveryNote,
  });
});

authRouter.post('/password-reset/confirm', authRateLimiter, async (req, res) => {
  try {
    const { token, newPassword, totpCode } = req.body ?? {};
    if (typeof token !== 'string' || typeof newPassword !== 'string') {
      res.status(400).json({ error: 'Reset token and new password are required.' });
      return;
    }

    const reset = await store.getPasswordResetByTokenHash(sha256(token));
    if (!reset || reset.usedAt || Date.parse(reset.expiresAt) <= Date.now()) {
      res.status(400).json({ error: 'Password reset link is invalid or expired.' });
      return;
    }

    const user = await store.getUserById(reset.userId);
    if (!user || user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Account is not active.' });
      return;
    }

    const pwdError = validatePasswordStrength(newPassword);
    if (pwdError) {
      res.status(400).json({ error: pwdError });
      return;
    }

    let matchedStep: number | null = null;
    if (user.mfaEnabled && user.mfaSecretEncrypted) {
      if (typeof totpCode !== 'string' || !totpCode.trim()) {
        res.status(400).json({ error: '6-digit authenticator code is required for this account.' });
        return;
      }
      const secret = decryptText(user.mfaSecretEncrypted);
      const mfaCheck = verifyTotpCode(secret, totpCode, user.lastTotpStepUsed);
      if (!mfaCheck.valid) {
        res.status(401).json({ error: 'Invalid 6-digit authenticator code.' });
        return;
      }
      matchedStep = mfaCheck.matchedStep;
    }

    const now = new Date().toISOString();
    user.passwordHash = await hashPassword(newPassword);
    if (matchedStep !== null) {
      user.lastTotpStepUsed = matchedStep;
    }
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = now;
    await store.saveUser(user);

    reset.usedAt = now;
    await store.savePasswordReset(reset);

    await store.revokeAllSessionsForUser(user.id);

    await logAuditEvent({
      actorUserId: user.id,
      actorName: user.fullName,
      actorRole: user.role,
      action: 'PASSWORD_RESET_COMPLETED',
      targetType: 'USER',
      targetId: user.id,
      severity: 'INFO',
      details: 'Password reset confirmed; prior sessions revoked.',
      ip: req.ip,
    });

    res.json({
      success: true,
      message: 'Password updated and prior sessions signed out. You may now sign in.',
    });
  } catch (err) {
    console.error('[password-reset/confirm]', err);
    res.status(500).json({ error: 'Unable to reset password.' });
  }
});
