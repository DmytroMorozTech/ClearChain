import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { Suspense, lazy } from 'react';

import { useDashboard } from '../api/queries.ts';
import type { DistributionDatum } from '../components/DistributionChart.tsx';
import { StatTile } from '../components/StatTile.tsx';
import { SyncPanel } from '../components/SyncPanel.tsx';
import { RISK_COLORS, RISK_LABELS } from '../theme.ts';

/**
 * Recharts is the largest thing on this route and the tiles do not need it. Splitting
 * it lets the headline figures paint immediately while the charts arrive behind them;
 * the type import above is erased at build time and pulls nothing in.
 */
const DistributionChart = lazy(async () => {
  const module = await import('../components/DistributionChart.tsx');
  return { default: module.DistributionChart };
});

const INDIGO = '#4F46E5';

export function DashboardPage() {
  const { data, isPending, isError, error, isFetching } = useDashboard();

  if (isError) return <Alert severity="error">{error.message}</Alert>;

  if (isPending) {
    return (
      <Stack spacing={2.5}>
        <Typography variant="h1">Dashboard</Typography>
        <Skeleton variant="rounded" height={140} />
        <Skeleton variant="rounded" height={260} />
      </Stack>
    );
  }

  const riskData: DistributionDatum[] = data.suppliers.byRiskLevel.map((entry) => ({
    key: entry.level,
    label: `${RISK_LABELS[entry.level]} risk`,
    count: entry.count,
    color: RISK_COLORS[entry.level],
  }));

  // Tiers are one series, so they take one colour. A darker-where-bigger ramp would
  // double-encode the bar length as hue and spend the only free channel on
  // information the bar already shows.
  const tierData: DistributionDatum[] = data.suppliers.byTier.map((entry) => ({
    key: String(entry.tier),
    label: `Tier ${String(entry.tier)}`,
    count: entry.count,
    color: INDIGO,
  }));

  const riskSummary = data.suppliers.byRiskLevel
    .map((entry) => `${RISK_LABELS[entry.level].toLowerCase()} ${String(entry.count)}`)
    .join(', ');

  return (
    // Refetching holds the previous render at reduced opacity rather than flashing a
    // skeleton, so nothing jumps while numbers refresh.
    <Stack spacing={2.5} sx={{ opacity: isFetching ? 0.65 : 1, transition: 'opacity 120ms' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="h1">Dashboard</Typography>
        <Typography color="text.secondary">{data.company.name}</Typography>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
        }}
      >
        <StatTile
          hero
          label="Suppliers compliant"
          value={`${String(data.suppliers.compliantPercentage)}%`}
          caption={`${String(data.suppliers.compliant)} of ${String(data.suppliers.total)} hold every required certificate`}
          accent={INDIGO}
        />
        <StatTile
          label="Suppliers tracked"
          value={data.suppliers.total}
          caption={`across ${String(data.suppliers.byTier.length)} tiers`}
        />
        <StatTile
          label={`Expiring within ${String(data.certificates.expiryWindowDays)} days`}
          value={data.certificates.expiringSoon}
          caption="certificates needing renewal"
          accent={data.certificates.expiringSoon > 0 ? RISK_COLORS.YELLOW : undefined}
        />
        <StatTile
          label="Expired"
          value={data.certificates.expired}
          caption={`of ${String(data.certificates.total)} certificates on file`}
          accent={data.certificates.expired > 0 ? RISK_COLORS.RED : undefined}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        }}
      >
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Suspense fallback={<Skeleton variant="rounded" height={240} />}>
            <DistributionChart
              title="Risk distribution"
              data={riskData}
              total={data.suppliers.total}
              summary={`${String(data.suppliers.total)} suppliers by risk band: ${riskSummary}.`}
            />
          </Suspense>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Suspense fallback={<Skeleton variant="rounded" height={240} />}>
            <DistributionChart
              title="Suppliers by tier"
              data={tierData}
              total={data.suppliers.total}
              summary={`Tier 1 is a direct supplier, tier 3 a raw-material source. ${tierData
                .map((datum) => `${datum.label.toLowerCase()} ${String(datum.count)}`)
                .join(', ')}.`}
            />
          </Suspense>
        </Paper>
      </Box>

      <SyncPanel lastSync={data.lastSync} />
    </Stack>
  );
}
