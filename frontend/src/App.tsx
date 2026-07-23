import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router';

import { useSession } from './api/queries.ts';
import { AppLayout } from './components/AppLayout.tsx';
import { CertificatesPage } from './pages/CertificatesPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { SupplierDetailPage } from './pages/SupplierDetailPage.tsx';
import { SuppliersPage } from './pages/SuppliersPage.tsx';

/**
 * The chain map is the only screen that needs react-flow, and react-flow is the single
 * heaviest dependency in the bundle. Splitting it here keeps that weight off the first
 * paint of every other screen, which is where it would otherwise be paid.
 */
const ChainPage = lazy(async () => {
  const module = await import('./pages/ChainPage.tsx');
  return { default: module.ChainPage };
});

function RouteFallback() {
  return (
    <Stack sx={{ alignItems: 'center', py: 8 }}>
      <CircularProgress size={26} />
    </Stack>
  );
}

export default function App() {
  const session = useSession();

  // First load: neither signed in nor signed out yet. Rendering the login form here
  // would flash it at someone who already has a valid session.
  if (session.isPending) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  // The guard is here rather than on each route: a screen added later is behind it by
  // default, which mirrors how the API mounts its own session check.
  if (session.isError || session.data === undefined) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="suppliers/:id" element={<SupplierDetailPage />} />
        <Route
          path="chain"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ChainPage />
            </Suspense>
          }
        />
        <Route path="certificates" element={<CertificatesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
