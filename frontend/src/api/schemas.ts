import { z } from 'zod';

/**
 * The API contract, restated on the client and enforced at runtime.
 *
 * Types alone would be a promise nobody checks: they vanish at build time, so a backend
 * that changed shape would surface as `undefined` somewhere deep in a component. Parsing
 * each response means drift fails loudly, at the boundary, naming the field.
 */

export const riskLevelSchema = z.enum(['GREEN', 'YELLOW', 'RED']);
export const certificateStatusSchema = z.enum(['VALID', 'EXPIRING_SOON', 'EXPIRED']);
export const supplierCategorySchema = z.enum(['RAW_MATERIAL', 'MANUFACTURING', 'LOGISTICS']);
export const certificateTypeSchema = z.enum([
  'CSRD',
  'LKSG',
  'EUDR',
  'CBAM',
  'ISO_14001',
  'SA8000',
  'OEKO_TEX',
]);

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export const countrySchema = z.object({
  code: z.string(),
  name: z.string(),
  band: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  baseScore: z.number(),
});

export const riskFactorSchema = z.object({
  code: z.string(),
  label: z.string(),
  points: z.number(),
  detail: z.string(),
});

export const riskSchema = z.object({
  score: z.number(),
  level: riskLevelSchema,
  factors: z.array(riskFactorSchema),
});

export const requirementSchema = z.object({
  type: certificateTypeSchema,
  status: z.union([certificateStatusSchema, z.literal('MISSING')]),
  daysUntilExpiry: z.number().nullable(),
});

export const certificateSchema = z.object({
  id: z.string(),
  supplierId: z.string(),
  type: certificateTypeSchema,
  issuer: z.string().nullable(),
  certificateNumber: z.string().nullable(),
  issueDate: z.string(),
  expiryDate: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSize: z.number(),
  status: certificateStatusSchema,
  daysUntilExpiry: z.number(),
  createdAt: z.string(),
});

export const certificateWithSupplierSchema = certificateSchema.extend({
  supplier: z.object({ id: z.string(), name: z.string(), tier: z.number() }),
});

export const supplierSummarySchema = z.object({
  id: z.string(),
  externalId: z.string().nullable(),
  name: z.string(),
  countryCode: z.string(),
  country: countrySchema.nullable(),
  tier: z.number(),
  category: supplierCategorySchema,
  contactEmail: z.string().nullable(),
  isActive: z.boolean(),
  sourceSystem: z.enum(['MANUAL', 'ERP']),
  parentSupplierId: z.string().nullable(),
  riskLevel: riskLevelSchema.nullable(),
  riskScore: z.number().nullable(),
  isCompliant: z.boolean(),
  certificateCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const supplierDetailSchema = supplierSummarySchema.extend({
  risk: riskSchema.nullable(),
  requirements: z.array(requirementSchema),
  ancestors: z.array(z.object({ id: z.string(), name: z.string() })),
  children: z.array(
    z.object({ id: z.string(), name: z.string(), tier: z.number(), countryCode: z.string() }),
  ),
  certificates: z.array(certificateSchema),
});

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  });
}

export const syncLogSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceFileHash: z.string().nullable(),
  status: z.enum(['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  recordsRead: z.number(),
  recordsCreated: z.number(),
  recordsUpdated: z.number(),
  recordsUnchanged: z.number(),
  recordsRejected: z.number(),
  recordsNotInFeed: z.number(),
});

export const syncOutcomeSchema = z.object({
  logId: z.string(),
  status: z.enum(['SUCCESS', 'PARTIAL', 'FAILED']),
  recordsRead: z.number(),
  recordsCreated: z.number(),
  recordsUpdated: z.number(),
  recordsUnchanged: z.number(),
  recordsRejected: z.number(),
  recordsNotInFeed: z.number(),
  rejections: z.array(
    z.object({
      externalId: z.string().nullable(),
      reason: z.string(),
      detail: z.string(),
    }),
  ),
});

export const dashboardSchema = z.object({
  company: z.object({ name: z.string() }),
  suppliers: z.object({
    total: z.number(),
    compliant: z.number(),
    compliantPercentage: z.number(),
    byRiskLevel: z.array(z.object({ level: riskLevelSchema, count: z.number() })),
    byTier: z.array(z.object({ tier: z.number(), count: z.number() })),
  }),
  certificates: z.object({
    total: z.number(),
    expiringSoon: z.number(),
    expired: z.number(),
    expiryWindowDays: z.number(),
  }),
  lastSync: syncLogSchema.nullable(),
});

export const chainNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['company', 'supplier']),
  name: z.string(),
  tier: z.number(),
  countryCode: z.string().nullable(),
  countryName: z.string().nullable(),
  category: supplierCategorySchema.nullable(),
  riskLevel: riskLevelSchema.nullable(),
  riskScore: z.number().nullable(),
  isCompliant: z.boolean().nullable(),
  certificateCount: z.number().nullable(),
  isActive: z.boolean(),
});

export const chainSchema = z.object({
  company: z.object({ id: z.string(), name: z.string() }),
  nodes: z.array(chainNodeSchema),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() })),
});

export const healthSchema = z.object({
  status: z.string(),
  db: z.enum(['up', 'down']),
  version: z.string(),
});

export type Health = z.infer<typeof healthSchema>;
export type Country = z.infer<typeof countrySchema>;
export type Risk = z.infer<typeof riskSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type Certificate = z.infer<typeof certificateSchema>;
export type CertificateWithSupplier = z.infer<typeof certificateWithSupplierSchema>;
export type SupplierSummary = z.infer<typeof supplierSummarySchema>;
export type SupplierDetail = z.infer<typeof supplierDetailSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type ChainNode = z.infer<typeof chainNodeSchema>;
export type Chain = z.infer<typeof chainSchema>;
export type SyncLog = z.infer<typeof syncLogSchema>;
export type SyncOutcome = z.infer<typeof syncOutcomeSchema>;
export type CertificateStatus = z.infer<typeof certificateStatusSchema>;
export type SupplierCategory = z.infer<typeof supplierCategorySchema>;
export type CertificateType = z.infer<typeof certificateTypeSchema>;
