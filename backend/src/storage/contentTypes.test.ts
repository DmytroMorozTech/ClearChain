import { describe, expect, it } from 'vitest';

import { isAllowedMimeType, sanitizeFileName, sniffMimeType } from './contentTypes.ts';

const PDF = Buffer.from('%PDF-1.7\n% test');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('sniffMimeType', () => {
  it('identifies the formats we accept by their leading bytes', () => {
    expect(sniffMimeType(PDF)).toBe('application/pdf');
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(JPEG)).toBe('image/jpeg');
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(sniffMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffMimeType(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffMimeType(Buffer.from('plain text'))).toBeNull();
  });

  it('does not read past the end of a short buffer', () => {
    expect(sniffMimeType(Buffer.from([0x89]))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
  });
});

describe('isAllowedMimeType', () => {
  it('accepts only the allowlist', () => {
    expect(isAllowedMimeType('application/pdf')).toBe(true);
    expect(isAllowedMimeType('image/svg+xml')).toBe(false);
    expect(isAllowedMimeType('text/html')).toBe(false);
  });

  it('is not fooled by inherited object properties', () => {
    expect(isAllowedMimeType('constructor')).toBe(false);
    expect(isAllowedMimeType('toString')).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('strips characters that would break out of a Content-Disposition header', () => {
    expect(sanitizeFileName('re"port.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('a\r\nContent-Length: 0\r\n\r\n.pdf')).toBe('aContent-Length: 0.pdf');
  });

  it('flattens path separators, since the name is display-only', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
  });

  it('falls back to a default when nothing usable remains', () => {
    expect(sanitizeFileName('   ')).toBe('certificate');
    expect(sanitizeFileName('""')).toBe('certificate');
  });
});
