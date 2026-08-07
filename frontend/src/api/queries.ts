import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api, toQuery } from './client.ts';
import {
  certificateWithSupplierSchema,
  chainSchema,
  countryOptionSchema,
  dashboardSchema,
  paginated,
  sessionSchema,
  supplierDetailSchema,
  supplierListSchema,
  type Session,
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
  session: ['session'] as const,
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

/**
 * The gate the app checks on load.
 *
 * A 401 from /auth/me is the *answer*, not a failure: it means nobody is signed in,
 * which is an ordinary state this screen exists to handle. Modelling it as a query
 * error was the mistake behind two separate bugs — an error state the gate reacted to
 * only indirectly, and a refetch loop where the query's own failure re-triggered it.
 * Returning null instead makes "signed out" a value the gate can read directly.
 */
export async function fetchSession(signal?: AbortSignal): Promise<Session | null> {
  try {
    return await api.get('/auth/me', sessionSchema, signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    // Anything else — a network failure, a 500 — really is a failure, and the gate
    // should not quietly report it as "signed out".
    throw error;
  }
}

export const useSession = () =>
  useQuery({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => fetchSession(signal),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

export const useLogin = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      api.post('/auth/login', sessionSchema, credentials),
    onSuccess: (session) => {
      client.setQueryData(queryKeys.session, session);
      void client.invalidateQueries();
    },
  });
};

export const useLogout = () => {
  const client = useQueryClient();
  return useMutation({
    // 204, no body: `command` does not try to parse one.
    mutationFn: () => api.command('/auth/logout'),
    onSuccess: () => {
      // Written directly rather than invalidated, so the gate flips on this line
      // instead of after a round trip. Everything else is dropped because it was
      // fetched for a session that no longer exists; refetching it would only produce
      // a burst of 401s on the way to the sign-in screen.
      client.setQueryData(queryKeys.session, null);
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
      });
    },
  });
};

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
      api.get(`/suppliers${toQuery({ ...params })}`, supplierListSchema, signal),
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
      api.get('/reference/countries', z.object({ data: z.array(countryOptionSchema) }), signal),
    // The risk table itself is fixed, but the supplier counts riding with it are not: a
    // sync can land the first supplier in a country and add an option to the filter.
    // Refetching is left to the blanket invalidation a sync already performs.
    staleTime: Infinity,
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
