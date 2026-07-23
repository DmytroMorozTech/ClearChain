import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { FileCheck, Factory, LayoutDashboard, Network, ShieldCheck } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

import { useHealth } from '../api/queries.ts';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/suppliers', label: 'Suppliers', icon: Factory, end: false },
  { to: '/chain', label: 'Supply chain', icon: Network, end: false },
  { to: '/certificates', label: 'Certificates', icon: FileCheck, end: false },
];

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
          backgroundColor: down ? '#DC2626' : '#16A34A',
        }}
      />
    </Tooltip>
  );
}

export function AppLayout() {
  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar sx={{ gap: 3 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mr: 1 }}>
            <ShieldCheck size={26} color="#4F46E5" strokeWidth={2.2} aria-hidden />
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              ClearChain
            </Typography>
          </Stack>

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

          <HealthDot />
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
