import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { prisma } from './db/prisma.ts';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`ClearChain API listening on http://localhost:${String(env.PORT)}/api`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, shutting down.`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
