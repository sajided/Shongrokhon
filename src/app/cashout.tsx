// Cash out at an agent (Phase 4), with the Smart Spending Companion
// (TC-P4-SSC-*). Steps: agent -> amount (fee shown) -> companion check ->
// interception (only for repeated cash-outs) -> PIN -> scored by `pay` ->
// receipt. Choosing an alternative cancels the cash-out: nothing is debited.
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Interception } from '@/components/Interception';
import { StepUpConfirm } from '@/components/StepUpConfirm';
import { Body, Button, ErrorBanner, Field, Screen, Text, Title } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { useI18n } from '@/i18n/LocaleProvider';
import { useScreenView } from '@/lib/analytics';
import {
  ApiError, cashoutNudge, getPaymentStatus, logNudgeChoice, lookupAgent, makePayment, type AgentInfo, type Nudge,
  type NudgeChoice,
} from '@/lib/api';
import { submitPayment } from '@/lib/payment-flow';
import { isValidPin, validateAmount } from '@/lib/validation';

type Step = 'agent' | 'amount' | 'nudge' | 'pin';

const waitForOnline = () => new Promise<void>((resolve) => setTimeout(resolve, 1000));

export default function CashOut() {
  const { t, msg, money, digits } = useI18n();
  useScreenView('cashout');
  const { refreshProfile } = useSession();
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const [step, setStep] = useState<Step>('agent');
  const [code, setCode] = useState('');
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [amountText, setAmountText] = useState('');
  const [amount, setAmount] = useState(0);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [pin, setPin] = useState('');
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fee = agent ? Math.round(amount * agent.fee_rate * 100) / 100 : 0;

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

  const findAgent = () => run(async () => {
    const found = await lookupAgent(code);
    if (!found) return setError(msg('AGENT_NOT_FOUND'));
    if (!found.is_active) return setError(msg('AGENT_INACTIVE'));
    setAgent(found);
    setStep('amount');
  });

  // The companion decides on the server (cashout_nudge) before anything is debited.
  const checkAmount = () => {
    const v = validateAmount(amountText);
    if (!v.ok) return setError(msg(v.code));
    setAmount(v.value);
    return run(async () => {
      const result = await cashoutNudge(v.value);
      setNudge(result);
      setStep(result.show ? 'nudge' : 'pin');
    });
  };

  const choose = (choice: NudgeChoice) => run(async () => {
    if (nudge?.nudge_id) await logNudgeChoice(nudge.nudge_id, choice).catch(() => undefined); // logging never blocks
    if (choice === 'CONTINUE') return setStep('pin');
    if (choice === 'CANCEL') return router.back();
    // An alternative replaces the cash-out; it never ran.
    if (choice === 'PAY_QR') return router.replace('/scan');
    if (choice === 'BILL_PAY') return router.replace('/bills');
    router.replace({ pathname: '/send', params: { amount: String(amount) } });
  });

  const submit = (confirm = false, pinValue = pin) => {
    if (!isValidPin(pinValue)) return setError(msg('INVALID_PIN_FORMAT'));
    return run(async () => {
      const result = await submitPayment(
        { kind: 'CASHOUT', merchantId: agent!.agent_code, amount, pin: pinValue, idempotencyKey, confirm },
        { pay: makePayment, status: getPaymentStatus, waitForOnline },
      );
      if (result.status === 'SUCCESS' && result.transaction_id) {
        refreshProfile();
        router.replace(`/receipt/${result.transaction_id}`);
        return;
      }
      if (result.status === 'STEP_UP_REQUIRED') return setStepUp(true);
      setError(msg(result.code, { attempts_left: result.attempts_left }));
    });
  };

  if (stepUp && agent) {
    return (
      <Screen>
        <StepUpConfirm
          merchantName={agent.agent_name}
          amount={amount}
          body={t('cashout.stepUpBody', { amount: money(amount), fee: money(fee) })}
          confirmLabel={t('cashout.confirm')}
          busy={busy}
          serverError={error}
          onConfirm={(p) => submit(true, p)}
          onCancel={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {step === 'agent' && (
        <>
          <Title>{t('nav.cashout')}</Title>
          <Field label={t('cashout.agentCode')} value={code} onChangeText={setCode} autoCapitalize="characters"
            placeholder="AGENT001" testID="agent-input" />
          <Body muted>{t('cashout.agentHint')}</Body>
          <ErrorBanner message={error} />
          <Button title={t('cashout.find')} onPress={findAgent} busy={busy} disabled={!code.trim()} testID="agent-find" />
        </>
      )}

      {step !== 'agent' && agent && step !== 'nudge' && (
        <View style={{ gap: 4 }} testID="agent-card">
          <Text>{t('cashout.agent')}</Text>
          <Title>{agent.agent_name}</Title>
          <Body muted>{agent.agent_code}</Body>
        </View>
      )}

      {step === 'amount' && (
        <>
          <Field label={t('common.amount')} value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad"
            placeholder="0.00" testID="amount-input" />
          <ErrorBanner message={error} />
          <Button title={t('common.continue')} onPress={checkAmount} busy={busy} disabled={!amountText.trim()}
            testID="amount-continue" />
        </>
      )}

      {step === 'nudge' && nudge && (
        <>
          <Interception nth={nudge.nth ?? 0} amount={amount} fee={nudge.fee ?? fee} busy={busy} onChoose={choose} />
          <ErrorBanner message={error} />
        </>
      )}

      {step === 'pin' && agent && (
        <>
          <Body testID="cashout-fee">
            {t('cashout.feeLine', { fee: money(fee), rate: digits((agent.fee_rate * 100).toFixed(2)), total: money(amount + fee) })}
          </Body>
          <Field label={t('common.pin')} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ''))} keyboardType="number-pad"
            secureTextEntry maxLength={5} placeholder="••••" testID="pin-input" />
          <ErrorBanner message={error} />
          <Button title={t('cashout.submit')} onPress={() => submit()} busy={busy} testID="cashout-submit" />
        </>
      )}
    </Screen>
  );
}
