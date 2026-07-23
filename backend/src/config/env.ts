import 'dotenv/config';

import { z } from 'zod';

/**
 * Environment is validated once, at startup, against a schema. A missing or malformed
 * variable then fails immediately with one readable report, rather than surfacing later
 * as an `undefined` that reached a query.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().min(1, 'must be a PostgreSQL connection string'),

  // The only switch that selects a storage driver. NODE_ENV never influences it —
  // coupling the two would make the S3 driver untestable outside production.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_242_880),

  // Required only when STORAGE_DRIVER=s3; the factory enforces that pairing so a
  // half-configured S3 setup fails at startup rather than on first upload.
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),

  // When true, every mutating route returns 403. One variable away from a safe
  // public deployment, rather than a retrofit.
  DEMO_READONLY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const report = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration:\n${report}\n\nCopy backend/.env.example to backend/.env and fill it in.`,
  );
}

export const env = parsed.data;

export type Env = typeof env;
