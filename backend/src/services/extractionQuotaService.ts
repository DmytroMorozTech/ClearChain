import type { LlmAttemptOutcome } from '@prisma/client';

import { prisma } from '../db/prisma.ts';

/**
 * Daily limits for AI extraction, counted in the attempt log itself.
 *
 * Counting from the table rather than from memory means the limits survive a restart
 * or a redeploy. The count and the insert happen under one transaction-scoped advisory
 * lock, so two requests arriving together cannot both see "7 used" and both proceed.
 * Traffic is a handful of requests a day, so a single global lock costs nothing and
 * keeps the limits exact.
 */
export interface QuotaLimits {
  perIp: number;
  global: number;
}

export interface AttemptMeta {
  ipHash: string;
  supplierId: string;
  mimeType: string;
  fileSize: number;
  pageCount: number | null;
}

export type QuotaDecision =
  | { allowed: true; attemptId: string; remainingToday: number }
  | { allowed: false; scope: 'ip' | 'global' };

export interface AttemptDetails {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  warningCount?: number;
}

export const RETENTION_DAYS = 90;
const QUOTA_LOCK_KEY = 727_274;
const DAY_MS = 86_400_000;
/** Rejected attempts are logged for visibility but never spend quota. */
const NOT_COUNTED: LlmAttemptOutcome[] = ['QUOTA_IP', 'QUOTA_GLOBAL'];

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + DAY_MS);
}

const countedSince = (since: Date) => ({
  createdAt: { gte: since },
  outcome: { notIn: NOT_COUNTED },
});

export async function reserveAttempt(
  meta: AttemptMeta,
  limits: QuotaLimits,
  now: Date,
): Promise<QuotaDecision> {
  return prisma.$transaction(async (tx) => {
    // ::text because Prisma cannot deserialise the function's void result.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${QUOTA_LOCK_KEY})::text`;

    await tx.llmExtractionAttempt.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * DAY_MS) } },
    });

    const since = utcDayStart(now);
    const ipCount = await tx.llmExtractionAttempt.count({
      where: { ...countedSince(since), ipHash: meta.ipHash },
    });
    const globalCount = await tx.llmExtractionAttempt.count({ where: countedSince(since) });

    const rejected =
      ipCount >= limits.perIp ? 'ip' : globalCount >= limits.global ? 'global' : null;
    if (rejected !== null) {
      await tx.llmExtractionAttempt.create({
        data: { ...meta, createdAt: now, outcome: rejected === 'ip' ? 'QUOTA_IP' : 'QUOTA_GLOBAL' },
      });
      return { allowed: false, scope: rejected };
    }

    const row = await tx.llmExtractionAttempt.create({
      data: { ...meta, createdAt: now, outcome: 'PENDING' },
    });
    return {
      allowed: true,
      attemptId: row.id,
      remainingToday: Math.min(limits.perIp - ipCount - 1, limits.global - globalCount - 1),
    };
  });
}

export async function completeAttempt(
  id: string,
  outcome: LlmAttemptOutcome,
  details: AttemptDetails = {},
): Promise<void> {
  await prisma.llmExtractionAttempt.update({ where: { id }, data: { outcome, ...details } });
}

export async function remainingToday(
  ipHash: string,
  limits: QuotaLimits,
  now: Date,
): Promise<number> {
  const since = utcDayStart(now);
  const [ipCount, globalCount] = await Promise.all([
    prisma.llmExtractionAttempt.count({ where: { ...countedSince(since), ipHash } }),
    prisma.llmExtractionAttempt.count({ where: countedSince(since) }),
  ]);
  return Math.max(0, Math.min(limits.perIp - ipCount, limits.global - globalCount));
}
