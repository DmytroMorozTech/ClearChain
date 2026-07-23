import Chip from '@mui/material/Chip';

import { RISK_COLORS, RISK_LABELS, type RiskLevel } from '../theme.ts';

interface RiskChipProps {
  level: RiskLevel | null;
  score?: number | null;
  size?: 'small' | 'medium';
}

/**
 * Risk always travels as colour *and* text.
 *
 * A coloured dot alone excludes anyone who cannot distinguish the hues, and this is a
 * compliance tool where reading the value wrongly is the whole failure mode.
 */
export function RiskChip({ level, score, size = 'small' }: RiskChipProps) {
  if (level === null) {
    return <Chip label="—" size={size} variant="outlined" />;
  }

  const color = RISK_COLORS[level];
  const label =
    score === null || score === undefined
      ? RISK_LABELS[level]
      : `${RISK_LABELS[level]} · ${String(score)}`;

  return (
    <Chip
      label={label}
      size={size}
      sx={{
        color,
        backgroundColor: `${color}14`,
        border: `1px solid ${color}55`,
      }}
    />
  );
}
