import type { CertificateType, SupplierCategory } from './api/schemas.ts';

/**
 * Enum values are storage identifiers, not prose. Everything the user reads is mapped
 * here so a screen never shows RAW_MATERIAL or ISO_14001 to a person.
 */
export const CATEGORY_LABELS: Record<SupplierCategory, string> = {
  RAW_MATERIAL: 'Raw material',
  MANUFACTURING: 'Manufacturing',
  LOGISTICS: 'Logistics',
};

export const CERTIFICATE_LABELS: Record<CertificateType, string> = {
  CSRD: 'CSRD',
  LKSG: 'LkSG',
  EUDR: 'EUDR',
  CBAM: 'CBAM',
  ISO_14001: 'ISO 14001',
  SA8000: 'SA8000',
  OEKO_TEX: 'OEKO-TEX',
};

export const STATUS_LABELS = {
  VALID: 'Valid',
  EXPIRING_SOON: 'Expiring soon',
  EXPIRED: 'Expired',
  MISSING: 'Not held',
} as const;

/** Renders a `YYYY-MM-DD` calendar date without letting a timezone shift the day. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (year === undefined || month === undefined || day === undefined) return isoDate;
  return `${day}.${month}.${year}`;
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatCountdown(days: number): string {
  if (days < 0) return `${String(Math.abs(days))} days ago`;
  if (days === 0) return 'today';
  return `in ${String(days)} days`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
