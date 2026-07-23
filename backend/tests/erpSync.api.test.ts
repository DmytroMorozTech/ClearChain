import path from 'node:path';

import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { type ApiAgent, signIn } from './helpers/auth.ts';
import { prisma } from '../src/db/prisma.ts';
import { runErpSync } from '../src/services/erpSyncService.ts';
import {
  disconnect,
  resetDatabase,
  seedCountries,
  seedSuppliersFromFixtures,
} from './helpers/db.ts';

/**
 * An export whose supplier name carries a NUL character. It passes shape validation and
 * every graph check, then PostgreSQL refuses it (22021, invalid byte sequence). Using a
 * real database failure rather than a mocked one means this exercises the same code path
 * a genuine bad feed would.
 */
const FAILING_EXPORT = path.join(import.meta.dirname, 'fixtures', 'erp-export-null-byte.json');

let app: Express;
let api: ApiAgent;

beforeAll(async () => {
  app = createApp();
  api = await signIn(app);
  await seedCountries();
  // The export references countries beyond the three the other suites need.
  await prisma.countryRisk.createMany({
    data: [
      { code: 'IT', name: 'Italy', band: 'LOW', baseScore: 5 },
      { code: 'PT', name: 'Portugal', band: 'LOW', baseScore: 5 },
      { code: 'GB', name: 'United Kingdom', band: 'LOW', baseScore: 5 },
      { code: 'PL', name: 'Poland', band: 'MEDIUM', baseScore: 20 },
      { code: 'CN', name: 'China', band: 'MEDIUM', baseScore: 20 },
      { code: 'VN', name: 'Vietnam', band: 'MEDIUM', baseScore: 20 },
      { code: 'IN', name: 'India', band: 'MEDIUM', baseScore: 20 },
      { code: 'MA', name: 'Morocco', band: 'MEDIUM', baseScore: 20 },
      { code: 'TN', name: 'Tunisia', band: 'MEDIUM', baseScore: 20 },
      { code: 'PK', name: 'Pakistan', band: 'HIGH', baseScore: 40 },
      { code: 'KH', name: 'Cambodia', band: 'HIGH', baseScore: 40 },
      { code: 'ET', name: 'Ethiopia', band: 'HIGH', baseScore: 40 },
    ],
    skipDuplicates: true,
  });
});

beforeEach(async () => {
  await resetDatabase();
  await seedSuppliersFromFixtures();
});

afterAll(async () => {
  await disconnect();
});

const sync = () => api.post('/api/erp/sync');

describe('POST /api/erp/sync — first run', () => {
  it('exercises create, update, no-op and reject in one pass', async () => {
    const response = await sync();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'PARTIAL',
      recordsRead: 34,
      recordsCreated: 4,
      recordsUpdated: 4,
      recordsUnchanged: 24,
      recordsRejected: 2,
    });
  });

  it('rejects the two bad records with reasons, and applies everything else', async () => {
    const response = await sync();

    const reasons = new Map(
      (response.body.rejections as Array<{ externalId: string; reason: string }>).map((r) => [
        r.externalId,
        r.reason,
      ]),
    );

    expect(reasons.get('SUP-9001')).toBe('UNKNOWN_COUNTRY');
    expect(reasons.get('SUP-9002')).toBe('PARENT_NOT_FOUND');

    // A rejected record must leave nothing behind.
    expect(await prisma.supplier.count({ where: { externalId: 'SUP-9001' } })).toBe(0);
    expect(await prisma.supplier.count({ where: { externalId: 'SUP-9002' } })).toBe(0);

    // ...and must not have stopped the valid ones.
    expect(await prisma.supplier.count({ where: { externalId: 'SUP-1009' } })).toBe(1);
  });

  /**
   * The record for SUP-3013 sits at index 0 of the export and names SUP-2015 as its
   * parent, which appears at index 33. A single-pass importer would drop or misorder
   * that relationship.
   */
  it('resolves a parent that appears later in the file', async () => {
    await sync();

    const child = await prisma.supplier.findUnique({ where: { externalId: 'SUP-3013' } });
    const parent = await prisma.supplier.findUnique({ where: { externalId: 'SUP-2015' } });

    expect(child).not.toBeNull();
    expect(parent).not.toBeNull();
    expect(child?.parentSupplierId).toBe(parent?.id);

    // Tier follows from the resolved position, not from the file.
    expect(parent?.tier).toBe(2);
    expect(child?.tier).toBe(3);
  });

  it('applies the field changes the ERP is authoritative for', async () => {
    await sync();

    const hansen = await prisma.supplier.findUnique({ where: { externalId: 'SUP-1001' } });
    const relocated = await prisma.supplier.findUnique({ where: { externalId: 'SUP-2013' } });

    expect(hansen?.contactEmail).toBe('supplier.compliance@hansen-textilwerk.example');
    // Phnom Penh relocated from Cambodia to Vietnam, which visibly moves its risk.
    expect(relocated?.countryCode).toBe('VN');
  });

  it('never deletes suppliers the feed omits, and says how many it left alone', async () => {
    const before = await prisma.supplier.count();
    const response = await sync();

    expect(response.body.recordsNotInFeed).toBe(6);
    // 34 seeded + 4 created, nothing removed.
    expect(await prisma.supplier.count()).toBe(before + 4);
    expect(await prisma.supplier.count({ where: { externalId: 'SUP-3012' } })).toBe(1);
  });

  it('leaves manually-created suppliers alone entirely', async () => {
    const manual = await prisma.supplier.create({
      data: {
        name: 'Hand-entered Supplier',
        countryCode: 'DE',
        category: 'LOGISTICS',
        tier: 1,
        sourceSystem: 'MANUAL',
      },
    });

    await sync();

    const after = await prisma.supplier.findUnique({ where: { id: manual.id } });
    expect(after?.sourceSystem).toBe('MANUAL');
    expect(after?.lastSyncedAt).toBeNull();
    expect(after?.name).toBe('Hand-entered Supplier');
  });

  it('records the source file hash on the log', async () => {
    await sync();

    const log = await prisma.erpSyncLog.findFirst({ orderBy: { startedAt: 'desc' } });
    expect(log?.sourceFileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(log?.source).toBe('mock-erp-v1');
    expect(log?.finishedAt).not.toBeNull();
  });
});

/**
 * §18 test 1, and the first thing anyone will try on the demo: press the button twice.
 */
describe('POST /api/erp/sync — idempotency', () => {
  it('reports zero created and zero updated on an unchanged second run', async () => {
    const first = await sync();
    expect(first.body.recordsCreated).toBe(4);
    expect(first.body.recordsUpdated).toBe(4);

    const second = await sync();

    expect(second.body.recordsCreated).toBe(0);
    expect(second.body.recordsUpdated).toBe(0);
    expect(second.body.recordsUnchanged).toBe(32);
    expect(second.body.recordsRejected).toBe(2);
  });

  it('leaves the supplier count unchanged across repeated runs', async () => {
    await sync();
    const afterFirst = await prisma.supplier.count();

    await sync();
    await sync();

    expect(await prisma.supplier.count()).toBe(afterFirst);
  });

  it('produces the same file hash every time, which is what makes the no-op visible', async () => {
    await sync();
    await sync();

    const logs = await prisma.erpSyncLog.findMany({ orderBy: { startedAt: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs[0]?.sourceFileHash).toBe(logs[1]?.sourceFileHash);
  });
});

describe('POST /api/erp/sync — failure handling', () => {
  /**
   * The log row is written outside the data transaction precisely so this case leaves
   * evidence. Written inside, a rollback would erase the only record that the sync ever
   * ran — exactly when someone needs it.
   */
  it('still records a FAILED log when the batch transaction blows up', async () => {
    await expect(runErpSync(FAILING_EXPORT)).rejects.toThrow();

    const log = await prisma.erpSyncLog.findFirst({ orderBy: { startedAt: 'desc' } });
    expect(log?.status).toBe('FAILED');
    expect(log?.finishedAt).not.toBeNull();
    // The evidence survives the rollback, which is the entire reason the log is written
    // outside the data transaction.
    expect(JSON.stringify(log?.errors)).toContain('22021');
  });

  it('applies nothing when the batch fails', async () => {
    const before = await prisma.supplier.count();

    await expect(runErpSync(FAILING_EXPORT)).rejects.toThrow();

    expect(await prisma.supplier.count()).toBe(before);
    expect(await prisma.supplier.count({ where: { externalId: 'SUP-8001' } })).toBe(0);
  });

  it('does not leave the lock held after a failure', async () => {
    await expect(runErpSync(FAILING_EXPORT)).rejects.toThrow();

    // A stuck RUNNING row would leave the app permanently unable to sync again.
    expect(await prisma.erpSyncLog.count({ where: { status: 'RUNNING' } })).toBe(0);

    const recovered = await sync();
    expect(recovered.status).toBe(200);
    expect(recovered.body.recordsCreated).toBe(4);
  });
});

describe('POST /api/erp/sync — concurrency', () => {
  it('refuses a second sync while one is already running', async () => {
    await prisma.erpSyncLog.create({ data: { source: 'mock-erp-v1', status: 'RUNNING' } });

    const response = await sync();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SYNC_IN_PROGRESS');
  });

  it('lets exactly one of two simultaneous requests through', async () => {
    const [a, b] = await Promise.all([sync(), sync()]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);

    // Whichever won, the data must be applied exactly once.
    expect(await prisma.supplier.count({ where: { externalId: 'SUP-1009' } })).toBe(1);
  });

  it('permits many finished runs, so the guard is not too broad', async () => {
    await sync();
    await sync();
    await sync();

    expect(await prisma.erpSyncLog.count()).toBe(3);
    expect(await prisma.erpSyncLog.count({ where: { status: 'RUNNING' } })).toBe(0);
  });
});

describe('GET /api/erp/sync-logs', () => {
  it('returns runs newest first', async () => {
    await sync();
    await sync();

    const response = await api.get('/api/erp/sync-logs?limit=5');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);

    const [newest, oldest] = response.body.data;
    expect(new Date(newest.startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(oldest.startedAt).getTime(),
    );
    expect(newest.recordsCreated).toBe(0);
    expect(oldest.recordsCreated).toBe(4);
  });

  it('surfaces the last sync on the dashboard', async () => {
    await sync();

    const dashboard = await api.get('/api/dashboard');

    expect(dashboard.body.lastSync).not.toBeNull();
    expect(dashboard.body.lastSync.status).toBe('PARTIAL');
    expect(dashboard.body.lastSync.recordsCreated).toBe(4);
  });
});
