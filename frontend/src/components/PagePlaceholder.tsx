import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

interface PagePlaceholderProps {
  title: string;
  phase: string;
  children?: ReactNode;
}

/** Temporary scaffolding for screens whose real content arrives in a later phase. */
export function PagePlaceholder({ title, phase, children }: PagePlaceholderProps) {
  return (
    <Stack spacing={2}>
      <Typography variant="h1">{title}</Typography>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography color="text.secondary">This screen is built in {phase}.</Typography>
        {children}
      </Paper>
    </Stack>
  );
}
