import { defineConfig } from 'vitest/config';

/**
 * Unit tests only — pure domain logic, no database, no HTTP.
 *
 * Integration tests live under tests/ and run from vitest.integration.config.ts,
 * because they need a live PostgreSQL. Keeping the two apart means this suite stays
 * runnable on a machine with nothing installed but Node.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
