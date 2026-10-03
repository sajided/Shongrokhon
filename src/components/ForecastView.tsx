// Cash-flow forecast (TC-P3-FCST-*): projected balance per day, a low-balance
// warning with an action, upcoming recurring items, and a low-confidence note.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Forecast } from '@/lib/forecast';
import { formatTaka } from '@/lib/format';

import { coachStyles } from './CoachCards';
import { colors } from './ui';

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function LowBalanceWarning({ warning }: { warning: NonNullable<Forecast['warning']> }) {
  return (
    <View style={[coachStyles.card, styles.warning]} testID="low-balance-warning" accessibilityRole="alert">
      <Text style={[coachStyles.cardTitle, { color: colors.warning }]}>
        ⚠ Low balance expected on {shortDate(warning.date)}
      </Text>
      <Text style={coachStyles.body}>
        {warning.cause
          ? `${warning.cause.name} (${formatTaka(warning.cause.amount)}) is due that day and your balance may drop to ${formatTaka(warning.balance)}.`
          : `Your balance may drop to ${formatTaka(warning.balance)}.`}
      </Text>
      <Text style={coachStyles.body} testID="warning-action">
        To stay above {formatTaka(warning.threshold)}: add {formatTaka(warning.topUp)} before then, or spend about{' '}
        {formatTaka(warning.dailyCut)} less each day. Planning ahead avoids a last-minute cash-out.
      </Text>
    </View>
  );
}

export function ForecastChart({ forecast }: { forecast: Forecast }) {
  const [horizon, setHorizon] = useState<7 | 30>(30);
  const days = forecast.days.slice(0, horizon);
  const top = Math.max(...days.map((d) => d.balance), 1);
  const bottom = Math.min(...days.map((d) => d.balance), 0);
  const range = top - bottom;
  const end = days[days.length - 1];
  const min = days.reduce((m, d) => (d.balance < m.balance ? d : m), days[0]);
  const label = `Projected balance for the next ${horizon} days: ${formatTaka(end.balance)} on ${shortDate(end.date)}. `
    + `Lowest ${formatTaka(min.balance)} on ${shortDate(min.date)}.`;

  return (
    <View style={coachStyles.card} testID="forecast-chart">
      <View style={styles.header}>
        <Text style={coachStyles.cardTitle}>Projected balance</Text>
        <View style={styles.toggle}>
          {([7, 30] as const).map((h) => (
            <Pressable key={h} onPress={() => setHorizon(h)} testID={`horizon-${h}`} accessibilityRole="button"
              accessibilityState={{ selected: horizon === h }} aria-selected={horizon === h} style={[styles.toggleItem, horizon === h && styles.toggleOn]}>
              <Text style={[styles.toggleText, horizon === h && { color: colors.text }]}>{h} days</Text>
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
        <Text style={coachStyles.muted}>{shortDate(days[0].date)}</Text>
        <Text style={coachStyles.muted}>{shortDate(end.date)}</Text>
      </View>
      <Text style={coachStyles.body} testID="forecast-end">
        {formatTaka(end.balance)} expected on {shortDate(end.date)}
      </Text>
      {forecast.shortfall > 0 && (
        <Text style={[coachStyles.body, { color: colors.danger, fontWeight: '700' }]} testID="forecast-shortfall">
          Shortfall: up to {formatTaka(forecast.shortfall)} below zero
        </Text>
      )}
    </View>
  );
}

export function RecurringList({ forecast }: { forecast: Forecast }) {
  if (forecast.recurring.length === 0) return null;
  return (
    <View style={coachStyles.card} testID="recurring-list">
      <Text style={coachStyles.cardTitle}>Coming up</Text>
      {forecast.recurring.map((r) => (
        <View key={`${r.direction}-${r.key}`} style={styles.recurring} testID="recurring-item">
          <Text style={coachStyles.body}>
            {r.name} · {shortDate(r.nextDue)}
          </Text>
          <Text style={[coachStyles.body, { color: r.direction === 'IN' ? colors.success : colors.text }]}>
            {r.direction === 'IN' ? '+' : '−'}
            {formatTaka(r.amount)}
          </Text>
        </View>
      ))}
      <Text style={coachStyles.muted}>Plus about {formatTaka(forecast.dailySpend)} of everyday spending a day.</Text>
    </View>
  );
}

export function LowConfidenceNote({ days }: { days: number }) {
  return (
    <View style={coachStyles.card} testID="forecast-low-confidence">
      <Text style={coachStyles.cardTitle}>Rough estimate</Text>
      <Text style={coachStyles.body}>
        We only have {days} day{days === 1 ? '' : 's'} of your transactions. The forecast gets reliable after a month of use.
      </Text>
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
