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

/**
 * The one line between the mobile layout and the desktop one.
 *
 * Below it: bottom navigation, cards instead of tables, collapsed filters. At or above
 * it: the full desktop UI. A single breakpoint means a single mental model and a single
 * thing to test — the alternative, a different threshold per screen, is where responsive
 * layouts start disagreeing with themselves.
 *
 * `md` (900px) puts portrait tablets on the card layout. That is intended: a
 * seven-column table is not comfortable at 768px either.
 */
export const MOBILE_BREAKPOINT = 'md';

/** The `md` breakpoint in pixels, for the media queries below that cannot see the theme. */
const MD = 900;

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
    // Typography variants are plain style objects, so the breakpoint is written out
    // rather than read from `theme.breakpoints`. It is the `md` value above.
    h1: {
      fontSize: '1.5rem',
      fontWeight: 650,
      letterSpacing: '-0.01em',
      [`@media (min-width:${String(MD)}px)`]: { fontSize: '1.75rem' },
    },
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
    /**
     * iOS Safari zooms the viewport whenever a focused input renders below 16px, and it
     * does not zoom back out afterwards. Every filter field on this app is
     * `size="small"`, which is 14px — so tapping the supplier search would leave the
     * user stranded at 1.3× with no way back except a pinch.
     *
     * Fixed here rather than per-field so a new form cannot reintroduce it, and fixed
     * this way rather than with `maximum-scale=1` on the viewport meta: that is the
     * usual one-line answer, and it disables pinch zoom for everyone, which fails
     * WCAG 1.4.4.
     */
    MuiInputBase: {
      styleOverrides: {
        input: ({ theme }) => ({
          [theme.breakpoints.down(MOBILE_BREAKPOINT)]: { fontSize: 16 },
        }),
      },
    },
    /**
     * `size="small"` renders a 30px target. WCAG 2.5.8 sets the floor at 24px, but the
     * download and delete buttons sit adjacent in one cell, where 30px means mis-taps.
     * Both platform guidelines say 44–48px.
     */
    MuiIconButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          [theme.breakpoints.down(MOBILE_BREAKPOINT)]: { minWidth: 44, minHeight: 44 },
        }),
      },
    },
    // Touch has no hover, so a tooltip only appears on long-press — and only if it does
    // not wait first. Anything a tooltip is the *sole* carrier of is written into the
    // layout instead; this just stops the rest from being unreachable.
    MuiTooltip: {
      defaultProps: { enterTouchDelay: 0, leaveTouchDelay: 4000 },
    },
  },
});
