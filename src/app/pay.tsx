import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PayForm } from '@/components/PayForm';
import { StepUpConfirm } from '@/components/StepUpConfirm';
import { Body, Button, ErrorBanner, Screen, Title } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { ApiError, getPaymentStatus, lookupMerchant, makePayment, type MerchantInfo } from '@/lib/api';
import { messageFor } from '@/lib/messages';
import { submitPayment } from '@/lib/payment-flow';
import { parseBanglaQr } from '@/lib/qr/emv';

function waitForOnline(): Promise<void> {
  // Small delay so a still-online browser doesn't hammer a struggling server.
  const settle = (resolve: () => void) => setTimeout(resolve, 1000);
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || navigator.onLine) return settle(resolve);
    window.addEventListener('online', () => settle(resolve), { once: true });
  });
}

export default function Pay() {
  const { payload } = useLocalSearchParams<{ payload: string }>();
  const parsed = useMemo(() => parseBanglaQr(payload ?? ''), [payload]);
  const { refreshProfile } = useSession();

  // One idempotency key per payment screen: retries and double taps reuse it (TC-P1-PAY-07).
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const [merchant, setMerchant] = useState<MerchantInfo | null | undefined>(undefined);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // TC-P2-FLOW-03: set when the server asks the user to confirm a medium-risk payment.
  const [stepUp, setStepUp] = useState<{ amount: number } | null>(null);

  const merchantId = parsed.ok ? parsed.qr.merchantId : null;

  useEffect(() => {
    if (!merchantId) return;
    // The ledger uses the server's merchant record, never the name printed in the QR.
    lookupMerchant(merchantId)
      .then(setMerchant)
      .catch((e) => setLookupError(messageFor(e instanceof ApiError ? e.code : null)));
  }, [merchantId]);

  if (!parsed.ok) {
    return (
      <Screen>
        <ErrorBanner message={messageFor(parsed.code)} />
        <Button title="Back to scanner" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (lookupError || merchant === null || merchant?.is_active === false) {
    return (
      <Screen>
        <ErrorBanner message={lookupError ?? messageFor(merchant === null ? 'MERCHANT_NOT_FOUND' : 'MERCHANT_INACTIVE')} />
        <Button title="Back to scanner" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (merchant === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const onSubmit = async ({ amount, pin }: { amount: number; pin: string }, confirm = false) => {
    setBusy(true);
    setServerError(null);
    try {
      // Same idempotency key for the step-up confirmation: it completes the same payment.
      const result = await submitPayment(
        { merchantId: merchant.merchant_id, amount, pin, idempotencyKey, confirm },
        { pay: makePayment, status: getPaymentStatus, waitForOnline, onChecking: () => setChecking(true) },
      );
      if (result.status === 'SUCCESS' && result.transaction_id) {
        refreshProfile();
        router.replace(`/receipt/${result.transaction_id}`);
        return;
      }
      if (result.status === 'STEP_UP_REQUIRED') {
        setStepUp({ amount });
        return;
      }
      setServerError(messageFor(result.code, { attempts_left: result.attempts_left }));
    } catch (e) {
      setServerError(messageFor(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
      setChecking(false);
    }
  };

  return (
    <Screen>
      {checking ? (
        <View style={{ gap: 12 }} testID="payment-checking">
          <Title>Checking payment status…</Title>
          <Body muted>
            The connection dropped. We&apos;ll confirm the result with the server as soon as you are back online. You
            will not be charged twice.
          </Body>
          <ActivityIndicator />
        </View>
      ) : stepUp ? (
        <StepUpConfirm
          merchantName={merchant.merchant_name}
          amount={stepUp.amount}
          busy={busy}
          serverError={serverError}
          onConfirm={(pin) => onSubmit({ amount: stepUp.amount, pin }, true)}
          onCancel={() => router.back()}
        />
      ) : (
        <PayForm
          merchantName={merchant.merchant_name}
          merchantId={merchant.merchant_id}
          fixedAmount={parsed.qr.amount}
          busy={busy}
          serverError={serverError}
          onSubmit={onSubmit}
        />
      )}
    </Screen>
  );
}
