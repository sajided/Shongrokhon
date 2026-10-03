import type { PaymentRequest, PaymentResponse } from './api';
import { ApiError, NetworkError } from './errors';

export interface PaymentFlowDeps {
  pay: (req: PaymentRequest) => Promise<PaymentResponse>;
  status: (idempotencyKey: string) => Promise<PaymentResponse>;
  /** Resolves once the device is back online. */
  waitForOnline: () => Promise<void>;
  /** Called when the outcome is unknown and the app starts checking (UI: "Checking payment status…"). */
  onChecking?: () => void;
  maxRecoveries?: number;
}

/**
 * TC-P1-PAY-07/10: submits a payment and, if the connection drops, waits for the
 * network, asks the server what happened to this idempotency key, and only
 * re-submits (with the same key) when the server never saw the request.
 * The server guarantees at most one debit per key.
 * A server error without a business code (e.g. a function worker shut down
 * mid-request under load, TC-P4-PERF-02) leaves the outcome just as unknown,
 * so it is recovered the same way.
 */
export async function submitPayment(req: PaymentRequest, deps: PaymentFlowDeps): Promise<PaymentResponse> {
  const maxRecoveries = deps.maxRecoveries ?? 5;
  let recoveries = 0;
  let mustSubmit = true;

  for (;;) {
    try {
      if (mustSubmit) return await deps.pay(req);
      const status = await deps.status(req.idempotencyKey);
      if (status.status !== 'NOT_FOUND') return status;
      mustSubmit = true;
    } catch (e) {
      if (!outcomeUnknown(e) || recoveries >= maxRecoveries) throw e;
      recoveries += 1;
      mustSubmit = false;
      deps.onChecking?.();
      await deps.waitForOnline();
    }
  }
}

function outcomeUnknown(e: unknown): boolean {
  return e instanceof NetworkError || (e instanceof ApiError && e.code === 'INTERNAL_ERROR');
}
