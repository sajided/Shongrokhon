// Smart Spending Companion (TC-P4-SSC-01/03/04/05): shown before a repeated
// cash-out executes. Advice only: "Continue" goes on to the normal cash-out,
// and nothing has been debited at this point.
import { StyleSheet, View } from 'react-native';

import { useI18n } from '@/i18n/LocaleProvider';
import type { NudgeChoice } from '@/lib/api';

import { Button, colors, Text } from './ui';

const ALTERNATIVES: Exclude<NudgeChoice, 'CONTINUE' | 'CANCEL'>[] = ['PAY_QR', 'BILL_PAY', 'SEND_MONEY'];

export function Interception({
  nth, amount, fee, busy, onChoose,
}: { nth: number; amount: number; fee: number; busy?: boolean; onChoose: (choice: NudgeChoice) => void }) {
  const { t, money, ordinal } = useI18n();
  return (
    <View style={styles.container} testID="interception">
      <View style={styles.card}>
        <Text style={styles.heading} accessibilityRole="header">
          {t('nudge.title')}
        </Text>
        <Text style={styles.text} testID="interception-count">
          {t('nudge.body', { ordinal: ordinal(nth) })}
        </Text>
        <Text style={styles.text} testID="interception-fee">
          {t('nudge.fee', { amount: money(amount), fee: money(fee) })}
        </Text>
      </View>
      <Text style={styles.subheading}>{t('nudge.alternatives')}</Text>
      {ALTERNATIVES.map((choice) => (
        <View key={choice} style={styles.alternative}>
          <Button title={t(`nudge.${choice}`)} onPress={() => onChoose(choice)} disabled={busy} testID={`nudge-${choice}`} />
          <Text style={styles.why}>{t(`nudge.${choice}.why`)}</Text>
        </View>
      ))}
      <Button title={t('nudge.continue')} variant="secondary" onPress={() => onChoose('CONTINUE')} disabled={busy}
        testID="nudge-CONTINUE" />
      <Button title={t('nudge.cancel')} variant="secondary" onPress={() => onChoose('CANCEL')} disabled={busy}
        testID="nudge-CANCEL" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  card: { backgroundColor: colors.warningSurface, borderRadius: 12, padding: 16, gap: 8 },
  heading: { color: colors.warning, fontSize: 18, fontWeight: '700' },
  subheading: { color: colors.text, fontSize: 15, fontWeight: '700' },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  alternative: { gap: 4 },
  why: { color: colors.muted, fontSize: 13, paddingHorizontal: 4 },
});
