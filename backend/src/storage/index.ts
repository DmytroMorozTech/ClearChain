import { randomUUID } from 'node:crypto';

import { env } from '../config/env.ts';
import { type AllowedMimeType, extensionFor } from './contentTypes.ts';
import { LocalFileStorage } from './localDriver.ts';
import { S3FileStorage } from './s3Driver.ts';
import type { FileStorage } from './types.ts';

let instance: FileStorage | null = null;

/**
 * Selects a driver from STORAGE_DRIVER alone. NODE_ENV deliberately plays no part:
 * tying storage to the environment name is what makes the S3 path untestable anywhere
 * but production.
 */
export function getStorage(): FileStorage {
  if (instance !== null) return instance;

  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET || !env.S3_REGION) {
      throw new Error('STORAGE_DRIVER=s3 requires both S3_BUCKET and S3_REGION to be set.');
    }
    instance = new S3FileStorage(env.S3_BUCKET, env.S3_REGION);
  } else {
    instance = new LocalFileStorage(env.UPLOAD_DIR);
  }

  return instance;
}

/** Test seam; also lets a driver change take effect without restarting the process. */
export function resetStorage(): void {
  instance = null;
}

/**
 * Builds a storage key from server-controlled parts only.
 *
 * The uploaded filename never appears here. It is kept as data on the row for display,
 * but letting it reach a path is how `../../etc/passwd` becomes a write primitive.
 */
export function buildCertificateKey(supplierId: string, mimeType: AllowedMimeType): string {
  return `certificates/${supplierId}/${randomUUID()}${extensionFor(mimeType)}`;
}

export type { FileStorage } from './types.ts';
