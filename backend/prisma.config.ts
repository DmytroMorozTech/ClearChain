import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved the connection URL out of schema.prisma and into this file — the
 * schema no longer accepts a `url` on the datasource block. The runtime connection is
 * a separate concern: PrismaClient receives a driver adapter in its constructor
 * (see src/db/prisma.ts). This file configures the CLI only — migrate, db, generate.
 *
 * Paths below resolve relative to this file, not to the directory the CLI is run from.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Wired up in Phase 5; harmless until `prisma db seed` is actually invoked.
    seed: 'node prisma/seed.ts',
  },
  datasource: {
    // Read straight from process.env rather than via Prisma's `env()` helper. The
    // helper throws while the config file is being loaded, which breaks
    // `prisma generate` in the Docker builder stage — where no database exists and
    // none is needed to generate a client. Commands that genuinely require a
    // connection (migrate, db push, db seed) still fail on their own if this is empty.
    url: process.env.DATABASE_URL ?? '',
  },
});
