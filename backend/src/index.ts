import { DASHBOARD_EXPIRY_WINDOW_DAYS, EXPIRING_SOON_DAYS } from './config/thresholds.js';
import { prisma } from './db/prisma.js';

// The HTTP server arrives in Phase 3. Until then this entry point proves the runtime
// path end to end: ESM + NodeNext resolution, the Prisma driver adapter, and a real
// round trip to PostgreSQL.
async function main(): Promise<void> {
  const [suppliers, countries] = await Promise.all([
    prisma.supplier.count(),
    prisma.countryRisk.count(),
  ]);

  console.log(
    `ClearChain backend — database reachable ` +
      `(suppliers: ${suppliers}, countries: ${countries}, ` +
      `expiring-soon: ${EXPIRING_SOON_DAYS}d, dashboard window: ${DASHBOARD_EXPIRY_WINDOW_DAYS}d)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Startup failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
