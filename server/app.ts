import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.ts';
import { store } from './db/store.ts';
import { requireCsrf } from './middleware/auth.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { issuesRouter } from './routes/issues.ts';
import { metaRouter } from './routes/meta.ts';
import { notificationsRouter } from './routes/notifications.ts';
import { recurringRouter } from './routes/recurring.ts';
import { setupRouter } from './routes/setup.ts';
import { apiRateLimiter } from './security/rateLimit.ts';

let cachedApiApp: express.Express | null = null;
let apiAppInitPromise: Promise<express.Express> | null = null;

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);

  // Prevent indexing of internal party pages & enforce baseline HTTP protections
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: config.isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com'],
              imgSrc: ["'self'", 'data:', 'blob:'],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      storageMode: store.getStorageMode(),
      nodeEnv: config.nodeEnv,
      isVercel: config.isVercel,
      mongodbConfigured: Boolean(config.mongodbUri),
      persistentSecretsConfigured:
        config.hasPersistentSessionSecret && config.hasPersistentEncryptionKey,
    });
  });

  app.use('/api', apiRateLimiter, requireCsrf);
  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/issues', issuesRouter);
  app.use('/api/recurring', recurringRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}

export async function getApiApp(): Promise<express.Express> {
  if (cachedApiApp) return cachedApiApp;
  if (apiAppInitPromise) return apiAppInitPromise;

  apiAppInitPromise = (async () => {
    await store.init();
    const app = createApiApp();
    cachedApiApp = app;
    return app;
  })().catch((err) => {
    apiAppInitPromise = null;
    throw err;
  });

  return apiAppInitPromise;
}
