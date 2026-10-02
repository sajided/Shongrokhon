import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatTaka } from '@/lib/format';
import { messageFor } from '@/lib/messages';
import { isValidPin, validateAmount } from '@/lib/validation';

import { Button, colors, ErrorBanner, Field } from './ui';

export interface PayFormProps {
  merchantName: string;
  merchantId: string;
  /** Dynamic QR amount: shown read-only (TC-P1-QR-04). */
  fixedAmount: number | null;
  busy: boolean;
  serverError: string | null;
  onSubmit: (input: { amount: number; pin: string }) => void;
}

export function PayForm({ merchantName, merchantId, fixedAmount, busy, serverError, onSubmit }: PayFormProps) {
  const [amountText, setAmountText] = useState(fixedAmount !== null ? fixedAmount.toFixed(2) : '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const amount = validateAmount(amountText);
    if (!amount.ok) return setError(messageFor(amount.code));
    if (!isValidPin(pin)) return setError(messageFor('INVALID_PIN_FORMAT'));
    setError(null);
    onSubmit({ amount: amount.value, pin });
  };

  return (
    <View style={styles.container}>
      <View style={styles.merchant} testID="merchant-card">
        <Text style={styles.merchantLabel}>Paying</Text>
        <Text style={styles.merchantName} testID="merchant-name">
          {merchantName}
        </Text>
        <Text style={styles.merchantId} testID="merchant-id">
          Merchant ID {merchantId}
        </Text>
      </View>

      <Field
        label="Amount (৳)"
        testID="amount-input"
        value={amountText}
        onChangeText={setAmountText}
        editable={fixedAmount === null && !busy}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      {fixedAmount !== null && (
        <Text style={styles.note} testID="fixed-amount-note">
          Amount set by the merchant: {formatTaka(fixedAmount)}
        </Text>
      )}
      <Field
        label="PIN"
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
      <Button title="Pay" onPress={submit} busy={busy} testID="pay-button" />
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
