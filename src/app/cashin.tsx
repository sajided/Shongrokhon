import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Body, Button, colors, ErrorBanner, Field, Screen, Text, Title } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { useI18n } from '@/i18n/LocaleProvider';
import { useScreenView } from '@/lib/analytics';
import { ApiError, cashIn } from '@/lib/api';
import { validateAmount } from '@/lib/validation';

const PRESETS = [500, 1000, 2000, 5000];

export default function CashIn() {
  const { t, msg, money } = useI18n();
  useScreenView('cashin');
  const { refreshProfile } = useSession();
  const [amountText, setAmountText] = useState('');
  const [agentCode, setAgentCode] = useState('AGENT001');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);

  const submit = async () => {
    const val = validateAmount(amountText);
    if (!val.ok) return setError(msg(val.code));
    setError(null);
    setBusy(true);
    try {
      await cashIn(val.value, agentCode.trim() || 'Agent Cash-in');
      await refreshProfile();
      setSuccess(val.value);
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  if (success !== null) {
    return (
      <Screen>
        <View style={styles.successBox}>
          <Text style={styles.successIcon}>✓</Text>
          <Title>{t('cashin.success')}</Title>
          <Body muted>{t('cashin.successBody', { amount: money(success) })}</Body>
        </View>
        <Button title={t('common.done')} onPress={() => router.replace('/')} testID="cashin-done" />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{t('cashin.title')}</Title>
      <Body muted>{t('cashin.body')}</Body>

      <Field
        label={t('cashin.agent')}
        value={agentCode}
        onChangeText={setAgentCode}
        autoCapitalize="characters"
        placeholder="AGENT001"
        testID="agent-input"
      />

      <Field
        label={t('cashin.amount')}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder="0.00"
        testID="amount-input"
      />

      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable
            key={p}
            style={[styles.presetChip, amountText === String(p) && styles.presetChipActive]}
            onPress={() => setAmountText(String(p))}>
            <Text style={[styles.presetText, amountText === String(p) && styles.presetTextActive]}>
              {money(p)}
            </Text>
          </Pressable>
        ))}
      </View>

      <ErrorBanner message={error} />

      <Button
        title={t('cashin.submit')}
        onPress={submit}
        busy={busy}
        disabled={!amountText.trim()}
        testID="cashin-submit"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  presets: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 4,
    flexWrap: 'wrap',
  },
  presetChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  presetText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  presetTextActive: {
    color: colors.primaryText,
  },
  successBox: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 40,
  },
  successIcon: {
    fontSize: 48,
    color: colors.success,
    fontWeight: '900',
  },
});
