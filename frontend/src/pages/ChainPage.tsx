import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useChain } from '../api/queries.ts';
import { ChainFlow } from '../components/ChainFlow.tsx';
import { RISK_COLORS, RISK_LABELS, type RiskLevel } from '../theme.ts';

const LEGEND: RiskLevel[] = ['GREEN', 'YELLOW', 'RED'];

export function ChainPage() {
  const { data, isPending, isError, error } = useChain();

  if (isError) return <Alert severity="error">{error.message}</Alert>;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="h1">Supply chain</Typography>
        {data && (
          <Typography color="text.secondary">
            {data.nodes.length - 1} suppliers beneath {data.company.name}
          </Typography>
        )}
      </Stack>

      {/* A legend is present because the map encodes risk; the nodes name their band
          as well, so identity never rests on colour alone. */}
      <Stack direction="row" spacing={2.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {LEGEND.map((level) => (
          <Stack key={level} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Box
              sx={{ width: 4, height: 15, borderRadius: 1, backgroundColor: RISK_COLORS[level] }}
            />
            <Typography variant="body2" color="text.secondary">
              {RISK_LABELS[level]} risk
            </Typography>
          </Stack>
        ))}
        <Typography variant="body2" color="text.secondary">
          · click a supplier to open it
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ height: '68vh', minHeight: 460, overflow: 'hidden' }}>
        {isPending ? <Skeleton variant="rectangular" height="100%" /> : <ChainFlow chain={data} />}
      </Paper>
    </Stack>
  );
}
