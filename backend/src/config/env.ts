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

  // ── Authentication ────────────────────────────────────────────────────────
  // One shared demo account. The password is stored hashed even though it is meant to
  // be handed out, because an environment variable holding readable credentials is the
  // kind of thing that gets copied somewhere it should not be.
  AUTH_USER: z.string().min(1).default('testUser'),
  AUTH_PASSWORD_HASH: z
    .string()
    .min(1, 'run `npm run auth:hash -w @clearchain/backend -- <password>` to generate one'),
  // Signs session cookies. Changing it invalidates every existing session at once,
  // which is the only revocation a single-account demo needs.
  AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),

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
