import multer from 'multer';

import { env } from '../config/env.ts';

/**
 * Uploads are held in memory, not written to a temp directory first.
 *
 * At a 5 MB ceiling the memory cost is trivial, and it means a rejected upload — wrong
 * type, oversized, bad dates — leaves nothing on disk to clean up. The file only
 * reaches storage after it has passed every check.
 */
export const uploadCertificateFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
}).single('file');
