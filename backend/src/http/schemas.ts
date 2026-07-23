import { z } from 'zod';

export const supplierCategorySchema = z.enum(['RAW_MATERIAL', 'MANUFACTURING', 'LOGISTICS']);
export const riskLevelSchema = z.enum(['GREEN', 'YELLOW', 'RED']);

const countryCodeSchema = z
  .string()
  .trim()
  .length(2, 'must be an ISO 3166-1 alpha-2 code')
  .transform((value) => value.toUpperCase());

const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const idParamSchema = z.object({
  id: z.uuid('must be a UUID'),
});

/**
 * `strictObject` rejects any property not listed here, which is what makes a
 * client-supplied `tier` a 400 rather than a silently ignored field. Tier is derived
 * from the supplier's position in the chain and is never accepted from a caller.
 */
export const createSupplierSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  countryCode: countryCodeSchema,
  category: supplierCategorySchema,
  contactEmail: z.email('must be a valid email address').nullish(),
  parentSupplierId: z.uuid('must be a UUID').nullish(),
  externalId: z.string().trim().min(1).max(64).nullish(),
  isActive: z.boolean().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const listSuppliersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  tier: z.coerce.number().int().min(1).max(3).optional(),
  riskLevel: riskLevelSchema.optional(),
  countryCode: countryCodeSchema.optional(),
  category: supplierCategorySchema.optional(),
  compliant: booleanQuerySchema.optional(),
  isActive: booleanQuerySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z
    .enum([
      'name:asc',
      'name:desc',
      'tier:asc',
      'tier:desc',
      'riskScore:asc',
      'riskScore:desc',
      'createdAt:asc',
      'createdAt:desc',
    ])
    .default('name:asc'),
});

export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

export const certificateTypeSchema = z.enum([
  'CSRD',
  'LKSG',
  'EUDR',
  'CBAM',
  'ISO_14001',
  'SA8000',
  'OEKO_TEX',
]);

export const certificateStatusSchema = z.enum(['VALID', 'EXPIRING_SOON', 'EXPIRED']);

/**
 * Calendar dates arrive as `YYYY-MM-DD` and become UTC midnight. Accepting a full
 * timestamp here would let a client's local offset decide which day a certificate
 * expires on.
 */
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar date in YYYY-MM-DD form')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), 'is not a real date');

export const createCertificateSchema = z
  .strictObject({
    type: certificateTypeSchema,
    issueDate: dateOnlySchema,
    expiryDate: dateOnlySchema,
    issuer: z.string().trim().min(1).max(200).optional(),
    certificateNumber: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.expiryDate > value.issueDate, {
    message: 'must be later than issueDate',
    path: ['expiryDate'],
  })
  .refine((value) => value.issueDate.getTime() <= Date.now(), {
    message: 'cannot be in the future',
    path: ['issueDate'],
  });

export const listCertificatesQuerySchema = z.object({
  supplierId: z.uuid().optional(),
  type: certificateTypeSchema.optional(),
  status: certificateStatusSchema.optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
