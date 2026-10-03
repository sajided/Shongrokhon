// AI coach dashboard pieces (TC-P3-COACH-*). Charts are plain Views: one hue
// for magnitude, every bar labelled with text, and an accessibilityLabel that
// reads the whole chart as text (TC-P3-COACH-08).
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CoachDashboard, CoachPeriod, Insight, SpendCategory } from '@/lib/api';
import { formatTaka } from '@/lib/format';

import { Button, colors } from './ui';

export const CATEGORY_LABELS: Record<SpendCategory, string> = {
  FOOD: 'Food', TRANSPORT: 'Transport', UTILITIES: 'Utilities', BILLS: 'Bills & rent', SHOPPING: 'Shopping',
  HEALTH: 'Health', EDUCATION: 'Education', SAVINGS: 'Savings', CASH_OUT: 'Cash-out', OTHERS: 'Others',
};

const PERIODS: { value: CoachPeriod; label: string }[] = [
  { value: 'WEEK', label: '7 days' },
  { value: 'MONTH', label: '30 days' },
  { value: '3M', label: '3 months' },
];

const pct = (share: number) => `${Math.round(share * 100)}%`;

export function PeriodFilter({ value, onChange }: { value: CoachPeriod; onChange: (p: CoachPeriod) => void }) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {PERIODS.map((p) => {
        const selected = p.value === value;
        return (
          <Pressable
            key={p.value}
            testID={`period-${p.value}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected} // react-native-web does not map accessibilityState.selected
            onPress={() => onChange(p.value)}
            style={[styles.segmentItem, selected && styles.segmentSelected]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{p.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SummaryRow({ dashboard }: { dashboard: CoachDashboard }) {
  return (
    <View style={styles.summary} testID="coach-summary">
      <Stat label="Money in" value={formatTaka(dashboard.income)} testID="coach-income" />
      <Stat label="Spent" value={formatTaka(dashboard.spending)} testID="coach-spending" />
      <Stat label="Saved" value={formatTaka(dashboard.saved)} testID="coach-saved" />
    </View>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} testID={testID}>{value}</Text>
    </View>
  );
}

/** Spending by category, largest first (TC-P3-COACH-01/02). */
export function CategoryBreakdown({ categories }: { categories: CoachDashboard['categories'] }) {
  const max = Math.max(...categories.map((c) => c.total), 1);
  const description = categories
    .map((c) => `${CATEGORY_LABELS[c.category]} ${formatTaka(c.total)}, ${pct(c.share)}`)
    .join('; ');
  return (
    <View style={styles.card} testID="category-breakdown" accessible accessibilityLabel={`Spending by category: ${description}`}>
      <Text style={styles.cardTitle}>Where your money went</Text>
      {categories.map((c) => (
        <View key={c.category} style={styles.barRow} testID={`category-${c.category}`}>
          <View style={styles.barLabels}>
            <Text style={styles.barName}>{CATEGORY_LABELS[c.category]}</Text>
            <Text style={styles.barValue}>
              {formatTaka(c.total)} · {pct(c.share)}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${Math.max((c.total / max) * 100, 2)}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const LEVEL_TEXT = {
  LOW: { label: 'Low', explain: 'Most of your spending is digital. Keep paying by QR.' },
  MEDIUM: { label: 'Medium', explain: 'A fair share of your money leaves as cash. Paying shops by QR saves cash-out fees.' },
  HIGH: {
    label: 'High',
    explain: 'Most of your money leaves your wallet as cash. Each cash-out costs a fee; paying shops directly by QR avoids it and shows you where the money goes.',
  },
} as const;

/** Cash-out share with a plain-language explanation (TC-P3-COACH-03). */
export function CashDependencyCard({ cashout }: { cashout: CoachDashboard['cashout'] }) {
  const level = LEVEL_TEXT[cashout.level];
  const high = cashout.level !== 'LOW';
  return (
    <View
      style={[styles.card, high && styles.cardWarning]}
      testID="cash-dependency"
      accessible
      accessibilityLabel={`Cash dependency ${level.label}: cash-outs are ${pct(cashout.share)} of your spending, ${cashout.count} cash-outs, ${formatTaka(cashout.total)}. ${level.explain}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Cash dependency</Text>
        <Text style={[styles.badge, high && styles.badgeWarning]} testID="cash-level">
          {high ? '⚠ ' : ''}
          {level.label}
        </Text>
      </View>
      <Text style={styles.big} testID="cash-share">
        {pct(cashout.share)}
        <Text style={styles.bigSuffix}> of spending was cash-out</Text>
      </Text>
      <View style={styles.track}>
        <View style={[styles.bar, high && { backgroundColor: colors.warning }, { width: `${Math.min(cashout.share * 100, 100)}%` }]} />
      </View>
      <Text style={styles.muted}>
        {cashout.count} cash-out{cashout.count === 1 ? '' : 's'}, {formatTaka(cashout.total)}
      </Text>
      <Text style={styles.body}>{level.explain}</Text>
    </View>
  );
}

export function InsightCards({ insights }: { insights: Insight[] }) {
  return (
    <View style={{ gap: 12 }} testID="insight-cards">
      {insights.map((i, n) => (
        <View key={n} style={[styles.card, i.kind === 'CASH' && styles.cardWarning]} testID="insight-card">
          <Text style={styles.cardTitle}>{i.title}</Text>
          <Text style={styles.body}>{i.body}</Text>
        </View>
      ))}
    </View>
  );
}

/** Placeholder blocks while data loads (TC-P3-COACH-06). */
export function Skeleton({ lines = 3, testID = 'skeleton' }: { lines?: number; testID?: string }) {
  return (
    <View style={[styles.card, { gap: 10 }]} testID={testID} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[styles.skeletonLine, { width: `${90 - i * 20}%` }]} />
      ))}
    </View>
  );
}

export function RetryCard({ message, onRetry, testID }: { message: string; onRetry: () => void; testID: string }) {
  return (
    <View style={[styles.card, { gap: 12 }]} testID={testID} accessibilityRole="alert">
      <Text style={styles.body}>{message}</Text>
      <Button title="Try again" variant="secondary" onPress={onRetry} testID={`${testID}-retry`} />
    </View>
  );
}

export function EmptyState({ title, body, testID = 'empty-state' }: { title: string; body: string; testID?: string }) {
  return (
    <View style={[styles.card, { alignItems: 'center', gap: 8 }]} testID={testID}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={[styles.body, { textAlign: 'center' }]}>{body}</Text>
    </View>
  );
}

export const coachStyles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, lineHeight: 21, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5, backgroundColor: colors.primary },
});

const styles = StyleSheet.create({
  ...coachStyles,
  cardWarning: { backgroundColor: colors.warningSurface },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { fontSize: 13, fontWeight: '700', color: colors.muted },
  badgeWarning: { color: colors.warning },
  big: { fontSize: 28, fontWeight: '700', color: colors.text },
  bigSuffix: { fontSize: 15, fontWeight: '400', color: colors.muted },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 10, padding: 4, gap: 4 },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentSelected: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  segmentText: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  segmentTextSelected: { color: colors.text },
  summary: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 2 },
  statLabel: { fontSize: 12, color: colors.muted },
  statValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  barRow: { gap: 4 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
  barName: { fontSize: 14, color: colors.text, fontWeight: '600' },
  barValue: { fontSize: 14, color: colors.muted },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: colors.border },
});
