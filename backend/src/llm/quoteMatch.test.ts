import { describe, expect, it } from 'vitest';

import { normalizeForMatch, quoteAppearsIn } from './quoteMatch.ts';

describe('normalizeForMatch', () => {
  it('folds case, compatibility forms, dashes and quotes, and collapses whitespace', () => {
    expect(normalizeForMatch('  Gültig\u00A0BIS  31.12.2027 ')).toBe('gültig bis 31.12.2027');
    expect(normalizeForMatch('ISO\u201114001 \u201Cfoo\u201D')).toBe('iso-14001 "foo"');
  });
});

describe('quoteAppearsIn', () => {
  const text =
    'Zertifikat\nDIN EN ISO 14001:2015\nZertifikat-Nr.: Z-2025-0042\ngültig bis\n28.02.2028';

  it('finds an exact quote', () => {
    expect(quoteAppearsIn('Zertifikat-Nr.: Z-2025-0042', text)).toBe(true);
  });

  it('matches across line breaks and lost spaces', () => {
    expect(quoteAppearsIn('gültig bis 28.02.2028', text)).toBe(true);
    expect(quoteAppearsIn('gültig bis 28.02.2028', 'gültigbis28.02.2028')).toBe(true);
  });

  it('rejects text that is not there', () => {
    expect(quoteAppearsIn('gültig bis 28.02.2029', text)).toBe(false);
  });

  it('treats an empty quote as not found', () => {
    expect(quoteAppearsIn('   ', text)).toBe(false);
  });
});
