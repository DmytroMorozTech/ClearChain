import { Route, Routes } from 'react-router';

import { AppLayout } from './components/AppLayout.tsx';
import { CertificatesPage } from './pages/CertificatesPage.tsx';
import { ChainPage } from './pages/ChainPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { SupplierDetailPage } from './pages/SupplierDetailPage.tsx';
import { SuppliersPage } from './pages/SuppliersPage.tsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="suppliers/:id" element={<SupplierDetailPage />} />
        <Route path="chain" element={<ChainPage />} />
        <Route path="certificates" element={<CertificatesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
