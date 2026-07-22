import { DASHBOARD_EXPIRY_WINDOW_DAYS, EXPIRING_SOON_DAYS } from './config/thresholds.js';

// The HTTP server arrives in Phase 3. For now this entry point exists to prove the
// toolchain end to end: ESM + NodeNext resolution, `tsx watch` in dev, and
// `node dist/index.js` after `tsc` — the same path the production image uses (§17).
console.log(
  `ClearChain backend — scaffold ready ` +
    `(expiring-soon: ${EXPIRING_SOON_DAYS}d, dashboard window: ${DASHBOARD_EXPIRY_WINDOW_DAYS}d)`,
);
