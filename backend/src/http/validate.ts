import type { Request } from 'express';
import type { ZodType, z } from 'zod';

import { AppError, zodIssuesToDetails } from './errors.ts';

function parseOrThrow<T extends ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Invalid ${what}`,
      zodIssuesToDetails(result.error.issues),
    );
  }
  return result.data;
}

export const parseBody = <T extends ZodType>(req: Request, schema: T): z.infer<T> =>
  parseOrThrow(schema, req.body, 'request body');

export const parseQuery = <T extends ZodType>(req: Request, schema: T): z.infer<T> =>
  parseOrThrow(schema, req.query, 'query parameters');

export const parseParams = <T extends ZodType>(req: Request, schema: T): z.infer<T> =>
  parseOrThrow(schema, req.params, 'path parameters');
