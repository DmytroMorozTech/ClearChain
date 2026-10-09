import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Who has been using AI certificate extraction, from the attempt log.
 *
 *   npm run llm:attempts -w @clearchain/backend
 *
 * On the server, through the tools image that carries the sources (the runtime image
 * ships compiled JavaScript only):
 *
 *   docker compose -f docker-compose.prod.yml --profile tools run --rm \
 *     --entrypoint "npm run llm:attempts -w @clearchain/backend" migrate
 *
 * Needs DATABASE_URL and nothing else. It builds its own client rather than importing
 * the app's, because that would validate the whole app environment — auth secrets
 * included — which the tools container does not carry and a read-only report does not
 * need. Locally it falls back to backend/.env.
 *
 * The log holds no addresses, so "client" is the first characters of a keyed hash and
 * "prefix" a truncated network — enough to see one caller hammering the endpoint.
 */
if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env here (the container case); the check below reports what is missing.
  }
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set.');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DAY_MS = 86_400_000;
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const weekStart = new Date(today.getTime() - 6 * DAY_MS);

const rows = await prisma.llmExtractionAttempt.findMany({
  where: { createdAt: { gte: weekStart } },
  orderBy: { createdAt: 'asc' },
});

type Row = (typeof rows)[number];

function summarise(subset: Row[]) {
  const byOutcome: Record<string, number> = {};
  const prefixes = new Map<string, number>();
  for (const row of subset) {
    byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
    prefixes.set(row.ipPrefix, (prefixes.get(row.ipPrefix) ?? 0) + 1);
  }
  return {
    attempts: subset.length,
    byOutcome,
    distinctClients: new Set(subset.map((row) => row.ipHash)).size,
    busiestPrefixes: [...prefixes].sort((a, b) => b[1] - a[1]).slice(0, 5),
    inputTokens: subset.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokens: subset.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
  };
}

console.log('Today (UTC):', summarise(rows.filter((row) => row.createdAt >= today)));
console.log('Last 7 days:', summarise(rows));
console.log('Most recent attempts:');
console.table(
  rows.slice(-20).map((row) => ({
    at: row.createdAt.toISOString().slice(0, 19).replace('T', ' '),
    client: row.ipHash.slice(0, 8),
    prefix: row.ipPrefix,
    outcome: row.outcome,
    model: row.model ?? '',
    tokens:
      row.inputTokens === null ? '' : `${String(row.inputTokens)}/${String(row.outputTokens)}`,
    ms: row.latencyMs ?? '',
  })),
);

await prisma.$disconnect();
