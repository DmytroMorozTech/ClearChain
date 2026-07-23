import { createTheme } from '@mui/material/styles';

/**
 * Risk colours are functional, not decorative: they encode a value the user has to
 * read correctly, so they live outside the brand palette and never change with it.
 * Deliberately the conventional traffic-light hues — this is not the place to be
 * original.
 */
export const RISK_COLORS = {
  GREEN: '#16A34A',
  YELLOW: '#EAB308',
  RED: '#DC2626',
} as const;

export type RiskLevel = keyof typeof RISK_COLORS;

/** Colour alone must never be the only signal; pair these with the label. */
export const RISK_LABELS: Record<RiskLevel, string> = {
  GREEN: 'Low',
  YELLOW: 'Medium',
  RED: 'High',
};

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#4F46E5' },
    secondary: { main: '#7C3AED' },
    background: { default: '#F9FAFB', paper: '#FFFFFF' },
    success: { main: RISK_COLORS.GREEN },
    warning: { main: RISK_COLORS.YELLOW },
    error: { main: RISK_COLORS.RED },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h1: { fontSize: '1.75rem', fontWeight: 650, letterSpacing: '-0.01em' },
    h2: { fontSize: '1.25rem', fontWeight: 620 },
    h3: { fontSize: '1.05rem', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600 } },
    },
  },
});
