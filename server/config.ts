import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const runtimeFallbackSessionSecret = crypto.randomBytes(32).toString('hex');
const runtimeFallbackEncryptionKey = crypto.randomBytes(32).toString('hex');

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
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
  dataDir: path.resolve(process.cwd(), 'data'),
  uploadsDir: path.resolve(process.cwd(), 'uploads'),
};

export function isSmtpConfigured(): boolean {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}
