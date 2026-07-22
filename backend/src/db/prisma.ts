import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { env } from '../config/env.js';

/**
 * Prisma 7 ships a Rust-free client: queries are compiled by a WASM query compiler and
 * executed through a driver adapter, so there is no query-engine binary to distribute.
 * The connection is therefore configured here, in application code — prisma.config.ts
 * governs only the CLI (migrate, generate, db).
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
