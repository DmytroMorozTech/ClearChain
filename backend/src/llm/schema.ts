import { CertificateType } from '@prisma/client';
import { z } from 'zod';

/**
 * What the model is asked to return, and what we accept back.
 *
 * The same shape serves twice: as the JSON Schema the API constrains generation to, and
 * as the zod schema the server re-parses the reply with. The API's guarantee is not a
 * reason to skip the second check — the reply is still untrusted input.
 */
export const FIELD_NAMES = [
  'type',
  'issuer',
  'certificateNumber',
  'issueDate',
  'expiryDate',
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

const text = z.string().nullable();

const evidenceShape = {
  type: text,
  issuer: text,
  certificateNumber: text,
  issueDate: text,
  expiryDate: text,
};

const outputShape = {
  isCertificate: z.boolean(),
  type: z.enum(CertificateType).nullable(),
  issuer: text,
  certificateNumber: text,
  // Strings, not z.iso.date(): a malformed date must reach validate.ts as a value it can
  // drop with a warning, not fail the whole reply.
  issueDate: text,
  expiryDate: text,
};

/** Parsing schema: unknown keys are stripped rather than rejected. */
export const modelOutputSchema = z.object({ ...outputShape, evidence: z.object(evidenceShape) });

export type ModelOutput = z.infer<typeof modelOutputSchema>;

function strictJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(
    z.strictObject({ ...outputShape, evidence: z.strictObject(evidenceShape) }),
  ) as Record<string, unknown>;
  // A meta-schema reference is not part of the format the API constrains output to.
  delete schema.$schema;
  return schema;
}

/** Generation schema: strict, as structured outputs require `additionalProperties: false`. */
export const MODEL_OUTPUT_JSON_SCHEMA = strictJsonSchema();
