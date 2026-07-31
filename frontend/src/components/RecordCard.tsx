import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';

type RecordCardProps = {
  title: ReactNode;
  /** The secondary line: the fields a table would have given their own columns. */
  meta?: ReactNode;
  /** Status carried as chips, wrapped onto as many lines as it needs. */
  chips?: ReactNode;
} & ({ to: string; action?: never } | { to?: undefined; action?: ReactNode });

/**
 * One record, one card — the mobile counterpart of a table row.
 *
 * A seven-column table is not a layout that a 414px screen can be talked into; the
 * columns have to become lines. Both list screens compose this rather than each drawing
 * its own card, which is what makes a supplier and a certificate read as the same kind
 * of object.
 *
 * Deliberately a visual shell and not a column-config schema. The two callers differ in
 * ways a schema would have to grow options for — one is a link, the other carries a
 * download button and an inner link of its own — and that is the shape of abstraction
 * that leaks on the third caller.
 *
 * `to` and `action` are mutually exclusive in the type rather than by convention: a card
 * that is a link renders an anchor, and an anchor wrapping a button is invalid HTML that
 * every browser resolves differently. One union makes it unrepresentable.
 */
export function RecordCard({ title, meta, chips, to, action }: RecordCardProps) {
  const body = (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      {/* `minWidth: 0` lets long supplier names ellipsize instead of forcing the row
          wider than the card. */}
      <Stack spacing={0.5} sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography sx={{ fontWeight: 650, lineHeight: 1.3 }}>{title}</Typography>
        {meta}
        {chips && (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, pt: 0.5 }}>
            {chips}
          </Stack>
        )}
      </Stack>
      {action}
    </Stack>
  );

  if (to === undefined) {
    return (
      <Paper variant="outlined" sx={{ p: 1.75 }}>
        {body}
      </Paper>
    );
  }

  return (
    <Paper
      variant="outlined"
      component={RouterLink}
      to={to}
      sx={{
        p: 1.75,
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        // Touch has no hover, so the press itself is the only feedback available.
        '&:active': { backgroundColor: 'action.hover' },
      }}
    >
      {body}
    </Paper>
  );
}
