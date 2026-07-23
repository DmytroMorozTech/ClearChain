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
