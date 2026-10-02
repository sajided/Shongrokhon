import type { PaymentRequest, PaymentResponse } from './api';
import { ApiError, NetworkError } from './errors';
import { submitPayment } from './payment-flow';

const req: PaymentRequest = { merchantId: 'MLEGIT0001', amount: 500, pin: '12345', idempotencyKey: 'key-1' };
const success: PaymentResponse = { status: 'SUCCESS', transaction_id: 't1', amount: 500 };

function deps(overrides: Partial<Parameters<typeof submitPayment>[1]> = {}) {
  return {
    pay: jest.fn<Promise<PaymentResponse>, [PaymentRequest]>().mockResolvedValue(success),
    status: jest.fn<Promise<PaymentResponse>, [string]>().mockResolvedValue({ status: 'NOT_FOUND' }),
    waitForOnline: jest.fn().mockResolvedValue(undefined),
    onChecking: jest.fn(),
    ...overrides,
  };
}

describe('submitPayment', () => {
  it('returns the server result directly when the network is fine', async () => {
    const d = deps();
    await expect(submitPayment(req, d)).resolves.toEqual(success);
    expect(d.pay).toHaveBeenCalledTimes(1);
    expect(d.status).not.toHaveBeenCalled();
  });

  it('TC-P1-PAY-10: request reached the server, response lost -> reports server status, no second debit', async () => {
    const d = deps({
      pay: jest.fn().mockRejectedValueOnce(new NetworkError()),
      status: jest.fn().mockResolvedValue({ ...success, replayed: true }),
    });
    await expect(submitPayment(req, d)).resolves.toMatchObject({ status: 'SUCCESS', transaction_id: 't1' });
    expect(d.onChecking).toHaveBeenCalledTimes(1);
    expect(d.waitForOnline).toHaveBeenCalledTimes(1);
    expect(d.pay).toHaveBeenCalledTimes(1);
    expect(d.status).toHaveBeenCalledWith('key-1');
  });

  it('TC-P1-PAY-10: request never reached the server -> resubmits with the same idempotency key', async () => {
    const pay = jest.fn().mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(success);
    const d = deps({ pay });
    await expect(submitPayment(req, d)).resolves.toEqual(success);
    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay.mock.calls[0][0].idempotencyKey).toBe(pay.mock.calls[1][0].idempotencyKey);
  });

  it('keeps checking while the status call itself fails offline', async () => {
    const d = deps({
      pay: jest.fn().mockRejectedValueOnce(new NetworkError()),
      status: jest.fn().mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(success),
    });
    await expect(submitPayment(req, d)).resolves.toEqual(success);
    expect(d.waitForOnline).toHaveBeenCalledTimes(2);
  });

  it('does not retry business errors', async () => {
    const d = deps({ pay: jest.fn().mockRejectedValue(new ApiError('INTERNAL_ERROR')) });
    await expect(submitPayment(req, d)).rejects.toThrow('INTERNAL_ERROR');
    expect(d.waitForOnline).not.toHaveBeenCalled();
  });

  it('gives up after maxRecoveries', async () => {
    const d = deps({ pay: jest.fn().mockRejectedValue(new NetworkError()), status: jest.fn().mockRejectedValue(new NetworkError()), maxRecoveries: 2 });
    await expect(submitPayment(req, d)).rejects.toBeInstanceOf(NetworkError);
    expect(d.waitForOnline).toHaveBeenCalledTimes(2);
  });
});
