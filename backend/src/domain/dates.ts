/**
 * Calendar-date arithmetic in UTC.
 *
 * Issue and expiry dates are calendar dates, not instants. Comparing them as
 * timestamps produces an off-by-one-day error for any viewer west of UTC, which shows
 * up as a certificate reading EXPIRED a day early. Everything here truncates to UTC
 * midnight first so the comparison is between dates, not moments.
 */

const MS_PER_DAY = 86_400_000;

/** Discards any time component, returning UTC midnight of the same calendar day. */
export function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Whole calendar days from `from` to `to`. Negative when `to` is the earlier date.
 * Both operands are truncated to UTC dates first, so the result is always an integer.
 */
export function daysBetween(from: Date, to: Date): number {
  const diff = toUtcDateOnly(to).getTime() - toUtcDateOnly(from).getTime();
  return Math.round(diff / MS_PER_DAY);
}

/** Builds a UTC calendar date. `month` is 1-based, unlike the Date constructor. */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}
