import { AppError } from '../http/errors.ts';

/**
 * What may be uploaded, and how we decide.
 *
 * The `Content-Type` a client declares is just a string it chose; it is not evidence of
 * anything. Every upload is therefore sniffed by its leading bytes, and a file whose
 * real format disagrees with its declared type is rejected rather than trusted.
 */
export const ALLOWED_MIME_TYPES = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_MIME_TYPES;

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, value);
}

export function extensionFor(mimeType: AllowedMimeType): string {
  return ALLOWED_MIME_TYPES[mimeType];
}

const SIGNATURES: ReadonlyArray<{ mimeType: AllowedMimeType; magic: readonly number[] }> = [
  { mimeType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mimeType: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
];

/** Returns the real type of the buffer, or null if it is not one we accept. */
export function sniffMimeType(buffer: Buffer): AllowedMimeType | null {
  for (const { mimeType, magic } of SIGNATURES) {
    if (buffer.length < magic.length) continue;
    if (magic.every((byte, index) => buffer[index] === byte)) {
      return mimeType;
    }
  }
  return null;
}

/**
 * The real type of an upload, checked against what the client declared. Shared by every
 * route that accepts a file, so the rule cannot drift between them.
 */
export function assertAcceptedFile(buffer: Buffer, declaredMimeType: string): AllowedMimeType {
  const actual = sniffMimeType(buffer);
  if (actual === null) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Only PDF, PNG and JPEG files are accepted. The uploaded file is none of these.',
    );
  }
  // Browsers and curl disagree about JPEG; treat the historical spelling as equivalent.
  const matches =
    declaredMimeType === actual || (actual === 'image/jpeg' && declaredMimeType === 'image/jpg');
  if (!matches) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      `File content is ${actual} but was declared as ${declaredMimeType}.`,
    );
  }
  return actual;
}

/**
 * Makes an uploaded filename safe to put in a Content-Disposition header.
 *
 * Only ever used for display: it never contributes to a storage path, so this is about
 * header injection (quotes, CR/LF) rather than traversal.
 */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/[\r\n"\\]/g, '').replace(/[/\\]/g, '_');
  const trimmed = base.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : 'certificate';
}
