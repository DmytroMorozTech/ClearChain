import { Router } from 'express';

import {
  deleteCertificate,
  getCertificate,
  listCertificates,
} from '../../services/certificateService.ts';
import { sanitizeFileName } from '../../storage/contentTypes.ts';
import { getStorage } from '../../storage/index.ts';
import { idParamSchema, listCertificatesQuerySchema } from '../schemas.ts';
import { serializeCertificate } from '../serializers.ts';
import { parseParams, parseQuery } from '../validate.ts';

export const certificatesRouter: Router = Router();

const asOf = (): Date => new Date();

const SIGNED_URL_TTL_SECONDS = 300;

certificatesRouter.get('/', async (req, res) => {
  const query = parseQuery(req, listCertificatesQuerySchema);
  const asOfDate = asOf();

  const { rows, total } = await listCertificates(
    {
      supplierId: query.supplierId,
      type: query.type,
      status: query.status,
      expiringWithinDays: query.expiringWithinDays,
    },
    { page: query.page, pageSize: query.pageSize },
    asOfDate,
  );

  res.json({
    data: rows.map((certificate) => ({
      ...serializeCertificate(certificate, asOfDate),
      supplier: certificate.supplier,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  });
});

certificatesRouter.get('/:id', async (req, res) => {
  const { id } = parseParams(req, idParamSchema);
  const certificate = await getCertificate(id);

  res.json(serializeCertificate(certificate, asOf()));
});

/**
 * One route, both drivers.
 *
 * S3 answers with a short-lived URL and this becomes a redirect; the local driver
 * returns null and the bytes are streamed from here. The frontend calls the same path
 * either way and never learns which storage backend is configured.
 *
 * The headers are the security-relevant part. Without `attachment` and `nosniff`, an
 * uploaded SVG or HTML file would render in the API's own origin, turning file upload
 * into stored XSS. Content-Type comes from the allowlist the file was validated
 * against, never from anything the client said.
 */
certificatesRouter.get('/:id/file', async (req, res, next) => {
  const { id } = parseParams(req, idParamSchema);
  const certificate = await getCertificate(id);
  const storage = getStorage();

  const signedUrl = await storage.getSignedUrl(certificate.storageKey, SIGNED_URL_TTL_SECONDS);
  if (signedUrl !== null) {
    res.redirect(302, signedUrl);
    return;
  }

  res.setHeader('Content-Type', certificate.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${sanitizeFileName(certificate.fileName)}"`,
  );
  res.setHeader('Content-Length', String(certificate.fileSize));

  const stream = await storage.getStream(certificate.storageKey);
  stream.on('error', next);
  stream.pipe(res);
});

certificatesRouter.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParamSchema);
  await deleteCertificate(id);
  res.status(204).send();
});
