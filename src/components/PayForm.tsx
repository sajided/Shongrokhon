import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useI18n } from '@/i18n/LocaleProvider';
import { isValidPin, validateAmount } from '@/lib/validation';

import { Button, colors, ErrorBanner, Field, Text } from './ui';

export interface PayFormProps {
  merchantName: string;
  merchantId: string;
  /** Dynamic QR amount: shown read-only (TC-P1-QR-04). */
  fixedAmount: number | null;
  busy: boolean;
  serverError: string | null;
  /** Bill pay: ask for the account / customer number, sent as the payment note. */
  askAccount?: boolean;
  onSubmit: (input: { amount: number; pin: string; account?: string }) => void;
}

export function PayForm({ merchantName, merchantId, fixedAmount, busy, serverError, askAccount, onSubmit }: PayFormProps) {
  const { t, msg, money } = useI18n();
  const [account, setAccount] = useState('');
  const [amountText, setAmountText] = useState(fixedAmount !== null ? fixedAmount.toFixed(2) : '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const amount = validateAmount(amountText);
    if (!amount.ok) return setError(msg(amount.code));
    if (!isValidPin(pin)) return setError(msg('INVALID_PIN_FORMAT'));
    setError(null);
    onSubmit({ amount: amount.value, pin, account: askAccount ? account.trim() || undefined : undefined });
  };

  return (
    <View style={styles.container}>
      <View style={styles.merchant} testID="merchant-card">
        <Text style={styles.merchantLabel}>{t('pay.paying')}</Text>
        <Text style={styles.merchantName} testID="merchant-name">
          {merchantName}
        </Text>
        <Text style={styles.merchantId} testID="merchant-id">
          {t('pay.merchantId', { id: merchantId })}
        </Text>
      </View>
      {askAccount && (
        <Field label={t('pay.account')} testID="account-input" value={account} onChangeText={setAccount} maxLength={40} />
      )}

      <Field
        label={t('common.amount')}
        testID="amount-input"
        value={amountText}
        onChangeText={setAmountText}
        editable={fixedAmount === null && !busy}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      {fixedAmount !== null && (
        <Text style={styles.note} testID="fixed-amount-note">
          {t('pay.fixedAmount', { amount: money(fixedAmount) })}
        </Text>
      )}
      <Field
        label={t('common.pin')}
        testID="pin-input"
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
        editable={!busy}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={5}
        placeholder="••••"
      />
      <ErrorBanner message={error ?? serverError} />
      <Button title={t('pay.submit')} onPress={submit} busy={busy} testID="pay-button" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  merchant: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, gap: 4 },
  merchantLabel: { color: colors.muted, fontSize: 13 },
  merchantName: { color: colors.text, fontSize: 20, fontWeight: '700' },
  merchantId: { color: colors.muted, fontSize: 13 },
  note: { color: colors.muted, fontSize: 13 },
});
