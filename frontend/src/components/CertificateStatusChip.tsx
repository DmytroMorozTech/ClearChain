import Chip from '@mui/material/Chip';

import { STATUS_LABELS } from '../format.ts';
import { RISK_COLORS } from '../theme.ts';

type Status = keyof typeof STATUS_LABELS;

/**
 * Certificate status reuses the risk palette because it is the same signal to the same
 * reader: green is fine, amber needs attention, red is a breach. "Not held" is a breach
 * too — an absent certificate is no better than an expired one.
 */
const STATUS_COLORS: Record<Status, string> = {
  VALID: RISK_COLORS.GREEN,
  EXPIRING_SOON: RISK_COLORS.YELLOW,
  EXPIRED: RISK_COLORS.RED,
  MISSING: RISK_COLORS.RED,
};

interface CertificateStatusChipProps {
  status: Status;
  size?: 'small' | 'medium';
}

export function CertificateStatusChip({ status, size = 'small' }: CertificateStatusChipProps) {
  const color = STATUS_COLORS[status];

  return (
    <Chip
      label={STATUS_LABELS[status]}
      size={size}
      variant={status === 'MISSING' ? 'outlined' : 'filled'}
      sx={{
        color,
        backgroundColor: status === 'MISSING' ? 'transparent' : `${color}14`,
        border: `1px solid ${color}${status === 'MISSING' ? '99' : '55'}`,
      }}
    />
  );
}
