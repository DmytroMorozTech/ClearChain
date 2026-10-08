import { describe, expect, it } from 'vitest';

import { MODEL_OUTPUT_JSON_SCHEMA, modelOutputSchema } from './schema.ts';

const valid = {
  isCertificate: true,
  type: 'ISO_14001',
  issuer: 'TÜV Nord',
  certificateNumber: 'ISO-123',
  issueDate: '2025-03-01',
  expiryDate: '2028-02-28',
  evidence: {
    type: 'DIN EN ISO 14001:2015',
    issuer: 'TÜV Nord',
    certificateNumber: 'Zertifikat-Nr. ISO-123',
    issueDate: 'Ausgestellt am 01.03.2025',
    expiryDate: 'gültig bis 28.02.2028',
  },
};

describe('modelOutputSchema', () => {
  it('accepts a well-formed output', () => {
    expect(modelOutputSchema.parse(valid)).toEqual(valid);
  });

  it('strips fields the schema does not know', () => {
    const parsed = modelOutputSchema.parse({
      ...valid,
      supplierName: 'x',
      evidence: { ...valid.evidence, extra: 'y' },
    });
    expect(parsed).not.toHaveProperty('supplierName');
    expect(parsed.evidence).not.toHaveProperty('extra');
  });

  it('rejects a type outside the enum', () => {
    expect(modelOutputSchema.safeParse({ ...valid, type: 'ISO_9001' }).success).toBe(false);
  });

  it('rejects output missing a required key', () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.issuer;
    expect(modelOutputSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts nulls everywhere a value may be absent', () => {
    const allNull = {
      isCertificate: false,
      type: null,
      issuer: null,
      certificateNumber: null,
      issueDate: null,
      expiryDate: null,
      evidence: {
        type: null,
        issuer: null,
        certificateNumber: null,
        issueDate: null,
        expiryDate: null,
      },
    };
    expect(modelOutputSchema.parse(allNull)).toEqual(allNull);
  });
});

describe('MODEL_OUTPUT_JSON_SCHEMA', () => {
  it('is strict at every object level and carries no $schema key', () => {
    expect(MODEL_OUTPUT_JSON_SCHEMA).not.toHaveProperty('$schema');
    expect(MODEL_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
    const props = MODEL_OUTPUT_JSON_SCHEMA.properties as Record<
      string,
      { additionalProperties?: unknown }
    >;
    expect(props.evidence?.additionalProperties).toBe(false);
  });
});
