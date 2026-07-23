import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useDashboard } from '../api/queries.ts';

/**
 * Phase 8 renders the raw figures only; the tiles and the Recharts distribution arrive
 * in Phase 10. Showing real numbers now proves the whole path works end to end — Vite
 * proxy, API client, response validation, React Query.
 */
export function DashboardPage() {
  const { data, isPending, isError, error } = useDashboard();

  return (
    <Stack spacing={2}>
      <Typography variant="h1">Dashboard</Typography>

      {isPending && <Typography color="text.secondary">Loading…</Typography>}
      {isError && <Alert severity="error">{error.message}</Alert>}

      {data && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h2" gutterBottom>
            {data.company.name}
          </Typography>
          <Typography component="pre" sx={{ fontFamily: 'monospace', fontSize: 13, m: 0 }}>
            {[
              `suppliers        ${String(data.suppliers.total)}`,
              `compliant        ${String(data.suppliers.compliant)} (${String(data.suppliers.compliantPercentage)}%)`,
              `risk             ${data.suppliers.byRiskLevel
                .map((entry) => `${entry.level} ${String(entry.count)}`)
                .join('   ')}`,
              `by tier          ${data.suppliers.byTier
                .map((entry) => `T${String(entry.tier)} ${String(entry.count)}`)
                .join('   ')}`,
              `certificates     ${String(data.certificates.total)}`,
              `expiring ≤${String(data.certificates.expiryWindowDays)}d     ${String(data.certificates.expiringSoon)}`,
              `expired          ${String(data.certificates.expired)}`,
              `last ERP sync    ${data.lastSync ? data.lastSync.status : 'never'}`,
            ].join('\n')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Tiles and charts arrive in Phase 10.
          </Typography>
        </Paper>
      )}
    </Stack>
  );
}
