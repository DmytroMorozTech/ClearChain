import Anthropic from '@anthropic-ai/sdk';

import type { AllowedMimeType } from '../storage/contentTypes.ts';
import { SYSTEM_PROMPT, USER_INSTRUCTION } from './prompt.ts';
import { MODEL_OUTPUT_JSON_SCHEMA } from './schema.ts';

/**
 * The one place that talks to the model provider. Everything else depends on the
 * `LlmClient` interface, which is what lets the test suites run with a fake and no key.
 *
 * The model has no tools: it can only return JSON. Whatever a document persuades it to
 * "do", the only effect is a value in that JSON — which validate.ts then judges.
 */
export interface LlmDocument {
  buffer: Buffer;
  mimeType: AllowedMimeType;
}

export interface LlmResult {
  output: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmClient {
  readonly model: string;
  extract(document: LlmDocument): Promise<LlmResult>;
}

export type LlmFailure = 'unavailable' | 'refused' | 'truncated' | 'invalid_output';

const MESSAGES: Record<LlmFailure, string> = {
  unavailable: 'The extraction service is unavailable.',
  refused: 'The extraction service declined this document.',
  truncated: 'The extraction service returned an incomplete answer.',
  invalid_output: 'The extraction service returned an answer that could not be used.',
};

export class LlmError extends Error {
  readonly failure: LlmFailure;

  constructor(failure: LlmFailure) {
    super(MESSAGES[failure]);
    this.name = 'LlmError';
    this.failure = failure;
  }
}

/**
 * Reduces any failure to one of four categories. Upstream messages are dropped on
 * purpose: they can echo request details, and the client could not act on them anyway.
 */
export function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  // The request itself was rejected — typically a document the provider cannot parse.
  if (error instanceof Anthropic.BadRequestError) return new LlmError('invalid_output');
  return new LlmError('unavailable');
}

/** Five short fields and five short quotes fit comfortably; a runaway answer is cut off. */
const MAX_OUTPUT_TOKENS = 1024;

export interface AnthropicClientOptions {
  apiKey: string;
  model: string;
  /** Per attempt. */
  timeoutMs: number;
  maxRetries: number;
  /**
   * Ceiling for the whole call, retries and their waits included. Per-attempt timeouts
   * alone do not bound it: the SDK honours a provider's `retry-after`, so a rate-limited
   * first attempt can wait tens of seconds before the second even starts.
   */
  deadlineMs?: number;
  /** Tests point this at a local server; production leaves it unset. */
  baseURL?: string;
}

export class AnthropicLlmClient implements LlmClient {
  readonly model: string;
  private readonly sdk: Anthropic;
  private readonly deadlineMs: number | undefined;

  constructor(options: AnthropicClientOptions) {
    this.model = options.model;
    this.deadlineMs = options.deadlineMs;
    // The SDK's own retry (with backoff) and timeout, rather than a loop of our own.
    this.sdk = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries,
      ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    });
  }

  async extract(document: LlmDocument): Promise<LlmResult> {
    const data = document.buffer.toString('base64');
    const source: Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam =
      document.mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: document.mimeType, data } };

    let response: Anthropic.Message;
    try {
      response = await this.sdk.messages.create(
        {
          model: this.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [source, { type: 'text', text: USER_INSTRUCTION }] }],
          output_config: {
            format: { type: 'json_schema', schema: MODEL_OUTPUT_JSON_SCHEMA },
            // Haiku 4.5 rejects `effort`; newer models think by default and only need it lowered.
            ...(this.model.startsWith('claude-haiku') ? {} : { effort: 'low' as const }),
          },
        },
        this.deadlineMs !== undefined ? { signal: AbortSignal.timeout(this.deadlineMs) } : {},
      );
    } catch (error) {
      throw toLlmError(error);
    }

    if (response.stop_reason === 'refusal') throw new LlmError('refused');
    if (response.stop_reason === 'max_tokens') throw new LlmError('truncated');

    let output: unknown = null;
    const textBlock = response.content.find((block) => block.type === 'text');
    if (textBlock?.type === 'text') {
      try {
        output = JSON.parse(textBlock.text);
      } catch {
        throw new LlmError('invalid_output');
      }
    }

    return {
      output,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
