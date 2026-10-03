// The live adapter with a fake SDK: request shape, refusals, truncation, timeouts.
import { AnthropicProvider, type AnthropicSdk } from './anthropic';
import { LlmError, type LlmRequest } from './provider';

class APIError extends Error {
  constructor(readonly status?: number) {
    super('api');
  }
}
class APIUserAbortError extends APIError {}
class APIConnectionTimeoutError extends APIError {}

function fakeSdk(result: () => Promise<unknown>) {
  const calls: { body: Record<string, any>; opts: unknown }[] = [];
  const created: unknown[] = [];
  class Fake {
    beta = { messages: { create: async (body: never, opts: unknown) => {
      calls.push({ body, opts });
      return result();
    } } };
    constructor(opts: unknown) {
      created.push(opts);
    }
    static APIUserAbortError = APIUserAbortError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    static APIError = APIError;
  }
  return { sdk: Fake as unknown as AnthropicSdk, calls, created };
}

const req: LlmRequest = { action: 'INSIGHTS', system: 'SYS', user: 'USER', schema: { type: 'object' }, maxTokens: 2000 };
const signal = new AbortController().signal;
const reply = (stop_reason: string, text = '{"insights":[]}') => async () => ({ stop_reason, content: [{ type: 'text', text }] });

describe('AnthropicProvider', () => {
  it('sends a structured-output request with a cached system prompt and refusal fallback', async () => {
    const { sdk, calls, created } = fakeSdk(reply('end_turn'));
    const p = new AnthropicProvider(sdk, 'sk-test', 'claude-opus-5-5');
    expect(await p.complete(req, signal)).toBe('{"insights":[]}');
    expect(created).toEqual([{ apiKey: 'sk-test', maxRetries: 1 }]);
    expect(calls[0].body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } },
      messages: [{ role: 'user', content: 'USER' }],
    });
    expect(calls[0].opts).toEqual({ signal });
  });

  it.each([
    ['refusal', 'REFUSAL'],
    ['max_tokens', 'TRUNCATED'],
  ])('stop_reason %s -> %s', async (stop, reason) => {
    const p = new AnthropicProvider(fakeSdk(reply(stop)).sdk, 'k', 'm');
    await expect(p.complete(req, signal)).rejects.toEqual(new LlmError(reason as never));
  });

  it.each([
    [new APIUserAbortError(), 'TIMEOUT'],
    [new APIConnectionTimeoutError(), 'TIMEOUT'],
    [new APIError(529), 'UNAVAILABLE'],
    [new TypeError('fetch failed'), 'UNAVAILABLE'],
  ])('maps %p to %s', async (error, reason) => {
    const p = new AnthropicProvider(fakeSdk(async () => { throw error; }).sdk, 'k', 'm');
    await expect(p.complete(req, signal)).rejects.toMatchObject({ reason });
  });

  it('a reply without a text block is an outage', async () => {
    const p = new AnthropicProvider(fakeSdk(async () => ({ stop_reason: 'end_turn', content: [] })).sdk, 'k', 'm');
    await expect(p.complete(req, signal)).rejects.toMatchObject({ reason: 'UNAVAILABLE' });
  });
});
