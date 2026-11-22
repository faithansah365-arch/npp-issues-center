import crypto from 'node:crypto';
import type { AuditLogRecord, UserRole } from '../../shared/types.ts';
import { store } from '../db/store.ts';
import { hashIp } from './crypto.ts';

export async function logAuditEvent(params: {
  actorUserId: string | null;
  actorName: string;
  actorRole: UserRole | 'SYSTEM' | 'ANONYMOUS';
  action: string;
  targetType: string;
  targetId?: string | null;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  details: string;
  ip?: string;
}): Promise<void> {
  const entry: AuditLogRecord = {
    id: crypto.randomUUID(),
    actorUserId: params.actorUserId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    severity: params.severity ?? 'INFO',
    details: params.details,
    ipHash: params.ip ? hashIp(params.ip) : null,
    createdAt: new Date().toISOString(),
  };
  await store.appendAuditLog(entry);
}
