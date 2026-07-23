import { Router } from 'express';
import { z } from 'zod';

import { listSyncLogs, runErpSync } from '../../services/erpSyncService.ts';
import { parseQuery } from '../validate.ts';

export const erpRouter: Router = Router();

const syncLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

erpRouter.post('/sync', async (_req, res) => {
  const outcome = await runErpSync();
  res.json(outcome);
});

erpRouter.get('/sync-logs', async (req, res) => {
  const { limit } = parseQuery(req, syncLogsQuerySchema);
  res.json({ data: await listSyncLogs(limit) });
});
