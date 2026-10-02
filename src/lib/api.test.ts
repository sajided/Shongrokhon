import { invokeFunction, type FunctionTransport } from './api';
import { ApiError, NetworkError, SessionExpiredError } from './errors';

function transport(response: Response | Error, over: Partial<FunctionTransport> = {}) {
  const fetchImpl = jest.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const t: FunctionTransport = {
    url: 'http://api.test',
    anonKey: 'anon-key',
    accessToken: async () => 'user-jwt',
    onUnauthorized: jest.fn(async () => undefined),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...over,
  };
  return { t, fetchImpl };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('invokeFunction (pay Edge Function client)', () => {
  it('posts to the function with the user token and returns the JSON body', async () => {
    const { t, fetchImpl } = transport(json(200, { status: 'STEP_UP_REQUIRED', code: 'CONFIRM_PAYMENT' }));
    await expect(invokeFunction('pay', { amount: 1 }, t)).resolves.toEqual({ status: 'STEP_UP_REQUIRED', code: 'CONFIRM_PAYMENT' });
    const [url, init] = (fetchImpl.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe('http://api.test/functions/v1/pay');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-jwt');
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
  });

  it('TC-P1-AUTH-10: 401 signs out locally and raises SessionExpiredError', async () => {
    const { t } = transport(json(401, { code: 'SESSION_REVOKED' }));
    await expect(invokeFunction('pay', {}, t)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(t.onUnauthorized).toHaveBeenCalled();
  });

  it('TC-P1-PAY-10: transport failure is a NetworkError (offline recovery takes over)', async () => {
    const { t } = transport(new TypeError('Failed to fetch'));
    await expect(invokeFunction('pay', {}, t)).rejects.toBeInstanceOf(NetworkError);
  });

  it('maps UPPER_SNAKE error codes and hides anything else', async () => {
    await expect(invokeFunction('pay', {}, transport(json(400, { code: 'INVALID_REQUEST' })).t)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    const other = invokeFunction('pay', {}, transport(json(500, { code: 'boom: stack trace' })).t);
    await expect(other).rejects.toBeInstanceOf(ApiError);
    await expect(invokeFunction('pay', {}, transport(json(500, { code: 'x y' })).t)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('times out as a NetworkError', async () => {
    const never = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const { t } = transport(json(200, {}), { fetchImpl: never as unknown as typeof fetch, timeoutMs: 10 });
    await expect(invokeFunction('pay', {}, t)).rejects.toBeInstanceOf(NetworkError);
  });
});
