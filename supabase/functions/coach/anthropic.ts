// Live LLM provider: Claude through the official Anthropic SDK. The SDK class
// is passed in, so the same adapter runs in the Edge Function (Deno `npm:`
// import, index.ts), in the live eval (Node, scripts/eval-coach.ts) and in
// Jest with a fake. ANTHROPIC_API_KEY stays server-side (TC-P3-LLM-08).

import { LlmError, type LlmProvider, type LlmRequest } from './provider.ts';

interface SdkMessage {
  stop_reason: string | null;
  content: { type: string; text?: string }[];
}

type ErrorClass = abstract new (...args: never[]) => Error;

/** The parts of the `@anthropic-ai/sdk` default export this adapter uses. */
export interface AnthropicSdk {
  new (opts: { apiKey: string; maxRetries: number }): {
    beta: { messages: { create(body: never, opts: { signal: AbortSignal }): Promise<unknown> } };
  };
  APIUserAbortError: ErrorClass;
  APIConnectionTimeoutError: ErrorClass;
  APIError: ErrorClass;
}

export class AnthropicProvider implements LlmProvider {
  readonly source = 'LLM' as const;
  private readonly client: InstanceType<AnthropicSdk>;

  constructor(private readonly sdk: AnthropicSdk, apiKey: string, readonly model: string) {
    // One SDK retry for transport errors; the orchestrator owns the overall timeout.
    this.client = new sdk({ apiKey, maxRetries: 1 });
  }

  async complete(req: LlmRequest, signal: AbortSignal): Promise<string> {
    let message: SdkMessage;
    try {
      message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        // Re-run a safety-classifier refusal on Anthropic's recommended fallback model.
        fallbacks: 'default',
        // Frozen system prompt first, so repeated requests can read it from the prompt cache.
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        // Short classification and summary tasks: low effort keeps latency down.
        output_config: { effort: 'low', format: { type: 'json_schema', schema: req.schema } },
        messages: [{ role: 'user', content: req.user }],
      } as never, { signal }) as SdkMessage;
    } catch (e) {
      if (e instanceof this.sdk.APIUserAbortError || e instanceof this.sdk.APIConnectionTimeoutError) {
        throw new LlmError('TIMEOUT');
      }
      const status = e instanceof this.sdk.APIError ? (e as Error & { status?: number }).status : undefined;
      throw new LlmError('UNAVAILABLE', status ? `status ${status}` : 'connection');
    }
    if (message.stop_reason === 'refusal') throw new LlmError('REFUSAL');
    if (message.stop_reason === 'max_tokens') throw new LlmError('TRUNCATED');
    const text = message.content.find((b) => b.type === 'text')?.text;
    if (typeof text !== 'string') throw new LlmError('UNAVAILABLE', 'no text block');
    return text;
  }
}
