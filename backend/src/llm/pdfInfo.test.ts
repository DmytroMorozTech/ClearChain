import { describe, expect, it } from 'vitest';

import { buildCertificatePdf } from '../../prisma/seed/pdf.ts';
import { readPdf, usableText } from './pdfInfo.ts';

describe('readPdf', () => {
  it('reads the page count and text of a real PDF', async () => {
    const pdf = buildCertificatePdf('ISO 14001 Certificate', [
      'Certificate No. ABC-123',
      'Valid until 2028-02-28',
    ]);
    const info = await readPdf(pdf);
    expect(info.pageCount).toBe(1);
    expect(info.text).toContain('ABC-123');
  });

  it('rejects bytes that only start like a PDF', async () => {
    await expect(readPdf(Buffer.from('%PDF-1.7\nfake certificate body\n%%EOF'))).rejects.toThrow();
  });
});

describe('usableText', () => {
  it('treats a near-empty text layer as no text', () => {
    expect(usableText('  \n ')).toBeNull();
    expect(usableText('Certificate No. ABC-123 valid until 2028')).not.toBeNull();
  });
});
