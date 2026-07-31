import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { List, Network } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useChain } from '../api/queries.ts';
import { patchChainView, readChainView } from '../chainView.ts';
import { ChainFlow } from '../components/ChainFlow.tsx';
import { ChainList } from '../components/ChainList.tsx';
import { ViewToggle } from '../components/ViewToggle.tsx';
import { MOBILE_BREAKPOINT, RISK_COLORS, RISK_LABELS, type RiskLevel } from '../theme.ts';

const LEGEND: RiskLevel[] = ['GREEN', 'YELLOW', 'RED'];

type ChainView = 'map' | 'list';

const VIEW_OPTIONS = [
  { value: 'map', label: 'Map', icon: Network },
  { value: 'list', label: 'List', icon: List },
] as const satisfies readonly { value: ChainView; label: string; icon: typeof List }[];

export function ChainPage() {
  const { data, isPending, isError, error } = useChain();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(MOBILE_BREAKPOINT), { noSsr: true });

  // Restored if the reader has been here before in this tab; otherwise seeded from the
  // breakpoint. Same disclosure as the charts on the dashboard: the picture is the
  // default where there is room for it, and the text is always one press away.
  const restored = useMemo(() => readChainView(), []);
  const [view, setView] = useState<ChainView>(restored?.view ?? (isMobile ? 'list' : 'map'));
  const asList = view === 'list';

  const changeView = useCallback((next: ChainView) => {
    setView(next);
    patchChainView({ view: next });
  }, []);

  if (isError) return <Alert severity="error">{error.message}</Alert>;

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 1 }}
      >
        <Typography variant="h1">Supply chain</Typography>
        {data && (
          <Typography color="text.secondary">
            {data.nodes.length - 1} suppliers beneath {data.company.name}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <ViewToggle value={view} onChange={changeView} options={VIEW_OPTIONS} label="Chain view" />
      </Stack>

      {/* A legend is present because the map encodes risk; the nodes name their band
          as well, so identity never rests on colour alone. The list labels every chip,
          so it needs no key. */}
      {!asList && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 2.5, rowGap: 1 }}>
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
      )}

      <Paper
        variant="outlined"
        sx={
          asList
            ? { overflow: 'hidden' }
            : { height: { xs: '65dvh', md: '68vh' }, minHeight: { xs: 360, md: 460 } }
        }
      >
        {isPending ? (
          <Skeleton variant="rectangular" height={asList ? 360 : '100%'} />
        ) : asList ? (
          <ChainList chain={data} />
        ) : (
          <ChainFlow chain={data} compact={isMobile} />
        )}
      </Paper>
    </Stack>
  );
}
