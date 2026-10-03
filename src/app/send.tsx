// Send money to another Shongrokhon customer (Phase 4). The recipient is
// confirmed by first name and masked number only. Scored by `pay` (SQL rules);
// same idempotency, offline recovery and step-up as payments.
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { StepUpConfirm } from '@/components/StepUpConfirm';
import { Body, Button, ErrorBanner, Field, Screen, Text, Title } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { useI18n } from '@/i18n/LocaleProvider';
import { useScreenView } from '@/lib/analytics';
import { ApiError, getPaymentStatus, lookupRecipient, makePayment } from '@/lib/api';
import { submitPayment } from '@/lib/payment-flow';
import { isValidPin, normalizeBdPhone, validateAmount } from '@/lib/validation';

const waitForOnline = () => new Promise<void>((resolve) => setTimeout(resolve, 1000));

export default function SendMoney() {
  const { amount: prefill } = useLocalSearchParams<{ amount?: string }>();
  const { t, msg, money } = useI18n();
  useScreenView('send');
  const { refreshProfile } = useSession();
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const [phone, setPhone] = useState('');
  const [recipient, setRecipient] = useState<{ phone: string; name: string; masked: string } | null>(null);
  const [amountText, setAmountText] = useState(prefill ?? '');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [stepUp, setStepUp] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  const find = () => {
    const e164 = normalizeBdPhone(phone);
    if (!e164) return setError(msg('INVALID_PHONE'));
    return run(async () => {
      const found = await lookupRecipient(e164);
      if (!found) return setError(msg('RECIPIENT_NOT_FOUND'));
      setRecipient({ phone: e164, name: found.display_name, masked: found.masked_phone });
    });
  };

  const send = (confirm = false, pinValue = pin, fixedAmount?: number) => {
    const amount = fixedAmount !== undefined ? { ok: true as const, value: fixedAmount } : validateAmount(amountText);
    if (!amount.ok) return setError(msg(amount.code));
    if (!isValidPin(pinValue)) return setError(msg('INVALID_PIN_FORMAT'));
    return run(async () => {
      const result = await submitPayment(
        { kind: 'TRANSFER', merchantId: recipient!.phone, amount: amount.value, pin: pinValue, idempotencyKey,
          note: note.trim() || undefined, confirm },
        { pay: makePayment, status: getPaymentStatus, waitForOnline },
      );
      if (result.status === 'SUCCESS' && result.transaction_id) {
        refreshProfile();
        router.replace(`/receipt/${result.transaction_id}`);
        return;
      }
      if (result.status === 'STEP_UP_REQUIRED') return setStepUp(amount.value);
      setError(msg(result.code, { attempts_left: result.attempts_left }));
    });
  };

  if (stepUp !== null && recipient) {
    return (
      <Screen>
        <StepUpConfirm
          merchantName={recipient.name}
          amount={stepUp}
          body={t('send.stepUpBody', { amount: money(stepUp), name: recipient.name })}
          confirmLabel={t('send.submit')}
          busy={busy}
          serverError={error}
          onConfirm={(p) => send(true, p, stepUp)}
          onCancel={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{t('nav.send')}</Title>
      {!recipient ? (
        <>
          <Field label={t('send.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
            placeholder="01XXXXXXXXX" maxLength={16} testID="recipient-input" />
          <ErrorBanner message={error} />
          <Button title={t('send.find')} onPress={find} busy={busy} disabled={!phone.trim()} testID="recipient-find" />
        </>
      ) : (
        <>
          <View style={{ gap: 4 }} testID="recipient-card">
            <Text>{t('send.to')}</Text>
            <Title>{recipient.name}</Title>
            <Body muted>{recipient.masked}</Body>
          </View>
          <Field label={t('common.amount')} value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad"
            placeholder="0.00" testID="amount-input" />
          <Body muted>{t('send.free')}</Body>
          <Field label={t('send.note')} value={note} onChangeText={setNote} maxLength={80} testID="note-input" />
          <Field label={t('common.pin')} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ''))} keyboardType="number-pad"
            secureTextEntry maxLength={5} placeholder="••••" testID="pin-input" />
          <ErrorBanner message={error} />
          <Button title={t('send.submit')} onPress={() => send()} busy={busy} testID="send-submit" />
        </>
      )}
    </Screen>
  );
}
