import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Prisma, SupplierCategory } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../db/prisma.ts';
import { MAX_TIER } from '../domain/hierarchy.ts';
import { AppError } from '../http/errors.ts';

/**
 * Resolves to backend/data/ from both src/ and dist/, since the compiled tree keeps the
 * same depth.
 */
const ERP_EXPORT_PATH = path.join(
  import.meta.dirname,
  '..',
  '..',
  'data',
  'erp-supplier-export.json',
);

const erpRecordSchema = z.strictObject({
  externalId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
  category: z.enum(['RAW_MATERIAL', 'MANUFACTURING', 'LOGISTICS']),
  parentExternalId: z.string().trim().min(1).max(64).nullable(),
  contactEmail: z.email().nullable().optional(),
  active: z.boolean(),
});

type ErpRecord = z.infer<typeof erpRecordSchema>;

const erpFileSchema = z.object({
  source: z.string().min(1),
  exportedAt: z.string().min(1),
  note: z.string().optional(),
  // Deliberately unknown: each record is validated on its own so a single malformed
  // entry is rejected and reported rather than taking the whole batch down.
  records: z.array(z.unknown()),
});

export type RejectionReason =
  | 'MALFORMED_RECORD'
  | 'DUPLICATE_EXTERNAL_ID'
  | 'UNKNOWN_COUNTRY'
  | 'PARENT_NOT_FOUND'
  | 'MAX_DEPTH_EXCEEDED'
  | 'HIERARCHY_CYCLE';

export interface Rejection {
  externalId: string | null;
  reason: RejectionReason;
  detail: string;
}

interface ResolvedNode {
  externalId: string;
  id: string;
  parentId: string | null;
  tier: number;
  isNew: boolean;
  record: ErpRecord;
}

function extractExternalId(raw: unknown): string | null {
  if (typeof raw === 'object' && raw !== null && 'externalId' in raw) {
    const value = (raw as { externalId: unknown }).externalId;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/**
 * Turns the file into a set of nodes that can be written, plus a list of everything
 * that could not be.
 *
 * Nothing here touches the database beyond reading: the whole graph is resolved and
 * checked in memory first, so the transaction that follows either applies a known-good
 * batch or does nothing at all.
 */
function resolveGraph(
  records: readonly ErpRecord[],
  existing: ReadonlyMap<string, { id: string; parentSupplierId: string | null }>,
  existingParentById: ReadonlyMap<string, string | null>,
  knownCountries: ReadonlySet<string>,
): { nodes: ResolvedNode[]; rejections: Rejection[] } {
  const rejections: Rejection[] = [];

  // Country is checked first and independently: it needs no graph context, and a
  // record with an unscorable country could never be written anyway — the foreign key
  // to CountryRisk would refuse it.
  let candidates = records.filter((record) => {
    if (knownCountries.has(record.countryCode)) return true;
    rejections.push({
      externalId: record.externalId,
      reason: 'UNKNOWN_COUNTRY',
      detail: `Country ${record.countryCode} is not in the risk table, so this supplier could not be scored.`,
    });
    return false;
  });

  // Iterate: rejecting a record can orphan another that referenced it as a parent, so
  // the pass repeats until the surviving set is stable. Bounded by the record count.
  for (let pass = 0; pass <= records.length; pass += 1) {
    const idByExternalId = new Map<string, string>();
    for (const [externalId, supplier] of existing) idByExternalId.set(externalId, supplier.id);
    for (const record of candidates) {
      if (!idByExternalId.has(record.externalId)) {
        idByExternalId.set(record.externalId, randomUUID());
      }
    }

    const orphaned: Rejection[] = [];
    const resolvable = candidates.filter((record) => {
      if (record.parentExternalId === null) return true;
      if (idByExternalId.has(record.parentExternalId)) return true;
      orphaned.push({
        externalId: record.externalId,
        reason: 'PARENT_NOT_FOUND',
        detail: `Parent ${record.parentExternalId} exists neither in this export nor in the application.`,
      });
      return false;
    });

    if (orphaned.length > 0) {
      rejections.push(...orphaned);
      candidates = resolvable;
      continue;
    }

    // Final parent for every node that will exist after the sync: the feed's value
    // where it says something, the current value otherwise.
    const finalParent = new Map<string, string | null>(existingParentById);
    const incomingById = new Map<string, ErpRecord>();
    for (const record of candidates) {
      const id = idByExternalId.get(record.externalId) ?? randomUUID();
      const parentId =
        record.parentExternalId === null
          ? null
          : (idByExternalId.get(record.parentExternalId) ?? null);
      finalParent.set(id, parentId);
      incomingById.set(id, record);
    }

    const depths = new Map<string, number>();
    const bad = new Map<string, RejectionReason>();

    for (const id of finalParent.keys()) {
      const seen = new Set<string>();
      let cursor: string | null = id;
      let depth = 0;
      let failure: RejectionReason | null = null;

      while (cursor !== null) {
        if (seen.has(cursor)) {
          failure = 'HIERARCHY_CYCLE';
          break;
        }
        seen.add(cursor);
        const parent: string | null = finalParent.get(cursor) ?? null;
        if (parent === null) break;
        depth += 1;
        if (depth >= MAX_TIER) {
          const grandparent = finalParent.get(parent) ?? null;
          if (grandparent !== null) {
            failure = 'MAX_DEPTH_EXCEEDED';
            break;
          }
        }
        cursor = parent;
      }

      if (failure !== null) {
        // Blame whichever node in the chain the feed is actually changing.
        for (const member of seen) {
          if (incomingById.has(member)) bad.set(member, failure);
        }
        if (bad.size === 0 && incomingById.has(id)) bad.set(id, failure);
      } else {
        depths.set(id, depth);
      }
    }

    if (bad.size > 0) {
      const rejectedExternalIds = new Set<string>();
      for (const [id, reason] of bad) {
        const record = incomingById.get(id);
        if (record === undefined) continue;
        rejectedExternalIds.add(record.externalId);
        rejections.push({
          externalId: record.externalId,
          reason,
          detail:
            reason === 'HIERARCHY_CYCLE'
              ? 'Applying this record would close a loop in the supply chain.'
              : `Applying this record would push part of the chain past tier ${String(MAX_TIER)}.`,
        });
      }
      candidates = candidates.filter((record) => !rejectedExternalIds.has(record.externalId));
      continue;
    }

    const nodes: ResolvedNode[] = candidates.map((record) => {
      const id = idByExternalId.get(record.externalId) ?? randomUUID();
      return {
        externalId: record.externalId,
        id,
        parentId: finalParent.get(id) ?? null,
        tier: (depths.get(id) ?? 0) + 1,
        isNew: !existing.has(record.externalId),
        record,
      };
    });

    return { nodes, rejections };
  }

  return { nodes: [], rejections };
}

export interface SyncOutcome {
  logId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  recordsRead: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  recordsRejected: number;
  recordsNotInFeed: number;
  rejections: Rejection[];
}

function isSyncAlreadyRunning(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return (
    code === 'P2002' || (typeof message === 'string' && message.includes('erp_sync_single_running'))
  );
}

export async function runErpSync(filePath: string = ERP_EXPORT_PATH): Promise<SyncOutcome> {
  const raw = await readFile(filePath, 'utf8');
  const sourceFileHash = createHash('sha256').update(raw).digest('hex');
  const file = erpFileSchema.parse(JSON.parse(raw));

  /*
   * Claiming the lock and writing the log happen through `prisma`, never inside the
   * data transaction below. If the log were written transactionally, a failed sync
   * would roll back the only record that it ever ran — precisely the case where the
   * record matters. The RUNNING row doubles as the lock: a partial unique index permits
   * only one, so a second concurrent request is refused by the database rather than by
   * a read-then-write check that two callers can both pass.
   */
  let log;
  try {
    log = await prisma.erpSyncLog.create({
      data: { source: file.source, sourceFileHash, status: 'RUNNING' },
    });
  } catch (error) {
    if (isSyncAlreadyRunning(error)) {
      throw new AppError('SYNC_IN_PROGRESS', 'An ERP sync is already running.');
    }
    throw error;
  }

  /*
   * Only the data phase may produce a FAILED verdict. Once applyExport returns, the
   * batch is committed — and a later problem writing the summary must not report a sync
   * that succeeded as one that failed. Wrapping both in a single catch would do exactly
   * that, leaving a FAILED row next to fully applied data.
   */
  let outcome: SyncOutcome;
  try {
    outcome = await applyExport(file.records, log.id);
  } catch (error) {
    await prisma.erpSyncLog
      .update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errors: { message: error instanceof Error ? error.message : String(error) },
        },
      })
      .catch((loggingError: unknown) => {
        console.error('ERP sync failed and its log could not be updated', loggingError);
      });
    throw error;
  }

  // Built as a literal so it satisfies Prisma's JSON input type without a cast: the
  // Rejection interface has no index signature, which InputJsonObject requires.
  const errors: Prisma.InputJsonValue = {
    rejections: outcome.rejections.map((rejection) => ({
      externalId: rejection.externalId,
      reason: rejection.reason,
      detail: rejection.detail,
    })),
  };

  try {
    await prisma.erpSyncLog.update({
      where: { id: log.id },
      data: {
        status: outcome.status,
        finishedAt: new Date(),
        recordsRead: outcome.recordsRead,
        recordsCreated: outcome.recordsCreated,
        recordsUpdated: outcome.recordsUpdated,
        recordsUnchanged: outcome.recordsUnchanged,
        recordsRejected: outcome.recordsRejected,
        recordsNotInFeed: outcome.recordsNotInFeed,
        ...(outcome.rejections.length > 0 ? { errors } : {}),
      },
    });
  } catch (error) {
    // The data is already committed; the caller is told the truth about what was
    // applied even though this run's summary row is now incomplete.
    console.error('ERP sync applied but its log could not be finalised', error);

    // The RUNNING row doubles as the lock, so it has to be cleared whatever else went
    // wrong — a stuck row would leave the application permanently unable to sync again.
    await prisma.erpSyncLog
      .update({ where: { id: log.id }, data: { status: outcome.status, finishedAt: new Date() } })
      .catch((lockError: unknown) => {
        console.error('ERP sync lock could not be released', lockError);
      });
  }

  return outcome;
}

async function applyExport(rawRecords: readonly unknown[], logId: string): Promise<SyncOutcome> {
  const rejections: Rejection[] = [];
  const parsed: ErpRecord[] = [];
  const seenExternalIds = new Set<string>();

  for (const raw of rawRecords) {
    const result = erpRecordSchema.safeParse(raw);
    if (!result.success) {
      rejections.push({
        externalId: extractExternalId(raw),
        reason: 'MALFORMED_RECORD',
        detail: result.error.issues
          .map((issue) => `${issue.path.join('.') || '(record)'}: ${issue.message}`)
          .join('; '),
      });
      continue;
    }

    if (seenExternalIds.has(result.data.externalId)) {
      rejections.push({
        externalId: result.data.externalId,
        reason: 'DUPLICATE_EXTERNAL_ID',
        detail: 'The same externalId appears more than once in this export.',
      });
      continue;
    }

    seenExternalIds.add(result.data.externalId);
    parsed.push(result.data);
  }

  const [existingSuppliers, countries] = await Promise.all([
    prisma.supplier.findMany({
      select: {
        id: true,
        externalId: true,
        name: true,
        countryCode: true,
        category: true,
        contactEmail: true,
        isActive: true,
        parentSupplierId: true,
      },
    }),
    prisma.countryRisk.findMany({ select: { code: true } }),
  ]);

  const byExternalId = new Map(
    existingSuppliers
      .filter(
        (supplier): supplier is typeof supplier & { externalId: string } =>
          supplier.externalId !== null,
      )
      .map((supplier) => [supplier.externalId, supplier]),
  );
  const parentById = new Map(
    existingSuppliers.map((supplier) => [supplier.id, supplier.parentSupplierId]),
  );

  const { nodes, rejections: graphRejections } = resolveGraph(
    parsed,
    byExternalId,
    parentById,
    new Set(countries.map((country) => country.code)),
  );
  rejections.push(...graphRejections);

  // Field-level comparison decides created / updated / unchanged. lastSyncedAt is
  // excluded on purpose: it describes the sync, not the supplier, and comparing it
  // would make every record look changed on every run.
  const created: ResolvedNode[] = [];
  const updated: ResolvedNode[] = [];
  const unchanged: ResolvedNode[] = [];

  for (const node of nodes) {
    if (node.isNew) {
      created.push(node);
      continue;
    }
    const current = byExternalId.get(node.externalId);
    const differs =
      current === undefined ||
      current.name !== node.record.name ||
      current.countryCode !== node.record.countryCode ||
      current.category !== node.record.category ||
      (current.contactEmail ?? null) !== (node.record.contactEmail ?? null) ||
      current.isActive !== node.record.active ||
      current.parentSupplierId !== node.parentId;

    (differs ? updated : unchanged).push(node);
  }

  const inFeed = new Set(nodes.map((node) => node.externalId));
  const notInFeed = existingSuppliers.filter(
    (supplier) => supplier.externalId !== null && !inFeed.has(supplier.externalId),
  ).length;

  /*
   * One transaction for the whole batch. Records are written parent-before-child, which
   * is what makes a forward reference — a record naming a parent that appears later in
   * the file — work: the graph was resolved in memory first, so write order follows the
   * hierarchy rather than the file.
   */
  const syncedAt = new Date();
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ordered = [...nodes].sort((a, b) => a.tier - b.tier);

    for (const node of ordered) {
      const data = {
        externalId: node.externalId,
        name: node.record.name,
        countryCode: node.record.countryCode,
        category: node.record.category as SupplierCategory,
        contactEmail: node.record.contactEmail ?? null,
        isActive: node.record.active,
        parentSupplierId: node.parentId,
        tier: node.tier,
        sourceSystem: 'ERP' as const,
        lastSyncedAt: syncedAt,
      };

      await tx.supplier.upsert({
        where: { externalId: node.externalId },
        create: { id: node.id, ...data },
        update: data,
      });
    }
  });

  return {
    logId,
    status: rejections.length > 0 ? 'PARTIAL' : 'SUCCESS',
    recordsRead: rawRecords.length,
    recordsCreated: created.length,
    recordsUpdated: updated.length,
    recordsUnchanged: unchanged.length,
    recordsRejected: rejections.length,
    recordsNotInFeed: notInFeed,
    rejections,
  };
}

export async function listSyncLogs(limit: number) {
  return prisma.erpSyncLog.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
}
