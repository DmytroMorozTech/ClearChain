/**
 * USD per million tokens, list price as of 2026-10. Used only for the eval's cost
 * estimate — keyed by the model id the eval was asked to run, because the API answers
 * with a dated snapshot id (e.g. claude-haiku-4-5-20251001).
 */
export const PRICING: Readonly<Record<string, { input: number; output: number }>> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};
