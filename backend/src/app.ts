import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { env } from './config/env.ts';
import { AppError } from './http/errors.ts';
import { errorHandler, notFoundHandler } from './http/middleware/errorHandler.ts';
import { readonlyGuard } from './http/middleware/readonly.ts';
import { aggregatesRouter } from './http/routes/aggregates.ts';
import { certificatesRouter } from './http/routes/certificates.ts';
import { erpRouter } from './http/routes/erp.ts';
import { healthRouter } from './http/routes/health.ts';
import { suppliersRouter } from './http/routes/suppliers.ts';

/**
 * Builds the app without binding a port, so integration tests can drive it through
 * supertest in-process — no port allocation, no teardown races, no sleeping.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));

  app.use(
    rateLimit({
      windowMs: 60_000,
      // Effectively disabled under test: the limiter guards a public deployment, and
      // letting it fire mid-suite would produce failures that say nothing about the code.
      limit: env.NODE_ENV === 'test' ? 1_000_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        next(new AppError('RATE_LIMITED', 'Too many requests; please slow down.'));
      },
    }),
  );

  app.use('/api', readonlyGuard);
  // The first two share a mount point rather than conflicting: app.use adds to a
  // middleware stack, so Express tries each router in turn and the one whose internal
  // path matches handles the request. Their paths are disjoint — /health against
  // /dashboard, /chain and /reference/* — and none of those share a segment worth
  // giving its own prefix. Health stays separate because it is an infrastructure probe,
  // not domain data.
  app.use('/api', healthRouter);
  app.use('/api', aggregatesRouter);

  // These two do share a segment across every one of their routes, so they get one.
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/certificates', certificatesRouter);
  app.use('/api/erp', erpRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
