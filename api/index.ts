import type { IncomingMessage, ServerResponse } from 'node:http';
import { getApiApp } from '../server/app.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await getApiApp();
    app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
  } catch (err) {
    console.error('[vercel/api] Backend initialization failed:', err);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error:
            err instanceof Error
              ? err.message
              : 'Backend failed to initialize. Check Vercel Environment Variables (MONGODB_URI, SESSION_SECRET, ENCRYPTION_KEY).',
          code: 'BACKEND_INIT_FAILED',
        }),
      );
    }
  }
}
