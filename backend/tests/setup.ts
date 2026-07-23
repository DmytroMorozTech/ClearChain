import 'dotenv/config';

import os from 'node:os';
import path from 'node:path';

import { hashPassword } from '../src/auth/password.ts';
import { TEST_PASSWORD, TEST_USERNAME } from './helpers/credentials.ts';

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

// Credentials for the suites. Hashed here rather than pasted in as a literal, so the
// tests exercise the same hashing path production uses instead of a fixture that could
// silently drift from it.
process.env.AUTH_USER = TEST_USERNAME;
process.env.AUTH_PASSWORD_HASH = await hashPassword(TEST_PASSWORD);
process.env.AUTH_SECRET = 'test-secret-long-enough-to-satisfy-the-schema';

// Uploads go to a throwaway directory so the suite never writes into the repo's own
// ./uploads folder, and so assertions about what landed on disk start from empty.
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'clearchain-test-uploads');
