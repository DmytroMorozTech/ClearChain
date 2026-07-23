import 'dotenv/config';

/**
 * Redirects the application at the test database *before* any application module is
 * imported. src/config/env.ts reads process.env at module load and src/db/prisma.ts
 * builds its adapter from that value, so this has to happen first — which is exactly
 * what a setup file guarantees.
 *
 * dotenv does not overwrite variables that are already set, so this assignment survives
 * the `import 'dotenv/config'` inside env.ts.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set; refusing to run integration tests. These tests truncate ' +
      'tables, so they must never be pointed at the development database.',
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = 'test';
