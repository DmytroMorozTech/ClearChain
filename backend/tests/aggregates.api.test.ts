import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { COMPANY_NAME, COMPANY_NODE_ID } from '../src/config/company.ts';
import { DASHBOARD_EXPIRY_WINDOW_DAYS } from '../src/config/thresholds.ts';
import { disconnect, resetDatabase, resetUploads, seedCountries } from './helpers/db.ts';

let app: Express;

beforeAll(async () => {
  app = createApp();
  await seedCountries();
});

beforeEach(async () => {
  await resetDatabase();
  await resetUploads();
});

afterAll(async () => {
  await resetUploads();
  await disconnect();
});

const PDF = Buffer.from('%PDF-1.7\ndemo\n%%EOF');

async function makeSupplier(
  name: string,
  countryCode: string,
  category: string,
  parentSupplierId?: string,
): Promise<string> {
  const response = await request(app)
    .post('/api/suppliers')
    .send({
      name,
      countryCode,
      category,
      ...(parentSupplierId ? { parentSupplierId } : {}),
    });
  return response.body.id as string;
}

async function addCertificate(
  supplierId: string,
  type: string,
  issueDate: string,
  expiryDate: string,
): Promise<void> {
  await request(app)
    .post(`/api/suppliers/${supplierId}/certificates`)
    .field('type', type)
    .field('issueDate', issueDate)
    .field('expiryDate', expiryDate)
    .attach('file', PDF, { filename: `${type}.pdf`, contentType: 'application/pdf' });
}

function isoDaysFromNow(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * A three-level chain plus one independent root, so every aggregate below can be
 * checked by counting rather than by trusting the implementation.
 */
async function buildChain() {
  const a = await makeSupplier('Alpha Werke', 'DE', 'MANUFACTURING');
  const b = await makeSupplier('Beta Dokuma', 'TR', 'MANUFACTURING', a);
  const c = await makeSupplier('Gamma Cotton', 'BD', 'RAW_MATERIAL', b);
  const d = await makeSupplier('Delta Logistik', 'DE', 'LOGISTICS');

  // Alpha: fully compliant.
  for (const type of ['SA8000', 'OEKO_TEX', 'ISO_14001']) {
    await addCertificate(a, type, '2026-01-01', isoDaysFromNow(400));
  }
  // Delta: one valid, one expiring inside the dashboard window.
  await addCertificate(d, 'ISO_14001', '2026-01-01', isoDaysFromNow(400));
  await addCertificate(d, 'CBAM', '2026-01-01', isoDaysFromNow(10));
  // Beta: one expired.
  await addCertificate(b, 'SA8000', '2020-01-01', isoDaysFromNow(-30));
  // Gamma: nothing at all.

  return { a, b, c, d };
}

describe('GET /api/dashboard', () => {
  it('is empty but well-formed with no data', async () => {
    const response = await request(app).get('/api/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.company.name).toBe(COMPANY_NAME);
    expect(response.body.suppliers.total).toBe(0);
    expect(response.body.suppliers.compliantPercentage).toBe(0);
    expect(response.body.lastSync).toBeNull();
  });

  it('reports figures that reconcile with the rows behind them', async () => {
    await buildChain();

    const response = await request(app).get('/api/dashboard');
    const { suppliers, certificates } = response.body;

    expect(suppliers.total).toBe(4);
    // Alpha and Delta hold every certificate their category requires; Beta has one
    // expired and Gamma has none.
    expect(suppliers.compliant).toBe(2);
    expect(suppliers.compliantPercentage).toBe(50);

    // The counts must add up to the total — a distribution that loses rows is worse
    // than no distribution.
    const riskTotal = suppliers.byRiskLevel.reduce(
      (sum: number, entry: { count: number }) => sum + entry.count,
      0,
    );
    expect(riskTotal).toBe(4);
    expect(suppliers.byRiskLevel.map((e: { level: string }) => e.level)).toEqual([
      'GREEN',
      'YELLOW',
      'RED',
    ]);

    expect(suppliers.byTier).toEqual([
      { tier: 1, count: 2 },
      { tier: 2, count: 1 },
      { tier: 3, count: 1 },
    ]);

    expect(certificates.total).toBe(6);
    expect(certificates.expired).toBe(1);
    expect(certificates.expiringSoon).toBe(1);
    expect(certificates.expiryWindowDays).toBe(DASHBOARD_EXPIRY_WINDOW_DAYS);
  });

  // The 30-day dashboard window is deliberately narrower than the 60-day status
  // threshold; a certificate between the two is EXPIRING_SOON but not on the tile.
  it('counts only the dashboard window, not everything the status calls expiring', async () => {
    const supplier = await makeSupplier('Window Test', 'DE', 'LOGISTICS');
    await addCertificate(supplier, 'ISO_14001', '2026-01-01', isoDaysFromNow(45));

    const dashboard = await request(app).get('/api/dashboard');
    expect(dashboard.body.certificates.expiringSoon).toBe(0);

    const certificates = await request(app).get('/api/certificates?status=EXPIRING_SOON');
    expect(certificates.body.total).toBe(1);
  });

  it('does not count the company itself as a supplier', async () => {
    await buildChain();

    const dashboard = await request(app).get('/api/dashboard');
    const suppliers = await request(app).get('/api/suppliers?pageSize=100');

    expect(dashboard.body.suppliers.total).toBe(suppliers.body.total);
  });
});

describe('GET /api/chain', () => {
  it('returns an empty graph with only the company when there are no suppliers', async () => {
    const response = await request(app).get('/api/chain');

    expect(response.status).toBe(200);
    expect(response.body.nodes).toHaveLength(1);
    expect(response.body.nodes[0]).toMatchObject({ id: COMPANY_NODE_ID, type: 'company', tier: 0 });
    expect(response.body.edges).toHaveLength(0);
  });

  // §19 Phase 6: node count equals supplier count plus the synthetic root.
  it('emits one node per supplier plus the company root', async () => {
    await buildChain();

    const response = await request(app).get('/api/chain');
    const suppliers = await request(app).get('/api/suppliers?pageSize=100');

    expect(response.body.nodes).toHaveLength(suppliers.body.total + 1);
    expect(response.body.nodes.filter((n: { type: string }) => n.type === 'company')).toHaveLength(
      1,
    );
  });

  it('gives every supplier exactly one incoming edge, so nothing is orphaned', async () => {
    const { a, b, c, d } = await buildChain();

    const response = await request(app).get('/api/chain');
    const edges: Array<{ source: string; target: string }> = response.body.edges;

    expect(edges).toHaveLength(4);

    const incoming = new Map(edges.map((edge) => [edge.target, edge.source]));
    expect(incoming.get(a)).toBe(COMPANY_NODE_ID);
    expect(incoming.get(d)).toBe(COMPANY_NODE_ID);
    expect(incoming.get(b)).toBe(a);
    expect(incoming.get(c)).toBe(b);
  });

  it('every edge endpoint resolves to a node', async () => {
    await buildChain();

    const response = await request(app).get('/api/chain');
    const ids = new Set(response.body.nodes.map((node: { id: string }) => node.id));

    for (const edge of response.body.edges as Array<{ source: string; target: string }>) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it('carries the risk band each node should be coloured by', async () => {
    const { c } = await buildChain();

    const response = await request(app).get('/api/chain');
    const gamma = response.body.nodes.find((node: { id: string }) => node.id === c);

    // Bangladesh (40) + no certificates (40) + tier 3 (10) = 90.
    expect(gamma.riskScore).toBe(90);
    expect(gamma.riskLevel).toBe('RED');
    expect(gamma.isCompliant).toBe(false);
  });

  it('leaves the company node without risk, because it is not a supplier', async () => {
    await buildChain();

    const response = await request(app).get('/api/chain');
    const company = response.body.nodes.find((node: { type: string }) => node.type === 'company');

    expect(company.riskLevel).toBeNull();
    expect(company.isCompliant).toBeNull();
  });
});

describe('reference data', () => {
  it('exposes the country risk table that feeds the score', async () => {
    const response = await request(app).get('/api/reference/countries');

    expect(response.status).toBe(200);
    const germany = response.body.data.find((c: { code: string }) => c.code === 'DE');
    expect(germany).toMatchObject({ band: 'LOW', baseScore: 5 });
  });

  it('states which categories require each certificate type', async () => {
    const response = await request(app).get('/api/reference/certificate-types');
    const byType = new Map(
      response.body.data.map((entry: { type: string; requiredFor: string[] }) => [
        entry.type,
        entry.requiredFor,
      ]),
    );

    expect(byType.get('ISO_14001')).toEqual(['RAW_MATERIAL', 'MANUFACTURING', 'LOGISTICS']);
    expect(byType.get('SA8000')).toEqual(['MANUFACTURING']);
    // Company-level reporting obligations, required of no supplier.
    expect(byType.get('CSRD')).toEqual([]);
    expect(byType.get('LKSG')).toEqual([]);
  });
});
