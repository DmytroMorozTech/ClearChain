import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { CircleCheck, CircleDashed, CircleX, Clock, type LucideIcon } from 'lucide-react';

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

const STATUS_ICONS: Record<Status, LucideIcon> = {
  VALID: CircleCheck,
  EXPIRING_SOON: Clock,
  EXPIRED: CircleX,
  MISSING: CircleDashed,
};

const SR_ONLY = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

interface CertificateStatusChipProps {
  status: Status;
  size?: 'small' | 'medium';
  /**
   * Drops the word and keeps the glyph. For places where the row already names what is
   * being described — the requirement badges, where the certificate type sits alongside.
   * The label stays reachable as a tooltip and to a screen reader.
   */
  iconOnly?: boolean;
}

export function CertificateStatusChip({
  status,
  size = 'small',
  iconOnly = false,
}: CertificateStatusChipProps) {
  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];
  const Icon = STATUS_ICONS[status];
  const glyph = size === 'medium' ? 16 : 14;

  const sx = {
    color,
    backgroundColor: status === 'MISSING' ? 'transparent' : `${color}14`,
    border: `1px solid ${color}${status === 'MISSING' ? '99' : '55'}`,
    // The label is the flex container itself. Nesting one inside it instead leaves an
    // inline-level box sitting on the label's baseline — and a flex container takes its
    // baseline from the first item, the icon, not from the word beside it.
    '& .MuiChip-label': {
      display: 'flex',
      alignItems: 'center',
      gap: 0.5,
      ...(iconOnly && { px: 0 }),
    },
    ...(iconOnly && {
      '&.MuiChip-sizeSmall': { paddingLeft: '6px', paddingRight: '6px' },
    }),
  };

  if (iconOnly) {
    return (
      <Tooltip title={label}>
        <Chip
          size={size}
          variant={status === 'MISSING' ? 'outlined' : 'filled'}
          label={
            <>
              <Icon size={glyph + 1} aria-hidden />
              <Box component="span" sx={SR_ONLY}>
                {label}
              </Box>
            </>
          }
          sx={sx}
        />
      </Tooltip>
    );
  }

  return (
    <Chip
      size={size}
      variant={status === 'MISSING' ? 'outlined' : 'filled'}
      label={
        <>
          <Icon size={glyph} aria-hidden />
          {label}
        </>
      }
      sx={sx}
    />
  );
}
