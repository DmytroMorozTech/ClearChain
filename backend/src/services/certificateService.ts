import type { CertificateType, Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.ts';
import { deriveCertificateStatus } from '../domain/certificateStatus.ts';
import { AppError, notFound } from '../http/errors.ts';
import { buildCertificateKey, getStorage } from '../storage/index.ts';
import { type AllowedMimeType, sniffMimeType } from '../storage/contentTypes.ts';

export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
  declaredMimeType: string;
}

export interface CreateCertificateInput {
  type: CertificateType;
  issueDate: Date;
  expiryDate: Date;
  issuer?: string | null;
  certificateNumber?: string | null;
}

/**
 * Stores the file, then records it.
 *
 * There is no transaction spanning a filesystem and a database, so one of the two has
 * to go first and the other has to be able to undo. Writing the object first and
 * compensating on a failed insert is the safer order: the failure mode is an orphaned
 * blob nobody references, whereas the reverse order risks a row pointing at a file that
 * does not exist — which every read path would then have to defend against.
 */
export async function createCertificate(
  supplierId: string,
  input: CreateCertificateInput,
  file: UploadedFile,
) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true },
  });
  if (supplier === null) throw notFound('Supplier');

  const actualMimeType = sniffMimeType(file.buffer);
  if (actualMimeType === null) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Only PDF, PNG and JPEG files are accepted. The uploaded file is none of these.',
    );
  }
  if (!declaredMatches(file.declaredMimeType, actualMimeType)) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      `File content is ${actualMimeType} but was declared as ${file.declaredMimeType}.`,
    );
  }

  const storage = getStorage();
  const storageKey = buildCertificateKey(supplierId, actualMimeType);

  await storage.put(storageKey, file.buffer, actualMimeType);

  try {
    return await prisma.certificate.create({
      data: {
        supplierId,
        type: input.type,
        issueDate: input.issueDate,
        expiryDate: input.expiryDate,
        issuer: input.issuer ?? null,
        certificateNumber: input.certificateNumber ?? null,
        storageKey,
        fileName: file.originalName,
        mimeType: actualMimeType,
        fileSize: file.buffer.byteLength,
      },
    });
  } catch (error) {
    // Compensating action: the row never existed, so neither should the object.
    await storage.delete(storageKey).catch((cleanupError: unknown) => {
      console.error('Failed to clean up orphaned object', storageKey, cleanupError);
    });
    throw error;
  }
}

function declaredMatches(declared: string, actual: AllowedMimeType): boolean {
  if (declared === actual) return true;
  // Browsers and curl disagree about JPEG; treat the historical spelling as equivalent.
  return actual === 'image/jpeg' && declared === 'image/jpg';
}

export async function getCertificate(id: string) {
  const certificate = await prisma.certificate.findUnique({ where: { id } });
  if (certificate === null) throw notFound('Certificate');
  return certificate;
}

/**
 * Removes the row first, the object second.
 *
 * If the object delete fails the result is an unreferenced file, which is inert. The
 * opposite order would leave a row whose file is gone — a broken download for every
 * client that reads it.
 */
export async function deleteCertificate(id: string): Promise<void> {
  const certificate = await prisma.certificate.findUnique({
    where: { id },
    select: { id: true, storageKey: true },
  });
  if (certificate === null) throw notFound('Certificate');

  await prisma.certificate.delete({ where: { id } });

  await getStorage()
    .delete(certificate.storageKey)
    .catch((error: unknown) => {
      console.error('Certificate row deleted but object remains', certificate.storageKey, error);
    });
}

export interface CertificateFilters {
  supplierId?: string | undefined;
  type?: CertificateType | undefined;
  status?: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | undefined;
  expiringWithinDays?: number | undefined;
}

export async function listCertificates(
  filters: CertificateFilters,
  pagination: { page: number; pageSize: number },
  asOfDate: Date,
) {
  const where: Prisma.CertificateWhereInput = {
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };

  const certificates = await prisma.certificate.findMany({
    where,
    include: { supplier: { select: { id: true, name: true, tier: true } } },
    orderBy: [{ expiryDate: 'asc' }],
  });

  // Status is derived, so it cannot be a SQL predicate without duplicating the rule in
  // two places. Filtering here keeps one definition of "expiring soon".
  const matched = certificates.filter((certificate) => {
    const { status, daysUntilExpiry } = deriveCertificateStatus(certificate.expiryDate, asOfDate);
    if (filters.status && status !== filters.status) return false;
    if (
      filters.expiringWithinDays !== undefined &&
      !(daysUntilExpiry >= 0 && daysUntilExpiry <= filters.expiringWithinDays)
    ) {
      return false;
    }
    return true;
  });

  const start = (pagination.page - 1) * pagination.pageSize;
  return {
    rows: matched.slice(start, start + pagination.pageSize),
    total: matched.length,
  };
}
