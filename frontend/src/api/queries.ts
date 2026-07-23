import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, toQuery } from './client.ts';
import {
  certificateWithSupplierSchema,
  chainSchema,
  countrySchema,
  dashboardSchema,
  healthSchema,
  paginated,
  supplierDetailSchema,
  supplierSummarySchema,
  syncLogSchema,
  syncOutcomeSchema,
} from './schemas.ts';
import { z } from 'zod';

/**
 * Query keys are declared once so that a mutation can invalidate exactly what it
 * affected. Almost every write moves a risk score somewhere, and risk rolls up the
 * chain, so most invalidations are deliberately broad.
 */
export const queryKeys = {
  health: ['health'] as const,
  dashboard: ['dashboard'] as const,
  chain: ['chain'] as const,
  suppliers: (params: SupplierListParams) => ['suppliers', params] as const,
  supplier: (id: string) => ['supplier', id] as const,
  certificates: (params: CertificateListParams) => ['certificates', params] as const,
  syncLogs: ['sync-logs'] as const,
  countries: ['countries'] as const,
};

export interface SupplierListParams {
  search?: string;
  tier?: number;
  riskLevel?: string;
  countryCode?: string;
  category?: string;
  compliant?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface CertificateListParams {
  supplierId?: string;
  type?: string;
  status?: string;
  expiringWithinDays?: number;
  page?: number;
  pageSize?: number;
}

export const useHealth = () =>
  useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.get('/health', healthSchema, signal),
    refetchInterval: 30_000,
  });

export const useDashboard = () =>
  useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => api.get('/dashboard', dashboardSchema, signal),
  });

export const useChain = () =>
  useQuery({
    queryKey: queryKeys.chain,
    queryFn: ({ signal }) => api.get('/chain', chainSchema, signal),
  });

export const useSuppliers = (params: SupplierListParams) =>
  useQuery({
    queryKey: queryKeys.suppliers(params),
    queryFn: ({ signal }) =>
      api.get(`/suppliers${toQuery({ ...params })}`, paginated(supplierSummarySchema), signal),
    placeholderData: (previous) => previous,
  });

export const useSupplier = (id: string) =>
  useQuery({
    queryKey: queryKeys.supplier(id),
    queryFn: ({ signal }) => api.get(`/suppliers/${id}`, supplierDetailSchema, signal),
    enabled: id !== '',
  });

export const useCertificates = (params: CertificateListParams) =>
  useQuery({
    queryKey: queryKeys.certificates(params),
    queryFn: ({ signal }) =>
      api.get(
        `/certificates${toQuery({ ...params })}`,
        paginated(certificateWithSupplierSchema),
        signal,
      ),
    placeholderData: (previous) => previous,
  });

export const useSyncLogs = () =>
  useQuery({
    queryKey: queryKeys.syncLogs,
    queryFn: ({ signal }) =>
      api.get('/erp/sync-logs?limit=10', z.object({ data: z.array(syncLogSchema) }), signal),
  });

export const useCountries = () =>
  useQuery({
    queryKey: queryKeys.countries,
    queryFn: ({ signal }) =>
      api.get('/reference/countries', z.object({ data: z.array(countrySchema) }), signal),
    staleTime: Infinity, // Reference data; it does not change while the app is open.
  });

/** Everything a sync touches: suppliers, the chain, every aggregate, and the log. */
function useInvalidateEverything() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries();
  };
}

export const useRunErpSync = () => {
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: () => api.post('/erp/sync', syncOutcomeSchema),
    onSuccess: invalidate,
  });
};

export const useUploadCertificate = () => {
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: ({ supplierId, form }: { supplierId: string; form: FormData }) =>
      api.post(`/suppliers/${supplierId}/certificates`, z.unknown(), form),
    onSuccess: invalidate,
  });
};

export const useDeleteCertificate = () => {
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/certificates/${id}`),
    onSuccess: invalidate,
  });
};
