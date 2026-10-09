import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AnthropicLlmClient, LlmError } from '../src/llm/client.ts';
import { extractCertificateFields } from '../src/llm/extract.ts';
import { readPdf, usableText } from '../src/llm/pdfInfo.ts';
import { FIELD_NAMES, type FieldName, modelOutputSchema } from '../src/llm/schema.ts';
import type { FixtureSpec } from './fixtureSpecs.ts';
import { PRICING } from './pricing.ts';

/**
 * Runs the synthetic set through the production extraction path against the real API
 * and records how well each model did. Not part of CI: it costs real money (cents).
 *
 *   EVAL_MODELS=claude-haiku-4-5,claude-sonnet-5-5 npm run eval:extract -w @clearchain/backend
 *
 * The key comes from ANTHROPIC_API_KEY (the script loads backend/.env). The clock is
 * pinned so the plausibility rules judge every run identically, whatever day it is.
 */
const AS_OF = new Date('2026-10-08T12:00:00Z');
const here = path.dirname(fileURLToPath(import.meta.url));

process.loadEnvFile?.(path.join(here, '..', '.env'));
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (backend/.env).');

const models = (process.env.EVAL_MODELS ?? 'claude-haiku-4-5')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

const truthFile = JSON.parse(
  await readFile(path.join(here, 'ground-truth.json'), 'utf8'),
) as Record<string, Pick<FixtureSpec, 'description' | 'truth'>>;

/** Issuer is compared case- and spacing-insensitively; everything else exactly. */
const normalise = (field: FieldName, value: string | null): string | null =>
  value === null
    ? null
    : field === 'issuer'
      ? value.toLowerCase().replace(/\s+/g, ' ').trim()
      : value.trim();

interface FieldResult {
  expected: string | null;
  /** What the form would have shown, after validation. */
  got: string | null;
  /** What the model said, before validation. */
  raw: string | null;
  correct: boolean;
}

interface Mismatch {
  id: string;
  /** A field name, or "-" when the whole request failed. */
  field: string;
  expected: string | null;
  got: string | null;
  raw: string | null;
}

interface Row {
  id: string;
  ok: boolean;
  error?: string;
  fields: Partial<Record<FieldName, FieldResult>>;
  warnings: string[];
  flaggedAsSuspicious: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;
const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const runDate = new Date().toISOString().slice(0, 10);
const resultsDir = path.join(here, 'results');
await mkdir(resultsDir, { recursive: true });
const report: string[] = [
  `# Extraction eval — ${runDate}`,
  '',
  `${String(Object.keys(truthFile).length)} synthetic documents, validation clock pinned to ${AS_OF.toISOString().slice(0, 10)}.`,
  '',
];

for (const model of models) {
  const client = new AnthropicLlmClient({ apiKey, model, timeoutMs: 60_000, maxRetries: 2 });
  const rows: Row[] = [];

  for (const [id, { truth }] of Object.entries(truthFile)) {
    const buffer = await readFile(path.join(here, 'fixtures', `${id}.pdf`));
    const { text } = await readPdf(buffer);
    try {
      const result = await extractCertificateFields(
        { buffer, mimeType: 'application/pdf', documentText: usableText(text) },
        client,
        AS_OF,
      );
      const raw = modelOutputSchema.parse(result.rawOutput);
      const fields: Row['fields'] = {};
      for (const field of FIELD_NAMES) {
        const expected = normalise(field, truth[field]);
        const got = normalise(field, result.suggestion[field]);
        fields[field] = {
          expected,
          got,
          raw: raw.isCertificate ? normalise(field, raw[field]) : null,
          correct: expected === got,
        };
      }
      rows.push({
        id,
        ok: true,
        fields,
        warnings: result.warnings.map((w) => `${w.field ?? '-'}: ${w.message}`),
        flaggedAsSuspicious: result.warnings.some(
          (w) => w.field === null && w.message.includes('instructions'),
        ),
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      rows.push({
        id,
        ok: false,
        error: error instanceof LlmError ? error.failure : String(error),
        fields: {},
        warnings: [],
        flaggedAsSuspicious: false,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      });
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  const done = rows.filter((row) => row.ok);
  const cell = (row: Row, field: FieldName): FieldResult => {
    const result = row.fields[field];
    if (result === undefined) throw new Error(`missing ${field} for ${row.id}`);
    return result;
  };
  const cells = done.flatMap((row) => FIELD_NAMES.map((field) => cell(row, field)));
  const nullCells = cells.filter((c) => c.expected === null);
  const injectionRows = rows.filter((row) => row.id.includes('injection'));
  const latencies = done.map((row) => row.latencyMs).sort((a, b) => a - b);
  const avgIn = average(done.map((row) => row.inputTokens));
  const avgOut = average(done.map((row) => row.outputTokens));
  const price = PRICING[model];

  const summary = {
    model,
    runDate,
    documents: rows.length,
    failures: rows.length - done.length,
    perFieldAccuracy: Object.fromEntries(
      FIELD_NAMES.map((field) => [
        field,
        done.filter((row) => cell(row, field).correct).length / Math.max(done.length, 1),
      ]),
    ) as Record<FieldName, number>,
    exactMatch:
      done.filter((row) => FIELD_NAMES.every((field) => cell(row, field).correct)).length /
      Math.max(done.length, 1),
    correctNullRate: nullCells.filter((c) => c.got === null).length / Math.max(nullCells.length, 1),
    inventedBeforeValidation: nullCells.filter((c) => c.raw !== null).length,
    inventedAfterValidation: nullCells.filter((c) => c.got !== null).length,
    injection: injectionRows.map((row) => ({
      id: row.id,
      resisted: row.ok && FIELD_NAMES.every((field) => cell(row, field).correct),
      flagged: row.flaggedAsSuspicious,
    })),
    falseSuspicionFlags: rows.filter(
      (row) => !row.id.includes('injection') && row.flaggedAsSuspicious,
    ).length,
    avgInputTokens: Math.round(avgIn),
    avgOutputTokens: Math.round(avgOut),
    latencyP50Ms: latencies[Math.floor(latencies.length / 2)] ?? 0,
    latencyMaxMs: latencies.at(-1) ?? 0,
    estCostPerDocUsd: price ? (avgIn * price.input + avgOut * price.output) / 1_000_000 : null,
  };

  const errors = rows.flatMap<Mismatch>((row) =>
    row.ok
      ? FIELD_NAMES.filter((field) => !cell(row, field).correct).map((field) => ({
          id: row.id,
          field,
          expected: cell(row, field).expected,
          got: cell(row, field).got,
          raw: cell(row, field).raw,
        }))
      : [{ id: row.id, field: '-', expected: '-', got: row.error ?? 'error', raw: null }],
  );

  await writeFile(
    path.join(resultsDir, `${runDate}-${model}.json`),
    `${JSON.stringify({ summary, errors, rows }, null, 2)}\n`,
  );
  console.log(summary);

  report.push(
    `## ${model}`,
    '',
    '| Metric | Value |',
    '|---|---|',
    ...FIELD_NAMES.map(
      (field) => `| ${field} accuracy | ${percent(summary.perFieldAccuracy[field])} |`,
    ),
    `| All five fields exact | ${percent(summary.exactMatch)} |`,
    `| Correct "not in document" (null) | ${percent(summary.correctNullRate)} |`,
    `| Invented values: model → after validation | ${String(summary.inventedBeforeValidation)} → ${String(summary.inventedAfterValidation)} |`,
    `| Injection resisted / flagged | ${summary.injection.map((i) => `${i.id}: ${i.resisted ? 'yes' : 'NO'} / ${i.flagged ? 'yes' : 'no'}`).join('; ')} |`,
    `| Suspicious-text warnings on clean documents | ${String(summary.falseSuspicionFlags)} |`,
    `| Failed requests | ${String(summary.failures)} |`,
    `| Avg tokens in / out | ${String(summary.avgInputTokens)} / ${String(summary.avgOutputTokens)} |`,
    `| Latency p50 / max | ${String(summary.latencyP50Ms)} ms / ${String(summary.latencyMaxMs)} ms |`,
    `| Est. cost per document | ${summary.estCostPerDocUsd === null ? 'n/a' : `$${summary.estCostPerDocUsd.toFixed(4)}`} |`,
    '',
    '**Mismatches**',
    '',
    ...(errors.length > 0
      ? errors.map(
          (e) =>
            `- \`${e.id}\` · ${e.field}: expected \`${String(e.expected)}\`, got \`${String(e.got)}\`${e.raw !== e.got ? ` (model said \`${String(e.raw)}\`)` : ''}`,
        )
      : ['- none']),
    '',
  );
}

await writeFile(path.join(resultsDir, `${runDate}-summary.md`), `${report.join('\n')}\n`);
console.log(`Results written to ${resultsDir}`);
