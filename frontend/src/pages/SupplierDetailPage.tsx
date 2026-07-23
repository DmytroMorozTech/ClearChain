import { useParams } from 'react-router';

import { PagePlaceholder } from '../components/PagePlaceholder.tsx';

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PagePlaceholder title="Supplier" phase="Phase 9">
      {id}
    </PagePlaceholder>
  );
}
