import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

interface StatTileProps {
  label: string;
  value: ReactNode;
  caption?: string;
  accent?: string;
  hero?: boolean;
}

/**
 * A single number is a stat tile, not a one-bar chart.
 *
 * Figures are proportional, never tabular: equal-width digits make a large standalone
 * number look loose. Tabular figures belong where numbers stack vertically — table
 * rows and axis ticks.
 */
export function StatTile({ label, value, caption, accent, hero = false }: StatTileProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Stack spacing={0.5}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography
          sx={{
            fontSize: hero ? 52 : 32,
            fontWeight: 680,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: accent ?? 'text.primary',
          }}
        >
          {value}
        </Typography>
        {caption && (
          <Typography variant="body2" color="text.secondary">
            {caption}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
