import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useI18n } from '@/i18n/LocaleProvider';
import { isValidPin } from '@/lib/validation';

import { Button, colors, ErrorBanner, Field, Text } from './ui';

export interface StepUpConfirmProps {
  merchantName: string;
  amount: number;
  /** Cash-outs and transfers pass their own sentence and button label. */
  body?: string;
  confirmLabel?: string;
  busy: boolean;
  serverError: string | null;
  onConfirm: (pin: string) => void;
  onCancel: () => void;
}

/**
 * TC-P2-FLOW-03: a medium-risk payment runs only after the user confirms it
 * again with their PIN. A scam warning asks the user to stop and check, but
 * never says why this one was stopped, so the rules can't be probed.
 */
export function StepUpConfirm({ merchantName, amount, body, confirmLabel, busy, serverError, onConfirm, onCancel }: StepUpConfirmProps) {
  const { t, msg, money } = useI18n();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    if (!isValidPin(pin)) return setError(msg('INVALID_PIN_FORMAT'));
    setError(null);
    onConfirm(pin);
  };

  return (
    <View style={styles.container} testID="step-up">
      <View style={styles.card}>
        <Text style={styles.heading} accessibilityRole="header">
          {t('stepUp.title')}
        </Text>
        <Text style={styles.text}>{body ?? t('stepUp.body', { amount: money(amount), name: merchantName })}</Text>
        <Text style={[styles.text, styles.strong]} testID="step-up-amount">
          {money(amount)}
        </Text>
      </View>
      <View style={styles.warning} accessibilityRole="alert" testID="step-up-warning">
        <Text style={styles.warningHeading}>{t('stepUp.warnTitle')}</Text>
        {(['stepUp.warnPin', 'stepUp.warnPressure', 'stepUp.warnCancel'] as const).map((key) => (
          <Text key={key} style={styles.text}>
            {'\u2022 '}
            {t(key)}
          </Text>
        ))}
      </View>
      <Field
        label={t('common.pin')}
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
      <Button title={confirmLabel ?? t('stepUp.confirm')} onPress={confirm} busy={busy} testID="step-up-confirm" />
      <Button title={t('common.cancel')} variant="secondary" onPress={onCancel} disabled={busy} testID="step-up-cancel" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  card: { backgroundColor: colors.warningSurface, borderRadius: 12, padding: 16, gap: 8 },
  heading: { color: colors.warning, fontSize: 18, fontWeight: '700' },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  strong: { fontWeight: '700' },
  warning: { borderColor: colors.warning, borderWidth: 2, borderRadius: 12, padding: 16, gap: 8 },
  warningHeading: { color: colors.warning, fontSize: 16, fontWeight: '700' },
});
