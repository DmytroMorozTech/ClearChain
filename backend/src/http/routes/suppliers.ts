import { Router } from 'express';

import {
  createSupplier,
  deleteSupplier,
  getSupplierDetail,
  listSuppliers,
  loadRiskIndex,
  updateSupplier,
} from '../../services/supplierService.js';
import { notFound } from '../errors.js';
import {
  createSupplierSchema,
  idParamSchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
} from '../schemas.js';
import {
  serializeRisk,
  serializeSupplierDetail,
  serializeSupplierSummary,
} from '../serializers.js';
import { parseBody, parseParams, parseQuery } from '../validate.js';

export const suppliersRouter: Router = Router();

/**
 * The clock is read exactly here, at the request boundary, and passed down. Nothing
 * below this line reaches for the current time, which is what makes the domain layer
 * deterministic and testable at a frozen date.
 */
const asOf = (): Date => new Date();

suppliersRouter.get('/', async (req, res) => {
  const query = parseQuery(req, listSuppliersQuerySchema);
  const asOfDate = asOf();

  const [field, direction] = query.sort.split(':') as [
    'name' | 'tier' | 'riskScore' | 'createdAt',
    'asc' | 'desc',
  ];

  const { rows, total } = await listSuppliers(
    {
      search: query.search,
      tier: query.tier,
      riskLevel: query.riskLevel,
      countryCode: query.countryCode,
      category: query.category,
      compliant: query.compliant,
      isActive: query.isActive,
    },
    { field, direction },
    { page: query.page, pageSize: query.pageSize },
    asOfDate,
  );

  res.json({
    data: rows.map(serializeSupplierSummary),
    page: query.page,
    pageSize: query.pageSize,
    total,
  });
});

suppliersRouter.post('/', async (req, res) => {
  const input = parseBody(req, createSupplierSchema);
  const created = await createSupplier(input);
  const detail = await getSupplierDetail(created.id, asOf());

  res.status(201).json(serializeSupplierDetail({ ...detail, asOfDate: asOf() }));
});

suppliersRouter.get('/:id', async (req, res) => {
  const { id } = parseParams(req, idParamSchema);
  const asOfDate = asOf();
  const detail = await getSupplierDetail(id, asOfDate);

  res.json(serializeSupplierDetail({ ...detail, asOfDate }));
});

/** Explainability is a feature, not a comment: the API returns the factor breakdown. */
suppliersRouter.get('/:id/risk', async (req, res) => {
  const { id } = parseParams(req, idParamSchema);
  const riskIndex = await loadRiskIndex(asOf());

  const risk = riskIndex.get(id);
  if (risk === undefined) throw notFound('Supplier');

  res.json(serializeRisk(risk));
});

suppliersRouter.patch('/:id', async (req, res) => {
  const { id } = parseParams(req, idParamSchema);
  const input = parseBody(req, updateSupplierSchema);

  await updateSupplier(id, input);
  const asOfDate = asOf();
  const detail = await getSupplierDetail(id, asOfDate);

  res.json(serializeSupplierDetail({ ...detail, asOfDate }));
});

suppliersRouter.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParamSchema);
  await deleteSupplier(id);
  res.status(204).send();
});
