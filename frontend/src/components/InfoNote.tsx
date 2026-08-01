import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A line that explains the thing above it, rather than reporting a value.
 *
 * `variant="caption" color="text.secondary"` is the app's general small-print style, but
 * it carries at least five unrelated meanings — field labels, metadata readouts, inline
 * detail, filter summaries, and explanations like this one. The glyph is what separates
 * the last kind from the rest: it marks the text as commentary, so a reader can skip it
 * once the vocabulary is learned and not mistake it for another figure.
 *
 * Deliberately no fill and no border. A tinted panel would sit heavier than the numbers
 * it explains and invert the hierarchy, and inside an already-outlined card it reads as
 * a box within a box.
 */
export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start' }}>
      {/* Nudged down to sit on the first line's baseline, and held at its size so a long
          note cannot squeeze it. */}
      <Info
        size={14}
        aria-hidden
        style={{ flexShrink: 0, marginTop: 2, opacity: 0.7 }}
      />
      <Typography variant="caption" color="text.secondary">
        {children}
      </Typography>
    </Stack>
  );
}
