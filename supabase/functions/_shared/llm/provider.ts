// LLM provider interface shared by the Edge Functions that call a model
// (coach, investigate). Pure: the live Anthropic adapter is ./anthropic.ts,
// test doubles implement the same interface.

export type LlmAction = 'CATEGORIZE' | 'INSIGHTS' | 'ASK' | 'INVESTIGATE';

export interface LlmRequest {
  action: LlmAction;
  system: string;
  user: string;
  schema: object;
  maxTokens: number;
}

export type LlmFailure = 'TIMEOUT' | 'REFUSAL' | 'TRUNCATED' | 'UNAVAILABLE';

export class LlmError extends Error {
  constructor(readonly reason: LlmFailure, message?: string) {
    super(message ?? reason);
  }
}

export interface LlmProvider {
  /** 'LLM' or 'MOCK': stored as the source of what the model produced. */
  readonly source: 'LLM' | 'MOCK';
  readonly model: string;
  /** Resolves to the model's JSON text; rejects with LlmError. Must stop when `signal` aborts. */
  complete(req: LlmRequest, signal: AbortSignal): Promise<string>;
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new LlmError('TIMEOUT'));
    }, { once: true });
  });
}
