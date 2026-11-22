import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const runtimeFallbackSessionSecret = crypto.randomBytes(32).toString('hex');
const runtimeFallbackEncryptionKey = crypto.randomBytes(32).toString('hex');

const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const inferredAppUrl =
  (process.env.APP_URL || '').trim() ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.trim()}`
      : 'http://localhost:3000');

const writableBaseDir = isVercel ? os.tmpdir() : process.cwd();

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isVercel,
  appUrl: inferredAppUrl.replace(/\/+$/, ''),
  mongodbUri: (process.env.MONGODB_URI || '').trim(),
  sessionSecret: (process.env.SESSION_SECRET || '').trim() || runtimeFallbackSessionSecret,
  hasPersistentSessionSecret: Boolean((process.env.SESSION_SECRET || '').trim()),
  encryptionKeyHex: (process.env.ENCRYPTION_KEY || '').trim() || runtimeFallbackEncryptionKey,
  hasPersistentEncryptionKey: Boolean((process.env.ENCRYPTION_KEY || '').trim()),
  bootstrapAdminSecret: (process.env.BOOTSTRAP_ADMIN_SECRET || '').trim(),
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: (process.env.SMTP_USER || '').trim(),
    pass: (process.env.SMTP_PASS || '').trim(),
    from: (process.env.SMTP_FROM || 'NPP Issue Portal <no-reply@example.org>').trim(),
  },
  dataDir: path.resolve(writableBaseDir, isVercel ? 'npp-portal-data' : 'data'),
  uploadsDir: path.resolve(writableBaseDir, isVercel ? 'npp-portal-uploads' : 'uploads'),
};

export function isSmtpConfigured(): boolean {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}
