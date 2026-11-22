import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './server/config.ts';
import { store } from './server/db/store.ts';
import { requireCsrf } from './server/middleware/auth.ts';
import { adminRouter } from './server/routes/admin.ts';
import { authRouter } from './server/routes/auth.ts';
import { issuesRouter } from './server/routes/issues.ts';
import { metaRouter } from './server/routes/meta.ts';
import { notificationsRouter } from './server/routes/notifications.ts';
import { recurringRouter } from './server/routes/recurring.ts';
import { setupRouter } from './server/routes/setup.ts';
import { apiRateLimiter } from './server/security/rateLimit.ts';

async function startServer() {
  await store.init();

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

  if (!config.isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] NPP Internal Issue Portal running on http://0.0.0.0:${config.port}`);
  });
}

startServer().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
