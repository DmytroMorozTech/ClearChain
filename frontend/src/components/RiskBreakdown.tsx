import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { Risk } from '../api/schemas.ts';
import { RISK_COLORS } from '../theme.ts';

interface RiskBreakdownProps {
  risk: Risk;
}

/**
 * Shows how the score was reached, not just what it is.
 *
 * The scoring rules are deliberately transparent, and a number with no explanation
 * would waste that: a user who disagrees with a supplier's rating can see exactly which
 * factor drove it and act on the one that matters.
 */
export function RiskBreakdown({ risk }: RiskBreakdownProps) {
  const color = RISK_COLORS[risk.level];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color }}>
          {risk.score}
        </Typography>
        <Typography color="text.secondary">of 100</Typography>
      </Stack>

      <LinearProgress
        variant="determinate"
        value={risk.score}
        aria-label={`Risk score ${String(risk.score)} of 100`}
        sx={{
          height: 8,
          borderRadius: 4,
          backgroundColor: 'action.hover',
          '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 4 },
        }}
      />

      <Divider />

      <Stack spacing={1.5} component="dl" sx={{ m: 0 }}>
        {risk.factors.map((factor) => (
          <Box key={factor.code}>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
              <Typography component="dt" sx={{ fontWeight: 600, fontSize: 14 }}>
                {factor.label}
              </Typography>
              <Typography
                sx={{
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  fontSize: 14,
                  color: factor.points > 0 ? 'text.primary' : 'text.disabled',
                }}
              >
                {factor.points > 0 ? `+${String(factor.points)}` : '0'}
              </Typography>
            </Stack>
            <Typography component="dd" variant="body2" color="text.secondary" sx={{ m: 0 }}>
              {factor.detail}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
