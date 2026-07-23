import 'dotenv/config';

import { execSync } from 'node:child_process';

/**
 * Brings the test database up to the current migration state before any test runs, so
 * the suite works from a cold `docker compose up` without a manual setup step.
 */
export default function setup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy backend/.env.example to backend/.env — integration tests ' +
        'run against a separate database so they can truncate freely.',
    );
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
