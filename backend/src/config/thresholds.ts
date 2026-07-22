/**
 * Time windows used across the application.
 *
 * Both constants live here specifically so the two are never conflated. They are
 * intentionally different values, and the original brief's inconsistency between them
 * was resolved by declaring them as two distinct concepts rather than picking one
 * (requirements.md §5.1).
 */

/**
 * Days before expiry at which a certificate's derived status becomes `EXPIRING_SOON`.
 * Drives certificate *status* everywhere in the app.
 */
export const EXPIRING_SOON_DAYS = 60;

/**
 * Window used by the dashboard's "expiring soon" tile only — a deliberately narrower
 * urgency view than the status threshold above. Must stay strictly narrower, otherwise
 * the tile stops meaning anything distinct from the status badge.
 */
export const DASHBOARD_EXPIRY_WINDOW_DAYS = 30;
