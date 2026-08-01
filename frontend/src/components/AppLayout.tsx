import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { LogOut, ShieldCheck } from 'lucide-react';
import { NavLink, Outlet, Link as RouterLink } from 'react-router';

import { useHealth, useLogout, useSession } from '../api/queries.ts';
import { NAV_ITEMS } from '../nav.ts';
import { MOBILE_BREAKPOINT } from '../theme.ts';
import { BOTTOM_NAV_HEIGHT, MobileNav } from './MobileNav.tsx';

function HealthDot() {
  const { data, isError } = useHealth();
  const down = isError || data?.db === 'down';

  return (
    <Tooltip
      title={down ? 'API unreachable or database down' : `API healthy · v${data?.version ?? '?'}`}
    >
      <Box
        component="span"
        aria-label={down ? 'API unhealthy' : 'API healthy'}
        sx={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: down ? '#DC2626' : '#16A34A',
        }}
      />
    </Tooltip>
  );
}

function SessionControl() {
  const session = useSession();
  const logout = useLogout();

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ display: { xs: 'none', sm: 'block' } }}
      >
        {session.data?.user ?? ''}
      </Typography>
      <Tooltip title="Sign out">
        <Button
          size="small"
          onClick={() => {
            logout.mutate();
          }}
          disabled={logout.isPending}
          startIcon={<LogOut size={16} />}
          sx={{ color: 'text.secondary', flexShrink: 0, minWidth: 0 }}
        >
          Sign out
        </Button>
      </Tooltip>
    </Stack>
  );
}

/**
 * Two navigations, one set of destinations.
 *
 * The toolbar cannot wrap — it is a `nowrap` flex row — so on a phone the brand, four
 * labelled links, the health dot and sign-out simply ran off the right edge. Below `md`
 * the links move to a bottom bar and the toolbar keeps only what identifies the app and
 * its state.
 */
export function AppLayout() {
  const theme = useTheme();
  // `noSsr` resolves the query before the first paint. Without it the hook reports
  // `false` initially and the desktop toolbar flashes in before being replaced.
  const isMobile = useMediaQuery(theme.breakpoints.down(MOBILE_BREAKPOINT), { noSsr: true });

  return (
    <Box sx={{ minHeight: '100dvh', backgroundColor: 'background.default' }}>
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar sx={{ gap: { xs: 1, md: 3 } }}>
          <Link
            component={RouterLink}
            to="/"
            underline="none"
            color="inherit"
            aria-label="ClearChain — go to the dashboard"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              mr: { md: 1 },
              minWidth: 0,
              borderRadius: 1,
              transition: 'opacity 120ms',
              '&:hover': { opacity: 0.7 },
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          >
            <ShieldCheck size={26} color="#4F46E5" strokeWidth={2.2} aria-hidden />
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              ClearChain
            </Typography>
          </Link>

          {isMobile ? (
            <Box sx={{ flexGrow: 1 }} />
          ) : (
            <Stack direction="row" spacing={0.5} component="nav" sx={{ flexGrow: 1 }}>
              {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
                <Button
                  key={to}
                  component={NavLink}
                  to={to}
                  end={end}
                  startIcon={<Icon size={17} />}
                  sx={{
                    color: 'text.secondary',
                    px: 1.5,
                    '&.active': {
                      color: 'primary.main',
                      backgroundColor: 'rgba(79, 70, 229, 0.08)',
                    },
                  }}
                >
                  {label}
                </Button>
              ))}
            </Stack>
          )}

          <HealthDot />
          <SessionControl />
        </Toolbar>
      </AppBar>

      <Container
        maxWidth="xl"
        sx={{
          pt: { xs: 2, md: 4 },
          // Clears the fixed bottom bar plus the home indicator. Expressed as a
          // breakpoint value rather than off `isMobile`, so the spacing is correct even
          // for the frame in which the media query has not resolved.
          pb: {
            xs: `calc(${String(BOTTOM_NAV_HEIGHT)}px + env(safe-area-inset-bottom) + 16px)`,
            md: 4,
          },
        }}
      >
        <Outlet />
      </Container>

      {isMobile && <MobileNav />}
    </Box>
  );
}
