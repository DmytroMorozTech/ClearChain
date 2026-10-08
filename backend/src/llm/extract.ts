import type { AllowedMimeType } from '../storage/contentTypes.ts';
import { type LlmClient, LlmError, type LlmResult, toLlmError } from './client.ts';
import { modelOutputSchema } from './schema.ts';
import { type ValidatedExtraction, validateExtraction } from './validate.ts';

export interface ExtractionInput {
  buffer: Buffer;
  mimeType: AllowedMimeType;
  /** Text layer of the document, or null for images and scans. */
  documentText: string | null;
}

export interface ExtractionResult extends ValidatedExtraction {
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  /** For the eval only — never sent to a client or logged. */
  rawOutput: unknown;
}

/**
 * One request, one answer, then the checks. No retries of our own beyond the SDK's, no
 * second call to "repair" a bad answer: a reply that fails the schema is a failure the
 * user sees, and the form is still there to fill in by hand.
 */
export async function extractCertificateFields(
  input: ExtractionInput,
  client: LlmClient,
  asOf: Date,
): Promise<ExtractionResult> {
  const started = performance.now();

  let result: LlmResult;
  try {
    result = await client.extract({ buffer: input.buffer, mimeType: input.mimeType });
  } catch (error) {
    throw toLlmError(error);
  }

  const parsed = modelOutputSchema.safeParse(result.output);
  if (!parsed.success) throw new LlmError('invalid_output');

  return {
    ...validateExtraction(parsed.data, input.documentText, asOf),
    model: result.model,
    usage: result.usage,
    latencyMs: Math.round(performance.now() - started),
    rawOutput: result.output,
  };
}
