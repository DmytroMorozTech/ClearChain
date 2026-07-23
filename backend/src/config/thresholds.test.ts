import { describe, expect, it } from 'vitest';

import { DASHBOARD_EXPIRY_WINDOW_DAYS, EXPIRING_SOON_DAYS } from './thresholds.ts';

describe('threshold constants', () => {
  it('matches the values fixed in the spec (§5.1)', () => {
    expect(EXPIRING_SOON_DAYS).toBe(60);
    expect(DASHBOARD_EXPIRY_WINDOW_DAYS).toBe(30);
  });

  it('keeps the dashboard window strictly narrower than the status threshold', () => {
    // Not a tautology: this encodes *why* the two differ. Anyone "fixing" the apparent
    // inconsistency by collapsing them into one value fails here and reads the reason.
    expect(DASHBOARD_EXPIRY_WINDOW_DAYS).toBeLessThan(EXPIRING_SOON_DAYS);
  });
});
