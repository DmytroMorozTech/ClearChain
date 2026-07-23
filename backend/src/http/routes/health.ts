import { Router } from 'express';

import { prisma } from '../../db/prisma.ts';

export const APP_VERSION = '0.1.0';

export const healthRouter: Router = Router();

healthRouter.get('/health', async (_req, res) => {
  let db: 'up' | 'down' = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'down';
  }

  res.status(db === 'up' ? 200 : 503).json({
    status: db === 'up' ? 'ok' : 'degraded',
    db,
    version: APP_VERSION,
  });
});
