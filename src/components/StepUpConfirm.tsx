import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatTaka } from '@/lib/format';
import { messageFor } from '@/lib/messages';
import { isValidPin } from '@/lib/validation';

import { Button, colors, ErrorBanner, Field } from './ui';

export interface StepUpConfirmProps {
  merchantName: string;
  amount: number;
  busy: boolean;
  serverError: string | null;
  onConfirm: (pin: string) => void;
  onCancel: () => void;
}

/**
 * TC-P2-FLOW-03: a medium-risk payment runs only after the user confirms it
 * again with their PIN. The wording is neutral and never says why.
 */
export function StepUpConfirm({ merchantName, amount, busy, serverError, onConfirm, onCancel }: StepUpConfirmProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    if (!isValidPin(pin)) return setError(messageFor('INVALID_PIN_FORMAT'));
    setError(null);
    onConfirm(pin);
  };

  return (
    <View style={styles.container} testID="step-up">
      <View style={styles.card}>
        <Text style={styles.heading} accessibilityRole="header">
          Confirm this payment
        </Text>
        <Text style={styles.text}>
          For your security, please confirm you want to pay{' '}
          <Text style={styles.strong} testID="step-up-amount">
            {formatTaka(amount)}
          </Text>{' '}
          to <Text style={styles.strong}>{merchantName}</Text>.
        </Text>
      </View>
      <Field
        label="PIN"
        testID="step-up-pin"
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
        editable={!busy}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={5}
        placeholder="••••"
      />
      <ErrorBanner message={error ?? serverError} />
      <Button title="Confirm and pay" onPress={confirm} busy={busy} testID="step-up-confirm" />
      <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={busy} testID="step-up-cancel" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  card: { backgroundColor: colors.warningSurface, borderRadius: 12, padding: 16, gap: 8 },
  heading: { color: colors.warning, fontSize: 18, fontWeight: '700' },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  strong: { fontWeight: '700' },
});
