import type { LlmAttemptOutcome } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';

import { prisma } from '../../db/prisma.ts';
import { type LlmClient, LlmError } from '../../llm/client.ts';
import { type ExtractionResult, extractCertificateFields } from '../../llm/extract.ts';
import { type PdfInfo, readPdf, usableText } from '../../llm/pdfInfo.ts';
import {
  type AttemptDetails,
  type QuotaLimits,
  completeAttempt,
  nextUtcMidnight,
  remainingToday,
  reserveAttempt,
} from '../../services/extractionQuotaService.ts';
import { assertAcceptedFile } from '../../storage/contentTypes.ts';
import { clientKey } from '../clientIp.ts';
import { AppError, notFound } from '../errors.ts';
import { idParamSchema } from '../schemas.ts';
import { uploadCertificateFile } from '../upload.ts';
import { parseParams } from '../validate.ts';

export interface ExtractionDeps {
  /** null when the feature is not configured on this deployment. */
  llmClient: LlmClient | null;
  limits: QuotaLimits;
  maxPdfPages: number;
  /** Keys the IP hash; see clientIp.ts. */
  ipSecret: string;
}

const OUTCOME_BY_FAILURE = {
  unavailable: 'UPSTREAM_ERROR',
  refused: 'REFUSED',
  truncated: 'INVALID_OUTPUT',
  invalid_output: 'INVALID_OUTPUT',
} as const;

/** One line per attempt: no document content, no address — enough to follow cost and failures. */
function logAttempt(fields: Record<string, string | number | null>): void {
  console.info('llm_extract', JSON.stringify(fields));
}

/**
 * Records how an attempt ended, without letting a failed write change the answer.
 *
 * By the time this runs the outcome is already decided — a paid suggestion to return, or
 * a readable error to explain. A database hiccup here must not turn either into a 500.
 * The row then stays PENDING, which still counts against the limit, so it fails safe.
 */
async function finishAttempt(
  id: string,
  outcome: LlmAttemptOutcome,
  details: AttemptDetails,
): Promise<void> {
  try {
    await completeAttempt(id, outcome, details);
  } catch (error) {
    console.error('Could not record the outcome of extraction attempt', id, error);
  }
}

/**
 * AI extraction: suggests field values for the certificate upload form. It writes no
 * certificate and stores no file — the only write is the attempt log, which is also
 * the rate limiter.
 *
 * Checks run cheapest-first, so a request that is going to fail never reaches the paid
 * call: feature switched on → file present and of an accepted type → supplier exists →
 * PDF readable and short enough → daily limits → model.
 */
export function createExtractionRouter(deps: ExtractionDeps): Router {
  const router = Router();

  router.get('/extraction/status', async (req, res) => {
    const now = new Date();
    const hash = clientKey(req.ip, deps.ipSecret, now);
    res.json({
      enabled: deps.llmClient !== null,
      model: deps.llmClient?.model ?? null,
      remainingToday: deps.llmClient === null ? 0 : await remainingToday(hash, deps.limits, now),
      resetsAt: nextUtcMidnight(now).toISOString(),
    });
  });

  // Ahead of multer, so a disabled deployment does not read the upload at all.
  const requireEnabled = (_req: Request, _res: Response, next: NextFunction): void => {
    next(
      deps.llmClient === null
        ? new AppError('EXTRACTION_DISABLED', 'AI extraction is not enabled on this deployment.')
        : undefined,
    );
  };

  router.post(
    '/suppliers/:id/certificates/extract',
    requireEnabled,
    uploadCertificateFile,
    async (req, res) => {
      const client = deps.llmClient;
      if (client === null)
        throw new AppError('EXTRACTION_DISABLED', 'AI extraction is not enabled.');

      const { id } = parseParams(req, idParamSchema);

      if (!req.file) {
        throw new AppError('VALIDATION_ERROR', 'A certificate file is required', [
          { path: 'file', message: 'no file was uploaded under the field name "file"' },
        ]);
      }
      const file = req.file;

      const mimeType = assertAcceptedFile(file.buffer, file.mimetype);

      const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true } });
      if (supplier === null) throw notFound('Supplier');

      let pageCount: number | null = null;
      let documentText: string | null = null;
      if (mimeType === 'application/pdf') {
        let info: PdfInfo;
        try {
          info = await readPdf(file.buffer);
        } catch {
          throw new AppError('VALIDATION_ERROR', 'The file could not be read as a PDF.', [
            { path: 'file', message: 'unreadable PDF' },
          ]);
        }
        if (info.pageCount > deps.maxPdfPages) {
          throw new AppError(
            'VALIDATION_ERROR',
            `AI extraction accepts documents of up to ${String(deps.maxPdfPages)} pages.`,
            [{ path: 'file', message: `the PDF has ${String(info.pageCount)} pages` }],
          );
        }
        pageCount = info.pageCount;
        documentText = usableText(info.text);
      }

      const now = new Date();
      const ipHash = clientKey(req.ip, deps.ipSecret, now);
      const decision = await reserveAttempt(
        {
          ipHash,
          supplierId: id,
          mimeType,
          fileSize: file.size,
          pageCount,
        },
        deps.limits,
        now,
      );

      if (!decision.allowed) {
        throw new AppError(
          'EXTRACTION_QUOTA_EXCEEDED',
          decision.scope === 'ip'
            ? "You've reached today's limit for AI extraction. Please try again tomorrow."
            : 'AI extraction is unavailable for the rest of today. Please try again tomorrow.',
          [{ path: 'scope', message: decision.scope }],
        );
      }

      let result: ExtractionResult;
      try {
        result = await extractCertificateFields(
          { buffer: file.buffer, mimeType, documentText },
          client,
          now,
        );
      } catch (error) {
        const failure = error instanceof LlmError ? error.failure : 'unavailable';
        if (!(error instanceof LlmError)) console.error('Unexpected extraction error', error);

        await finishAttempt(decision.attemptId, OUTCOME_BY_FAILURE[failure], {
          model: client.model,
        });
        logAttempt({ attemptId: decision.attemptId, model: client.model, outcome: failure });

        if (failure === 'unavailable') {
          throw new AppError(
            'EXTRACTION_UNAVAILABLE',
            'AI extraction is temporarily unavailable. Please fill in the fields manually.',
          );
        }
        throw new AppError(
          'EXTRACTION_FAILED',
          "Couldn't read this document. Please fill in the fields manually.",
        );
      }

      await finishAttempt(decision.attemptId, 'SUCCESS', {
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.latencyMs,
        warningCount: result.warnings.length,
      });
      logAttempt({
        attemptId: decision.attemptId,
        model: result.model,
        outcome: 'success',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.latencyMs,
        warnings: result.warnings.length,
      });

      res.json({
        suggestion: result.suggestion,
        evidence: result.evidence,
        verification: result.verification,
        warnings: result.warnings,
        model: result.model,
        usage: result.usage,
        remainingToday: decision.remainingToday,
      });
    },
  );

  return router;
}
