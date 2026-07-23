import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { type ApiAgent, signIn } from './helpers/auth.ts';
import { prisma } from '../src/db/prisma.ts';
import {
  disconnect,
  resetDatabase,
  resetUploads,
  seedCountries,
  uploadRoot,
} from './helpers/db.ts';

let app: Express;
let api: ApiAgent;

const PDF = Buffer.from('%PDF-1.7\nfake certificate body\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

beforeAll(async () => {
  app = createApp();
  api = await signIn(app);
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

async function makeSupplier(): Promise<string> {
  const response = await api
    .post('/api/suppliers')
    .send({ name: 'Acme Textiles', countryCode: 'DE', category: 'MANUFACTURING' });
  return response.body.id as string;
}

function upload(supplierId: string) {
  return api
    .post(`/api/suppliers/${supplierId}/certificates`)
    .field('type', 'ISO_14001')
    .field('issueDate', '2026-01-15')
    .field('expiryDate', '2027-01-15');
}

/** Every file under the upload root, as paths relative to it. */
async function listStoredFiles(): Promise<string[]> {
  const root = uploadRoot();
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }

  await walk(root);
  return found.sort();
}

describe('POST /api/suppliers/:id/certificates', () => {
  it('stores the file under a server-generated UUID key', async () => {
    const supplierId = await makeSupplier();

    const response = await upload(supplierId).attach('file', PDF, {
      filename: 'iso-14001.pdf',
      contentType: 'application/pdf',
    });

    expect(response.status).toBe(201);
    expect(response.body.fileName).toBe('iso-14001.pdf');
    expect(response.body.mimeType).toBe('application/pdf');
    expect(response.body.fileSize).toBe(PDF.byteLength);
    expect(response.body.status).toBe('VALID');

    const stored = await listStoredFiles();
    expect(stored).toHaveLength(1);
    // certificates/<supplierId>/<uuid>.pdf — the original name appears nowhere in it.
    expect(stored[0]).toMatch(new RegExp(`^certificates/${supplierId}/[0-9a-f-]{36}\\.pdf$`, 'i'));
  });

  // §19 Phase 4: a hostile filename must not influence where anything is written.
  it('ignores the uploaded filename when building the storage path', async () => {
    const supplierId = await makeSupplier();

    const response = await upload(supplierId).attach('file', PDF, {
      filename: '../../../evil.pdf',
      contentType: 'application/pdf',
    });

    expect(response.status).toBe(201);

    const stored = await listStoredFiles();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(new RegExp(`^certificates/${supplierId}/[0-9a-f-]{36}\\.pdf$`, 'i'));
    expect(stored[0]).not.toContain('..');

    // Nothing was written beside the upload root either.
    await expect(stat(path.join(uploadRoot(), '..', 'evil.pdf'))).rejects.toThrow();
  });

  it('accepts PNG as well as PDF', async () => {
    const supplierId = await makeSupplier();

    const response = await upload(supplierId).attach('file', PNG, {
      filename: 'scan.png',
      contentType: 'image/png',
    });

    expect(response.status).toBe(201);
    expect(response.body.mimeType).toBe('image/png');
  });

  it('rejects a file type that is not on the allowlist', async () => {
    const supplierId = await makeSupplier();

    const response = await upload(supplierId).attach('file', Buffer.from('just text'), {
      filename: 'notes.txt',
      contentType: 'text/plain',
    });

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(await listStoredFiles()).toHaveLength(0);
  });

  // The declared Content-Type is client-controlled and therefore not evidence.
  it('rejects a file whose real bytes disagree with its declared type', async () => {
    const supplierId = await makeSupplier();

    const response = await upload(supplierId).attach('file', PNG, {
      filename: 'disguised.pdf',
      contentType: 'application/pdf',
    });

    expect(response.status).toBe(415);
    expect(response.body.error.message).toContain('image/png');
    expect(await listStoredFiles()).toHaveLength(0);
  });

  it('rejects an HTML payload dressed as a PDF', async () => {
    const supplierId = await makeSupplier();

    const response = await upload(supplierId).attach(
      'file',
      Buffer.from('<script>alert(document.domain)</script>'),
      { filename: 'xss.pdf', contentType: 'application/pdf' },
    );

    expect(response.status).toBe(415);
    expect(await listStoredFiles()).toHaveLength(0);
  });

  it('requires a file', async () => {
    const supplierId = await makeSupplier();

    const response = await upload(supplierId);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an expiry that precedes the issue date', async () => {
    const supplierId = await makeSupplier();

    const response = await api
      .post(`/api/suppliers/${supplierId}/certificates`)
      .field('type', 'ISO_14001')
      .field('issueDate', '2026-05-01')
      .field('expiryDate', '2026-01-01')
      .attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(400);
    expect(response.body.error.details.some((d: { path: string }) => d.path === 'expiryDate')).toBe(
      true,
    );
    expect(await listStoredFiles()).toHaveLength(0);
  });

  it('rejects an issue date in the future', async () => {
    const supplierId = await makeSupplier();

    const response = await api
      .post(`/api/suppliers/${supplierId}/certificates`)
      .field('type', 'ISO_14001')
      .field('issueDate', '2999-01-01')
      .field('expiryDate', '2999-06-01')
      .attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(400);
  });

  it('accepts an already-expired certificate as a historical record', async () => {
    const supplierId = await makeSupplier();

    const response = await api
      .post(`/api/suppliers/${supplierId}/certificates`)
      .field('type', 'ISO_14001')
      .field('issueDate', '2020-01-01')
      .field('expiryDate', '2021-01-01')
      .attach('file', PDF, { filename: 'old.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('EXPIRED');
  });

  it('returns 404 for an unknown supplier and stores nothing', async () => {
    const response = await upload('00000000-0000-4000-8000-000000000000').attach('file', PDF, {
      filename: 'x.pdf',
      contentType: 'application/pdf',
    });

    expect(response.status).toBe(404);
    expect(await listStoredFiles()).toHaveLength(0);
  });
});

describe('GET /api/certificates/:id/file', () => {
  it('serves the bytes as an attachment that cannot be sniffed into script', async () => {
    const supplierId = await makeSupplier();
    const created = await upload(supplierId).attach('file', PDF, {
      filename: 'iso-14001.pdf',
      contentType: 'application/pdf',
    });

    const response = await api.get(`/api/certificates/${created.body.id}/file`);

    expect(response.status).toBe(200);
    // Content-Type comes from the allowlist the bytes were validated against, and
    // nosniff stops the browser from second-guessing it. Together with `attachment`,
    // this is what keeps an uploaded file from executing in the API's own origin.
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe('attachment; filename="iso-14001.pdf"');
    expect(Buffer.from(response.body)).toEqual(PDF);
  });

  // Header-injection characters are stripped by sanitizeFileName, which is unit-tested
  // directly: multipart transport percent-encodes them long before they reach a header,
  // so an end-to-end test here could not tell a working sanitizer from a missing one.
  it('quotes the filename so a name with spaces stays one header value', async () => {
    const supplierId = await makeSupplier();
    const created = await upload(supplierId).attach('file', PDF, {
      filename: 'annual audit 2026.pdf',
      contentType: 'application/pdf',
    });

    const response = await api.get(`/api/certificates/${created.body.id}/file`);

    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="annual audit 2026.pdf"',
    );
  });

  it('404s for an unknown certificate', async () => {
    const response = await api.get('/api/certificates/00000000-0000-4000-8000-000000000000/file');

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/certificates/:id', () => {
  it('removes the row and the stored object together', async () => {
    const supplierId = await makeSupplier();
    const created = await upload(supplierId).attach('file', PDF, {
      filename: 'x.pdf',
      contentType: 'application/pdf',
    });

    expect(await listStoredFiles()).toHaveLength(1);

    const response = await api.delete(`/api/certificates/${created.body.id}`);

    expect(response.status).toBe(204);
    expect(await listStoredFiles()).toHaveLength(0);
    expect(await prisma.certificate.count()).toBe(0);
  });
});

describe('deleting a supplier', () => {
  it('sweeps the stored objects of its cascaded certificates', async () => {
    const supplierId = await makeSupplier();
    await upload(supplierId).attach('file', PDF, {
      filename: 'a.pdf',
      contentType: 'application/pdf',
    });
    await upload(supplierId).attach('file', PNG, {
      filename: 'b.png',
      contentType: 'image/png',
    });

    expect(await listStoredFiles()).toHaveLength(2);

    const response = await api.delete(`/api/suppliers/${supplierId}`);

    expect(response.status).toBe(204);
    expect(await prisma.certificate.count()).toBe(0);
    expect(await listStoredFiles()).toHaveLength(0);
  });
});

describe('certificates affect compliance and risk', () => {
  it('improves the supplier risk score once required certificates are present', async () => {
    const supplierId = await makeSupplier();

    const before = await api.get(`/api/suppliers/${supplierId}`);
    expect(before.body.isCompliant).toBe(false);

    for (const type of ['SA8000', 'OEKO_TEX', 'ISO_14001']) {
      await api
        .post(`/api/suppliers/${supplierId}/certificates`)
        .field('type', type)
        .field('issueDate', '2026-01-01')
        .field('expiryDate', '2030-01-01')
        .attach('file', PDF, { filename: `${type}.pdf`, contentType: 'application/pdf' });
    }

    const after = await api.get(`/api/suppliers/${supplierId}`);

    expect(after.body.isCompliant).toBe(true);
    expect(after.body.riskScore).toBeLessThan(before.body.riskScore);
  });

  it('treats the latest expiry as the effective certificate for a type', async () => {
    const supplierId = await makeSupplier();

    for (const expiry of ['2021-01-01', '2030-01-01']) {
      await api
        .post(`/api/suppliers/${supplierId}/certificates`)
        .field('type', 'ISO_14001')
        .field('issueDate', '2020-01-01')
        .field('expiryDate', expiry)
        .attach('file', PDF, { filename: 'iso.pdf', contentType: 'application/pdf' });
    }

    const detail = await api.get(`/api/suppliers/${supplierId}`);
    const isoRequirement = detail.body.requirements.find(
      (r: { type: string }) => r.type === 'ISO_14001',
    );

    // Two rows exist — renewal history is kept — but the live one wins.
    expect(detail.body.certificates).toHaveLength(2);
    expect(isoRequirement.status).toBe('VALID');
  });
});

describe('GET /api/certificates', () => {
  it('filters by derived status and expiry window', async () => {
    const supplierId = await makeSupplier();

    await api
      .post(`/api/suppliers/${supplierId}/certificates`)
      .field('type', 'ISO_14001')
      .field('issueDate', '2020-01-01')
      .field('expiryDate', '2021-01-01')
      .attach('file', PDF, { filename: 'expired.pdf', contentType: 'application/pdf' });

    await api
      .post(`/api/suppliers/${supplierId}/certificates`)
      .field('type', 'SA8000')
      .field('issueDate', '2026-01-01')
      .field('expiryDate', '2035-01-01')
      .attach('file', PDF, { filename: 'valid.pdf', contentType: 'application/pdf' });

    const expired = await api.get('/api/certificates?status=EXPIRED');
    expect(expired.body.total).toBe(1);
    expect(expired.body.data[0].type).toBe('ISO_14001');

    const valid = await api.get('/api/certificates?status=VALID');
    expect(valid.body.total).toBe(1);
    expect(valid.body.data[0].type).toBe('SA8000');

    // An expired certificate is not "expiring within N days" — it already went.
    const soon = await api.get('/api/certificates?expiringWithinDays=30');
    expect(soon.body.total).toBe(0);
  });
});
