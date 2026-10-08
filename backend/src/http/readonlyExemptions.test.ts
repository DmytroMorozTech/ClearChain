import { describe, expect, it } from 'vitest';

import { isReadonlyExempt } from './readonlyExemptions.ts';

describe('isReadonlyExempt', () => {
  it('exempts only POST to the extract route', () => {
    const path = '/suppliers/2b7e1c3a-0000-4000-8000-000000000000/certificates/extract';
    expect(isReadonlyExempt('POST', path)).toBe(true);
    expect(isReadonlyExempt('DELETE', path)).toBe(false);
    expect(isReadonlyExempt('POST', '/suppliers/x/certificates')).toBe(false);
    expect(isReadonlyExempt('POST', '/suppliers/x/certificates/extract/more')).toBe(false);
  });
});
