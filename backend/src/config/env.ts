import 'dotenv/config';

/**
 * Environment access, read once at module load.
 *
 * Phase 3 replaces the hand-rolled `required()` below with a zod schema, so that a
 * missing or malformed variable fails at startup with one readable report rather than
 * as an undefined creeping into a query. Kept deliberately small until then.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Required environment variable ${name} is not set. Copy backend/.env.example to backend/.env.`,
    );
  }
  return value;
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 3001),
} as const;
