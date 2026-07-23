import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { disconnect, resetDatabase, seedCountries } from './helpers/db.js';

let app: Express;

beforeAll(async () => {
  app = createApp();
  await seedCountries();
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

interface SupplierBody {
  name: string;
  countryCode: string;
  category: 'RAW_MATERIAL' | 'MANUFACTURING' | 'LOGISTICS';
  parentSupplierId?: string | null;
  [key: string]: unknown;
}

async function createSupplier(body: SupplierBody) {
  return request(app).post('/api/suppliers').send(body);
}

async function createChain(): Promise<{ a: string; b: string; c: string; d: string }> {
  const a = await createSupplier({ name: 'A', countryCode: 'DE', category: 'MANUFACTURING' });
  const b = await createSupplier({
    name: 'B',
    countryCode: 'TR',
    category: 'MANUFACTURING',
    parentSupplierId: a.body.id as string,
  });
  const c = await createSupplier({
    name: 'C',
    countryCode: 'BD',
    category: 'RAW_MATERIAL',
    parentSupplierId: b.body.id as string,
  });
  const d = await createSupplier({ name: 'D', countryCode: 'DE', category: 'LOGISTICS' });

  return {
    a: a.body.id as string,
    b: b.body.id as string,
    c: c.body.id as string,
    d: d.body.id as string,
  };
}

describe('GET /api/health', () => {
  it('reports the database as reachable', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', db: 'up' });
  });
});

describe('POST /api/suppliers — tier is derived, never supplied', () => {
  it('assigns tier 1 to a supplier with no parent', async () => {
    const response = await createSupplier({
      name: 'Root Co',
      countryCode: 'DE',
      category: 'MANUFACTURING',
    });

    expect(response.status).toBe(201);
    expect(response.body.tier).toBe(1);
    expect(response.body.parentSupplierId).toBeNull();
  });

  it('derives tier from the parent chain', async () => {
    const { b, c } = await createChain();

    const bDetail = await request(app).get(`/api/suppliers/${b}`);
    const cDetail = await request(app).get(`/api/suppliers/${c}`);

    expect(bDetail.body.tier).toBe(2);
    expect(cDetail.body.tier).toBe(3);
  });

  // §18 test 7. strictObject rejects the unknown key rather than ignoring it, so a
  // client cannot quietly disagree with the system about what tier something is.
  it('rejects a client-supplied tier with 400', async () => {
    const response = await createSupplier({
      name: 'Sneaky',
      countryCode: 'DE',
      category: 'MANUFACTURING',
      tier: 3,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.some((d: { path: string }) => d.path === 'tier')).toBe(true);
  });

  it('refuses to create a fourth tier', async () => {
    const { c } = await createChain();

    const response = await createSupplier({
      name: 'Too deep',
      countryCode: 'DE',
      category: 'RAW_MATERIAL',
      parentSupplierId: c,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('MAX_DEPTH_EXCEEDED');
  });

  it('rejects a parent that does not exist', async () => {
    const response = await createSupplier({
      name: 'Orphan',
      countryCode: 'DE',
      category: 'LOGISTICS',
      parentSupplierId: '00000000-0000-4000-8000-000000000000',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PARENT_NOT_FOUND');
  });

  it('validates the request body', async () => {
    const response = await request(app)
      .post('/api/suppliers')
      .send({ name: '', countryCode: 'DEU', category: 'NOPE' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThanOrEqual(3);
  });
});

describe('PATCH /api/suppliers/:id — hierarchy invariants', () => {
  // §18 test 2. A foreign key cannot express this: a cycle is a property of the graph,
  // invisible from any single row.
  it('rejects a move that would create a cycle with 409', async () => {
    const { a, c } = await createChain();

    const response = await request(app).patch(`/api/suppliers/${a}`).send({ parentSupplierId: c });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('HIERARCHY_CYCLE');
  });

  it('rejects self-parenting', async () => {
    const { b } = await createChain();

    const response = await request(app).patch(`/api/suppliers/${b}`).send({ parentSupplierId: b });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  // §18 test 3. The subtle case: a single-field edit that says nothing about C, yet
  // would push C to tier 4.
  it('rejects a move that would push a grandchild past tier 3', async () => {
    const { a, d } = await createChain();

    const response = await request(app).patch(`/api/suppliers/${a}`).send({ parentSupplierId: d });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('MAX_DEPTH_EXCEEDED');
  });

  it('renumbers the whole subtree when a legal move changes depth', async () => {
    const { b, c, d } = await createChain();

    const response = await request(app).patch(`/api/suppliers/${b}`).send({ parentSupplierId: d });
    expect(response.status).toBe(200);
    expect(response.body.tier).toBe(2);

    // C was never mentioned in the request but must have been renumbered with it.
    const cDetail = await request(app).get(`/api/suppliers/${c}`);
    expect(cDetail.body.tier).toBe(3);
    expect(cDetail.body.parentSupplierId).toBe(b);
  });

  it('promotes a subtree to the root and renumbers downward', async () => {
    const { b, c } = await createChain();

    const response = await request(app)
      .patch(`/api/suppliers/${b}`)
      .send({ parentSupplierId: null });

    expect(response.status).toBe(200);
    expect(response.body.tier).toBe(1);
    expect(response.body.parentSupplierId).toBeNull();

    const cDetail = await request(app).get(`/api/suppliers/${c}`);
    expect(cDetail.body.tier).toBe(2);
  });

  it('leaves the hierarchy untouched when a rejected move fails', async () => {
    const { a, c, d } = await createChain();

    await request(app).patch(`/api/suppliers/${a}`).send({ parentSupplierId: d });

    // The transaction rolled back: A is still a root and C is still at tier 3.
    const aDetail = await request(app).get(`/api/suppliers/${a}`);
    const cDetail = await request(app).get(`/api/suppliers/${c}`);

    expect(aDetail.body.parentSupplierId).toBeNull();
    expect(aDetail.body.tier).toBe(1);
    expect(cDetail.body.tier).toBe(3);
  });

  it('updates scalar fields without touching the hierarchy', async () => {
    const { b } = await createChain();

    const response = await request(app)
      .patch(`/api/suppliers/${b}`)
      .send({ name: 'B renamed', contactEmail: 'compliance@example.com' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('B renamed');
    expect(response.body.tier).toBe(2);
  });
});

describe('DELETE /api/suppliers/:id', () => {
  // §18 test 6. A silent cascade would remove an entire upstream branch on one misclick.
  it('refuses to delete a supplier that still has children', async () => {
    const { b } = await createChain();

    const response = await request(app).delete(`/api/suppliers/${b}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SUPPLIER_HAS_CHILDREN');
    expect(response.body.error.message).toContain('1');
  });

  it('deletes a leaf', async () => {
    const { c } = await createChain();

    expect((await request(app).delete(`/api/suppliers/${c}`)).status).toBe(204);
    expect((await request(app).get(`/api/suppliers/${c}`)).status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await request(app).delete(
      '/api/suppliers/00000000-0000-4000-8000-000000000000',
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/suppliers', () => {
  it('paginates and reports the unpaginated total', async () => {
    await createChain();

    const response = await request(app).get('/api/suppliers?page=1&pageSize=2');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.total).toBe(4);
    expect(response.body.page).toBe(1);
  });

  it('filters by tier', async () => {
    await createChain();

    const response = await request(app).get('/api/suppliers?tier=1');

    expect(response.body.total).toBe(2); // A and D
    expect(response.body.data.every((s: { tier: number }) => s.tier === 1)).toBe(true);
  });

  it('filters by derived risk level', async () => {
    await createChain();

    const response = await request(app).get('/api/suppliers?riskLevel=RED');

    expect(response.body.data.every((s: { riskLevel: string }) => s.riskLevel === 'RED')).toBe(
      true,
    );
  });

  it('searches by name', async () => {
    await createChain();

    const response = await request(app).get('/api/suppliers?search=b');

    expect(response.body.total).toBe(1);
    expect(response.body.data[0].name).toBe('B');
  });

  it('rejects an unsupported sort key', async () => {
    const response = await request(app).get('/api/suppliers?sort=secret:asc');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/suppliers/:id/risk — explainability', () => {
  it('returns the factor breakdown, not just a colour', async () => {
    const { c } = await createChain();

    const response = await request(app).get(`/api/suppliers/${c}/risk`);

    expect(response.status).toBe(200);
    expect(response.body.factors.map((f: { code: string }) => f.code)).toEqual([
      'COUNTRY',
      'CERTIFICATES',
      'TIER_DEPTH',
      'UPSTREAM',
    ]);

    // C: Bangladesh (40) + no certificates (40) + tier 3 (10) + no children (0).
    expect(response.body.score).toBe(90);
    expect(response.body.level).toBe('RED');
  });

  it('rolls damped upstream risk into the parent', async () => {
    const { a } = await createChain();

    const response = await request(app).get(`/api/suppliers/${a}/risk`);

    const upstream = response.body.factors.find((f: { code: string }) => f.code === 'UPSTREAM');
    expect(upstream.points).toBeGreaterThan(0);
  });
});

describe('error envelope', () => {
  it('uses one shape for every failure', async () => {
    const response = await request(app).get('/api/suppliers/not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error.code');
    expect(response.body).toHaveProperty('error.message');
  });

  it('returns 404 for an unmatched route', async () => {
    const response = await request(app).get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
