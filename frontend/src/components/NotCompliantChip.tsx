import Chip from '@mui/material/Chip';
import { X } from 'lucide-react';

import { RISK_COLORS } from '../theme.ts';

export function NotCompliantChip({ size = 'small' }: { size?: 'small' | 'medium' }) {
  return (
    <Chip
      size={size}
      variant="outlined"
      icon={<X size={size === 'medium' ? 16 : 14} />}
      label="Not compliant"
      sx={{
        color: RISK_COLORS.RED,
        backgroundColor: 'transparent',
        borderColor: `${RISK_COLORS.RED}66`,
        '& .MuiChip-icon': { color: 'inherit' },
      }}
    />
  );
}
