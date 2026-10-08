/**
 * Routes that stay open in read-only demo mode even though they are POSTs.
 *
 * Extraction writes no certificate and stores no file — only a row in the attempt log —
 * so blocking it would hide the feature from exactly the visitors the demo is for.
 * Kept free of env so the rule can be unit-tested.
 */
const EXTRACT_PATH = /^\/suppliers\/[^/]+\/certificates\/extract$/;

export function isReadonlyExempt(method: string, path: string): boolean {
  return method === 'POST' && EXTRACT_PATH.test(path);
}
