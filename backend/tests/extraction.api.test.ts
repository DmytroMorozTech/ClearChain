import { readdir } from 'node:fs/promises';

import type { Express } from 'express';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildCertificatePdf } from '../prisma/seed/pdf.ts';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db/prisma.ts';
import { type LlmClient, LlmError, type LlmResult } from '../src/llm/client.ts';
import { type ApiAgent, signIn } from './helpers/auth.ts';
import {
  disconnect,
  resetDatabase,
  resetUploads,
  seedCountries,
  uploadRoot,
} from './helpers/db.ts';

const PDF = buildCertificatePdf('ISO 14001 Certificate', [
  'Issued by TUV Nord CERT GmbH',
  'Certificate No. Z-2025-0042',
  'Valid until 2028-02-28',
]);

const OUTPUT = {
  isCertificate: true,
  type: 'ISO_14001',
  issuer: 'TUV Nord CERT GmbH',
  certificateNumber: 'Z-2025-0042',
  issueDate: null,
  expiryDate: '2028-02-28',
  evidence: {
    type: 'ISO 14001 Certificate',
    issuer: 'Issued by TUV Nord CERT GmbH',
    certificateNumber: 'Certificate No. Z-2025-0042',
    issueDate: null,
    expiryDate: 'Valid until 2028-02-28',
  },
};

/** Stands in for the model provider: no key, no network, and it counts its calls. */
class FakeClient implements LlmClient {
  readonly model = 'fake-model';
  calls = 0;
  next: LlmResult | Error = {
    output: OUTPUT,
    model: 'fake-model',
    usage: { inputTokens: 100, outputTokens: 20 },
  };

  extract(): Promise<LlmResult> {
    this.calls += 1;
    return this.next instanceof Error ? Promise.reject(this.next) : Promise.resolve(this.next);
  }
}

let fake: FakeClient;
let app: Express;
let api: ApiAgent;

beforeAll(async () => {
  await seedCountries();
});

beforeEach(async () => {
  await resetDatabase();
  await resetUploads();
  fake = new FakeClient();
  app = createApp({ llmClient: fake });
  api = await signIn(app);
});

afterAll(async () => {
  await resetUploads();
  await disconnect();
});

async function makeSupplier(agent: ApiAgent = api): Promise<string> {
  const response = await agent
    .post('/api/suppliers')
    .send({ name: 'Acme Textiles', countryCode: 'DE', category: 'MANUFACTURING' });
  return response.body.id as string;
}

function extract(
  supplierId: string,
  options: { ip?: string; file?: Buffer; name?: string; type?: string } = {},
) {
  return api
    .post(`/api/suppliers/${supplierId}/certificates/extract`)
    .set('X-Forwarded-For', options.ip ?? '198.51.100.7')
    .attach('file', options.file ?? PDF, {
      filename: options.name ?? 'cert.pdf',
      contentType: options.type ?? 'application/pdf',
    });
}

describe('POST /api/suppliers/:id/certificates/extract', () => {
  it('requires a session', async () => {
    const response = await request(app).post(
      '/api/suppliers/00000000-0000-4000-8000-000000000000/certificates/extract',
    );
    expect(response.status).toBe(401);
  });

  it('answers 503 when no model is configured', async () => {
    const disabled = createApp({ llmClient: null });
    const agent = await signIn(disabled);
    const supplierId = await makeSupplier(agent);
    const response = await agent
      .post(`/api/suppliers/${supplierId}/certificates/extract`)
      .attach('file', PDF, { filename: 'cert.pdf', contentType: 'application/pdf' });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('EXTRACTION_DISABLED');
  });

  it('requires a file', async () => {
    const supplierId = await makeSupplier();
    const response = await api.post(`/api/suppliers/${supplierId}/certificates/extract`);
    expect(response.status).toBe(400);
    expect(fake.calls).toBe(0);
  });

  it('rejects a file that is not PDF, PNG or JPEG', async () => {
    const supplierId = await makeSupplier();
    const response = await extract(supplierId, {
      file: Buffer.from('hello'),
      name: 'a.txt',
      type: 'text/plain',
    });
    expect(response.status).toBe(415);
    expect(fake.calls).toBe(0);
  });

  it('answers 404 for an unknown supplier without calling the model', async () => {
    const response = await extract('00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(fake.calls).toBe(0);
  });

  it('rejects an unreadable PDF', async () => {
    const supplierId = await makeSupplier();
    const response = await extract(supplierId, {
      file: Buffer.from('%PDF-1.7\nfake certificate body\n%%EOF'),
    });
    expect(response.status).toBe(400);
    expect(fake.calls).toBe(0);
  });

  it('rejects a PDF with too many pages', async () => {
    const supplierId = await makeSupplier();
    const doc = await PDFDocument.create();
    for (let page = 0; page < 6; page += 1) doc.addPage();
    const response = await extract(supplierId, { file: Buffer.from(await doc.save()) });
    expect(response.status).toBe(400);
    expect(fake.calls).toBe(0);
  });

  it('returns a validated suggestion and saves nothing', async () => {
    const supplierId = await makeSupplier();
    const response = await extract(supplierId);

    expect(response.status).toBe(200);
    expect(response.body.suggestion).toEqual({
      type: 'ISO_14001',
      issuer: 'TUV Nord CERT GmbH',
      certificateNumber: 'Z-2025-0042',
      issueDate: null,
      expiryDate: '2028-02-28',
    });
    expect(response.body.verification.certificateNumber).toBe('verified');
    expect(response.body.model).toBe('fake-model');
    expect(response.body.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(response.body.remainingToday).toBe(7);

    expect(await prisma.certificate.count()).toBe(0);
    const stored = await readdir(uploadRoot()).catch(() => []);
    expect(stored).toEqual([]);
  });

  it('records the attempt with a hash only — no address and no part of one', async () => {
    const supplierId = await makeSupplier();
    await extract(supplierId, { ip: '198.51.100.7' });
    const rows = await prisma.llmExtractionAttempt.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('SUCCESS');
    expect(rows[0]?.inputTokens).toBe(100);
    expect(rows[0]?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]).not.toHaveProperty('ipPrefix');
    expect(JSON.stringify(rows)).not.toContain('198.51.100');
  });

  it('marks the attempt UPSTREAM_ERROR and answers 503 when the provider fails', async () => {
    const supplierId = await makeSupplier();
    fake.next = new LlmError('unavailable');
    const response = await extract(supplierId);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('EXTRACTION_UNAVAILABLE');
    const rows = await prisma.llmExtractionAttempt.findMany();
    expect(rows[0]?.outcome).toBe('UPSTREAM_ERROR');
  });

  it('answers 422 when the model output fails the schema', async () => {
    const supplierId = await makeSupplier();
    fake.next = {
      output: { nonsense: true },
      model: 'fake-model',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    const response = await extract(supplierId);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('EXTRACTION_FAILED');
    expect(response.body).not.toHaveProperty('suggestion');
  });

  it('allows 8 calls per client per day, then answers 429 with scope "ip"', async () => {
    const supplierId = await makeSupplier();
    for (let call = 0; call < 8; call += 1) {
      expect((await extract(supplierId, { ip: '203.0.113.5' })).status).toBe(200);
    }
    const blocked = await extract(supplierId, { ip: '203.0.113.5' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.details).toEqual([{ path: 'scope', message: 'ip' }]);
    expect(fake.calls).toBe(8);
    expect((await extract(supplierId, { ip: '203.0.113.6' })).status).toBe(200);
  });

  it('does not exceed the per-IP limit under concurrency', async () => {
    const supplierId = await makeSupplier();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => extract(supplierId, { ip: '203.0.113.9' })),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(8);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(2);
  });

  it('allows 15 calls per day across all clients, then answers 429 with scope "global"', async () => {
    const supplierId = await makeSupplier();
    for (let call = 0; call < 15; call += 1) {
      const response = await extract(supplierId, { ip: `192.0.2.${String(call + 1)}` });
      expect(response.status).toBe(200);
    }
    const blocked = await extract(supplierId, { ip: '192.0.2.200' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.details).toEqual([{ path: 'scope', message: 'global' }]);
  });
});

describe('GET /api/extraction/status', () => {
  it('reports enabled, the model and what is left today', async () => {
    const supplierId = await makeSupplier();
    await extract(supplierId, { ip: '198.51.100.20' });
    const response = await api
      .get('/api/extraction/status')
      .set('X-Forwarded-For', '198.51.100.20');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enabled: true, model: 'fake-model', remainingToday: 7 });
    expect(new Date(response.body.resetsAt as string).getUTCHours()).toBe(0);
  });

  it('reports disabled when no model is configured', async () => {
    const agent = await signIn(createApp({ llmClient: null }));
    const response = await agent.get('/api/extraction/status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enabled: false, model: null, remainingToday: 0 });
  });
});
