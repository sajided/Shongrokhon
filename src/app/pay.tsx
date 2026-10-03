import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PayForm } from '@/components/PayForm';
import { StepUpConfirm } from '@/components/StepUpConfirm';
import { Body, Button, ErrorBanner, Screen, Title } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { useI18n } from '@/i18n/LocaleProvider';
import { ApiError, getPaymentStatus, lookupMerchant, makePayment, type MerchantInfo } from '@/lib/api';
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

// Two entry points: a scanned Bangla QR (`payload`), or "Pay a bill" (`merchantId`
// of a biller, `bill=1` asks for the account number). Both run the same scored flow.
export default function Pay() {
  const params = useLocalSearchParams<{ payload?: string; merchantId?: string; bill?: string }>();
  const parsed = useMemo(
    () => (params.merchantId
      ? { ok: true as const, qr: { merchantId: params.merchantId, amount: null } }
      : parseBanglaQr(params.payload ?? '')),
    [params.merchantId, params.payload],
  );
  const isBill = params.bill === '1';
  const { refreshProfile } = useSession();
  const { t, msg } = useI18n();

  // One idempotency key per payment screen: retries and double taps reuse it (TC-P1-PAY-07).
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const [merchant, setMerchant] = useState<MerchantInfo | null | undefined>(undefined);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // TC-P2-FLOW-03: set when the server asks the user to confirm a medium-risk payment.
  const [stepUp, setStepUp] = useState<{ amount: number; account?: string; warning?: 'CASHOUT_MERCHANT' } | null>(null);

  const merchantId = parsed.ok ? parsed.qr.merchantId : null;

  useEffect(() => {
    if (!merchantId) return;
    // The ledger uses the server's merchant record, never the name printed in the QR.
    lookupMerchant(merchantId)
      .then(setMerchant)
      .catch((e) => setLookupError(msg(e instanceof ApiError ? e.code : null)));
  }, [merchantId, msg]);

  if (!parsed.ok) {
    return (
      <Screen>
        <ErrorBanner message={msg(parsed.code)} />
        <Button title={t('pay.backToScanner')} onPress={() => router.back()} />
      </Screen>
    );
  }

  if (lookupError || merchant === null || merchant?.is_active === false) {
    return (
      <Screen>
        <ErrorBanner message={lookupError ?? msg(merchant === null ? 'MERCHANT_NOT_FOUND' : 'MERCHANT_INACTIVE')} />
        <Button title={t('pay.backToScanner')} onPress={() => router.back()} />
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

  const onSubmit = async ({ amount, pin, account }: { amount: number; pin: string; account?: string }, confirm = false) => {
    setBusy(true);
    setServerError(null);
    try {
      // Same idempotency key for the step-up confirmation: it completes the same payment.
      const result = await submitPayment(
        { merchantId: merchant.merchant_id, amount, pin, idempotencyKey, confirm, note: account },
        { pay: makePayment, status: getPaymentStatus, waitForOnline, onChecking: () => setChecking(true) },
      );
      if (result.status === 'SUCCESS' && result.transaction_id) {
        refreshProfile();
        router.replace(`/receipt/${result.transaction_id}`);
        return;
      }
      if (result.status === 'STEP_UP_REQUIRED') {
        // Keep a warning from the first response if the confirm call is stepped up again.
        setStepUp((prev) => ({ amount, account, warning: result.warning ?? prev?.warning }));
        return;
      }
      setServerError(msg(result.code, { attempts_left: result.attempts_left }));
    } catch (e) {
      setServerError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
      setChecking(false);
    }
  };

  return (
    <Screen>
      {checking ? (
        <View style={{ gap: 12 }} testID="payment-checking">
          <Title>{t('pay.checkingTitle')}</Title>
          <Body muted>{t('pay.checkingBody')}</Body>
          <ActivityIndicator />
        </View>
      ) : stepUp ? (
        <StepUpConfirm
          merchantName={merchant.merchant_name}
          amount={stepUp.amount}
          warning={stepUp.warning}
          busy={busy}
          serverError={serverError}
          onConfirm={(pin) => onSubmit({ amount: stepUp.amount, pin, account: stepUp.account }, true)}
          onCancel={() => router.back()}
        />
      ) : (
        <PayForm
          merchantName={merchant.merchant_name}
          merchantId={merchant.merchant_id}
          fixedAmount={parsed.qr.amount}
          askAccount={isBill}
          busy={busy}
          serverError={serverError}
          onSubmit={onSubmit}
        />
      )}
    </Screen>
  );
}
