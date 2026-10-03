// Cash-flow forecast (TC-P3-FCST-*): projected balance per day, a low-balance
// warning with an action, upcoming recurring items, and a low-confidence note.
// Phase 4: a bill behind the warning can be paid right away (TC-P4-E2E-04).
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useI18n, type I18n } from '@/i18n/LocaleProvider';
import type { Forecast, Recurring } from '@/lib/forecast';

import { coachStyles } from './CoachCards';
import { Button, colors, Text } from './ui';

function recurringName(r: Pick<Recurring, 'key' | 'name'>, t: I18n['t']) {
  if (r.key === 'INCOME') return t('forecast.income');
  if (r.key === 'CASH_OUT') return t('forecast.cashout');
  return r.name;
}

export function LowBalanceWarning({ warning, onPayBill }: {
  warning: NonNullable<Forecast['warning']>;
  /** Pay the bill behind the warning now (bill pay, pre-filled). */
  onPayBill?: (merchantId: string) => void;
}) {
  const { t, money, day } = useI18n();
  const cause = warning.cause;
  return (
    <View style={[coachStyles.card, styles.warning]} testID="low-balance-warning" accessibilityRole="alert">
      <Text style={[coachStyles.cardTitle, { color: colors.warning }]}>{t('forecast.lowTitle', { date: day(warning.date) })}</Text>
      <Text style={coachStyles.body}>
        {cause
          ? t('forecast.lowCause', { name: cause.name, amount: money(cause.amount), balance: money(warning.balance) })
          : t('forecast.lowNoCause', { balance: money(warning.balance) })}
      </Text>
      <Text style={coachStyles.body} testID="warning-action">
        {t('forecast.lowAction', { threshold: money(warning.threshold), topUp: money(warning.topUp), dailyCut: money(warning.dailyCut) })}
      </Text>
      {cause?.merchantId && onPayBill && (
        <Button title={t('forecast.payNow', { name: cause.name })} onPress={() => onPayBill(cause.merchantId!)} testID="warning-pay-now" />
      )}
    </View>
  );
}

export function ForecastChart({ forecast }: { forecast: Forecast }) {
  const { t, money, day } = useI18n();
  const [horizon, setHorizon] = useState<7 | 30>(30);
  const days = forecast.days.slice(0, horizon);
  const top = Math.max(...days.map((d) => d.balance), 1);
  const bottom = Math.min(...days.map((d) => d.balance), 0);
  const range = top - bottom;
  const end = days[days.length - 1];
  const min = days.reduce((m, d) => (d.balance < m.balance ? d : m), days[0]);
  const label = t('forecast.a11y', {
    days: horizon, end: money(end.balance), endDate: day(end.date), min: money(min.balance), minDate: day(min.date),
  });

  return (
    <View style={coachStyles.card} testID="forecast-chart">
      <View style={styles.header}>
        <Text style={coachStyles.cardTitle}>{t('forecast.projected')}</Text>
        <View style={styles.toggle}>
          {([7, 30] as const).map((h) => (
            <Pressable key={h} onPress={() => setHorizon(h)} testID={`horizon-${h}`} accessibilityRole="button"
              accessibilityState={{ selected: horizon === h }} aria-selected={horizon === h} style={[styles.toggleItem, horizon === h && styles.toggleOn]}>
              <Text style={[styles.toggleText, horizon === h && { color: colors.text }]}>{t('forecast.days', { count: h })}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.plot} accessible accessibilityLabel={label} testID="forecast-plot">
        {days.map((d) => {
          const negative = d.balance < 0;
          return (
            <View key={d.date} style={styles.column}>
              <View style={{ flex: (top - Math.max(d.balance, 0)) / range }} />
              <View style={[styles.dayBar, negative && styles.dayBarNegative,
                { flex: Math.max(Math.abs(d.balance) / range, 0.004) }]} />
              <View style={{ flex: (Math.min(d.balance, 0) - bottom) / range }} />
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={coachStyles.muted}>{day(days[0].date)}</Text>
        <Text style={coachStyles.muted}>{day(end.date)}</Text>
      </View>
      <Text style={coachStyles.body} testID="forecast-end">
        {t('forecast.end', { amount: money(end.balance), date: day(end.date) })}
      </Text>
      {forecast.shortfall > 0 && (
        <Text style={[coachStyles.body, { color: colors.danger, fontWeight: '700' }]} testID="forecast-shortfall">
          {t('forecast.shortfall', { amount: money(forecast.shortfall) })}
        </Text>
      )}
    </View>
  );
}

export function RecurringList({ forecast }: { forecast: Forecast }) {
  const { t, money, day } = useI18n();
  if (forecast.recurring.length === 0) return null;
  return (
    <View style={coachStyles.card} testID="recurring-list">
      <Text style={coachStyles.cardTitle}>{t('forecast.comingUp')}</Text>
      {forecast.recurring.map((r) => (
        <View key={`${r.direction}-${r.key}`} style={styles.recurring} testID="recurring-item">
          <Text style={coachStyles.body}>
            {recurringName(r, t)} · {day(r.nextDue)}
          </Text>
          <Text style={[coachStyles.body, { color: r.direction === 'IN' ? colors.success : colors.text }]}>
            {r.direction === 'IN' ? '+' : '−'}
            {money(r.amount)}
          </Text>
        </View>
      ))}
      <Text style={coachStyles.muted}>{t('forecast.everyday', { amount: money(forecast.dailySpend) })}</Text>
    </View>
  );
}

export function LowConfidenceNote({ days }: { days: number }) {
  const { t } = useI18n();
  return (
    <View style={coachStyles.card} testID="forecast-low-confidence">
      <Text style={coachStyles.cardTitle}>{t('forecast.roughTitle')}</Text>
      <Text style={coachStyles.body}>{t('forecast.roughBody', { count: days })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  warning: { backgroundColor: colors.warningSurface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggle: { flexDirection: 'row', gap: 4 },
  toggleItem: { paddingHorizontal: 10, minHeight: 32, borderRadius: 8, justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  toggleText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  plot: { height: 140, flexDirection: 'row', gap: 2 },
  column: { flex: 1 },
  dayBar: { backgroundColor: colors.primary, borderRadius: 2 },
  dayBarNegative: { backgroundColor: colors.danger },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  recurring: { flexDirection: 'row', justifyContent: 'space-between' },
});
