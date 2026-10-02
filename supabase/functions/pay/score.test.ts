// TC-P2-FLOW-04/05: the ML client never throws; failures become a FALLBACK outcome.
import { scoreWithModel } from './score';

const ok = { risk_score: 0.02, anomaly_score: -0.1, low_confidence: false, model_version: 'p2-test' };
const base = { url: 'http://ml:8000', token: 't0ken', features: { amount: 500 }, requestId: 'r1', timeoutMs: 800 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('scoreWithModel', () => {
  it('returns the model score and sends the bearer token', async () => {
    const fetchImpl = jest.fn(async () => json(200, ok));
    const out = await scoreWithModel({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toMatchObject({ source: 'MODEL', score: ok });
    const [url, init] = (fetchImpl.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe('http://ml:8000/score');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t0ken');
    expect(JSON.parse(init.body as string)).toEqual({ request_id: 'r1', amount: 500 });
  });

  it('FLOW-05: a 3 s response is cut off at the timeout', async () => {
    jest.useFakeTimers();
    try {
      const slow = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const t = setTimeout(() => resolve(json(200, ok)), 3000);
            init.signal!.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new Error('aborted'));
            });
          }),
      );
      const pending = scoreWithModel({ ...base, fetchImpl: slow as unknown as typeof fetch });
      await jest.advanceTimersByTimeAsync(800);
      await expect(pending).resolves.toMatchObject({ source: 'FALLBACK', reason: 'TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('FLOW-04: connection refused -> UNAVAILABLE', async () => {
    const down = jest.fn(async () => {
      throw new TypeError('connection refused');
    });
    await expect(scoreWithModel({ ...base, fetchImpl: down as unknown as typeof fetch })).resolves.toMatchObject({
      source: 'FALLBACK',
      reason: 'UNAVAILABLE',
    });
  });

  it('non-200 and malformed responses fall back', async () => {
    const e500 = jest.fn(async () => json(500, { code: 'INTERNAL_ERROR' }));
    await expect(scoreWithModel({ ...base, fetchImpl: e500 as unknown as typeof fetch })).resolves.toMatchObject({
      reason: 'UNAVAILABLE',
    });
    const bad = jest.fn(async () => json(200, { ...ok, risk_score: 7 }));
    await expect(scoreWithModel({ ...base, fetchImpl: bad as unknown as typeof fetch })).resolves.toMatchObject({
      reason: 'BAD_RESPONSE',
    });
  });

  it('missing configuration falls back without calling out', async () => {
    const fetchImpl = jest.fn();
    await expect(
      scoreWithModel({ ...base, token: undefined, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toMatchObject({ reason: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
