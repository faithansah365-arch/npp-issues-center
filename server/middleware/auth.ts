import type { NextFunction, Request, Response } from 'express';
import type {
  ConstituencyRecord,
  IssueLevel,
  IssueRecord,
  PollingStationRecord,
  PublicUser,
  RegionRecord,
  SessionRecord,
  UserRecord,
  UserRole,
} from '../../shared/types.ts';
import { config } from '../config.ts';
import { store } from '../db/store.ts';
import { sha256 } from '../security/crypto.ts';

export const SESSION_COOKIE_NAME = 'npp_portal_session';

export interface AuthenticatedRequest extends Request {
  authUser?: UserRecord;
  authSession?: SessionRecord;
}

export function setSessionCookie(res: Response, rawToken: string, maxAgeMs: number): void {
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd || config.isVercel || config.appUrl.startsWith('https://'),
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd || config.isVercel || config.appUrl.startsWith('https://'),
    path: '/',
  });
}

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const customHeader = req.get('x-requested-with');
  if (customHeader !== 'NPP-Portal') {
    res.status(403).json({ error: 'Security header verification failed.' });
    return;
  }

  const origin = req.get('origin');
  if (origin) {
    const allowedOrigins = new Set<string>([config.appUrl]);
    if (process.env.VERCEL_URL) {
      allowedOrigins.add(`https://${process.env.VERCEL_URL.trim()}`);
    }
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      allowedOrigins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`);
    }
    const host = req.get('host');
    if (host) {
      allowedOrigins.add(`http://${host}`);
      allowedOrigins.add(`https://${host}`);
    }
    const forwardedHost = req.get('x-forwarded-host');
    if (forwardedHost) {
      allowedOrigins.add(`http://${forwardedHost}`);
      allowedOrigins.add(`https://${forwardedHost}`);
    }
    if (!allowedOrigins.has(origin)) {
      res.status(403).json({ error: 'Request origin is not permitted.' });
      return;
    }
  }

  next();
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (!rawToken || typeof rawToken !== 'string') {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const session = await store.getSessionByTokenHash(sha256(rawToken));
  if (!session || session.revokedAt) {
    clearSessionCookie(res);
    res.status(401).json({ error: 'Session is invalid or has been signed out.' });
    return;
  }

  const nowMs = Date.now();
  if (Date.parse(session.expiresAt) <= nowMs || Date.parse(session.idleExpiresAt) <= nowMs) {
    session.revokedAt = new Date().toISOString();
    await store.saveSession(session);
    clearSessionCookie(res);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  const user = await store.getUserById(session.userId);
  if (!user || user.status !== 'ACTIVE') {
    session.revokedAt = new Date().toISOString();
    await store.saveSession(session);
    clearSessionCookie(res);
    res.status(403).json({ error: 'Account is not active or is awaiting administrator approval.' });
    return;
  }

  if (user.mfaEnabled && !session.mfaVerified) {
    res.status(401).json({ error: 'Multi-factor authentication verification required.' });
    return;
  }

  const settings = await store.getSettings();
  const idleMinutes = settings?.sessionIdleMinutes ?? 45;
  session.lastSeenAt = new Date(nowMs).toISOString();
  session.idleExpiresAt = new Date(nowMs + idleMinutes * 60 * 1000).toISOString();
  await store.saveSession(session);

  req.authUser = user;
  req.authSession = session;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: 'Access denied: your approved account role does not permit this action.',
      });
      return;
    }
    next();
  };
}

export function canAccessIssue(user: UserRecord, issue: IssueRecord): boolean {
  switch (user.role) {
    case 'POLLING_STATION':
      return Boolean(user.pollingStationId && issue.pollingStationId === user.pollingStationId);
    case 'CONSTITUENCY':
      return Boolean(user.constituencyId && issue.constituencyId === user.constituencyId);
    case 'REGIONAL':
      return Boolean(user.regionId && issue.regionId === user.regionId);
    case 'NATIONAL':
    case 'SUPER_ADMIN':
      return true;
    default:
      return false;
  }
}

export function getNextEscalationLevel(currentLevel: IssueLevel): IssueLevel | null {
  switch (currentLevel) {
    case 'POLLING_STATION':
      return 'CONSTITUENCY';
    case 'CONSTITUENCY':
      return 'REGIONAL';
    case 'REGIONAL':
      return 'NATIONAL';
    case 'NATIONAL':
      return null;
  }
}

export function canManageIssueAtLevel(user: UserRecord, issue: IssueRecord): boolean {
  if (!canAccessIssue(user, issue)) return false;
  if (user.role === 'POLLING_STATION') {
    // Polling station executives submit reports and can follow up / add notes on their own station's reports,
    // while constituency+ executives (and Super Admin) manage assignment, escalation, resolution, and closure.
    return false;
  }
  return true;
}

export function isAssignableTarget(
  actor: UserRecord,
  target: UserRecord,
  issue: IssueRecord,
): boolean {
  if (target.status !== 'ACTIVE' || target.role === 'SUPER_ADMIN') return false;

  const nextLevel = getNextEscalationLevel(issue.currentLevel);

  // Target must be in the issue's geographic jurisdiction
  if (target.role === 'POLLING_STATION' && target.pollingStationId !== issue.pollingStationId) {
    return false;
  }
  if (target.role === 'CONSTITUENCY' && target.constituencyId !== issue.constituencyId) {
    return false;
  }
  if (target.role === 'REGIONAL' && target.regionId !== issue.regionId) {
    return false;
  }

  if (actor.role === 'SUPER_ADMIN') {
    return (
      target.role === 'NATIONAL' ||
      target.role === 'REGIONAL' ||
      target.role === 'CONSTITUENCY' ||
      target.role === 'POLLING_STATION'
    );
  }

  // Actor can assign within their own approved scope OR to the next level in the escalation path
  if (actor.role === 'CONSTITUENCY') {
    return (
      target.role === 'CONSTITUENCY' ||
      target.role === 'POLLING_STATION' ||
      (nextLevel === 'REGIONAL' && target.role === 'REGIONAL')
    );
  }
  if (actor.role === 'REGIONAL') {
    return (
      target.role === 'REGIONAL' ||
      target.role === 'CONSTITUENCY' ||
      (nextLevel === 'NATIONAL' && target.role === 'NATIONAL')
    );
  }
  if (actor.role === 'NATIONAL') {
    return target.role === 'NATIONAL' || target.role === 'REGIONAL' || target.role === 'CONSTITUENCY';
  }
  return false;
}

export function toPublicUser(
  user: UserRecord,
  geo?: {
    regions: Map<string, RegionRecord>;
    constituencies: Map<string, ConstituencyRecord>;
    pollingStations: Map<string, PollingStationRecord>;
  },
): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    titleOrOffice: user.titleOrOffice,
    role: user.role,
    status: user.status,
    regionId: user.regionId,
    constituencyId: user.constituencyId,
    pollingStationId: user.pollingStationId,
    regionName: user.regionId ? geo?.regions.get(user.regionId)?.name ?? null : null,
    constituencyName: user.constituencyId
      ? geo?.constituencies.get(user.constituencyId)?.name ?? null
      : null,
    pollingStationName: user.pollingStationId
      ? geo?.pollingStations.get(user.pollingStationId)?.name ?? null
      : null,
    mfaEnabled: user.mfaEnabled,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}
