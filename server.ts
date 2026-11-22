import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { getApiApp } from './server/app.ts';
import { config } from './server/config.ts';

async function startServer() {
  const app = await getApiApp();
  const httpServer = http.createServer(app);

  if (!config.isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(
        express.static(distDir, {
          maxAge: '1y',
          setHeaders(res, filePath) {
            if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('manifest.webmanifest')) {
              res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
            }
          },
        }),
      );
      app.get('*', (_req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] NPP Internal Issue Portal running on http://0.0.0.0:${config.port}`);
  });
}

startServer().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
