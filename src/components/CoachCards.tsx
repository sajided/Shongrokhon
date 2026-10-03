// AI coach dashboard pieces (TC-P3-COACH-*). Charts are plain Views: one hue
// for magnitude, every bar labelled with text, and an accessibilityLabel that
// reads the whole chart as text (TC-P3-COACH-08).
import { Pressable, StyleSheet, View } from 'react-native';

import { useI18n } from '@/i18n/LocaleProvider';
import type { CoachDashboard, CoachPeriod, Insight } from '@/lib/api';

import { Button, colors, Text } from './ui';

const PERIODS: CoachPeriod[] = ['WEEK', 'MONTH', '3M'];

export function PeriodFilter({ value, onChange }: { value: CoachPeriod; onChange: (p: CoachPeriod) => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {PERIODS.map((p) => {
        const selected = p === value;
        return (
          <Pressable
            key={p}
            testID={`period-${p}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected} // react-native-web does not map accessibilityState.selected
            onPress={() => onChange(p)}
            style={[styles.segmentItem, selected && styles.segmentSelected]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{t(`coach.period.${p}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SummaryRow({ dashboard }: { dashboard: CoachDashboard }) {
  const { t, money } = useI18n();
  return (
    <View style={styles.summary} testID="coach-summary">
      <Stat label={t('coach.moneyIn')} value={money(dashboard.income)} testID="coach-income" />
      <Stat label={t('coach.spent')} value={money(dashboard.spending)} testID="coach-spending" />
      <Stat label={t('coach.saved')} value={money(dashboard.saved)} testID="coach-saved" />
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
  const { t, money, percent } = useI18n();
  const max = Math.max(...categories.map((c) => c.total), 1);
  const description = categories
    .map((c) => `${t(`category.${c.category}`)} ${money(c.total)}, ${percent(c.share)}`)
    .join('; ');
  return (
    <View style={styles.card} testID="category-breakdown" accessible accessibilityLabel={t('coach.whereA11y', { list: description })}>
      <Text style={styles.cardTitle}>{t('coach.whereTitle')}</Text>
      {categories.map((c) => (
        <View key={c.category} style={styles.barRow} testID={`category-${c.category}`}>
          <View style={styles.barLabels}>
            <Text style={styles.barName}>{t(`category.${c.category}`)}</Text>
            <Text style={styles.barValue}>
              {money(c.total)} · {percent(c.share)}
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

/** Cash-out share with a plain-language explanation (TC-P3-COACH-03). */
export function CashDependencyCard({ cashout }: { cashout: CoachDashboard['cashout'] }) {
  const { t, money, percent } = useI18n();
  const level = { label: t(`coach.level.${cashout.level}`), explain: t(`coach.explain.${cashout.level}`) };
  const high = cashout.level !== 'LOW';
  return (
    <View
      style={[styles.card, high && styles.cardWarning]}
      testID="cash-dependency"
      accessible
      accessibilityLabel={t('coach.cashA11y', { level: level.label, share: percent(cashout.share), count: cashout.count,
                                                amount: money(cashout.total), explain: level.explain })}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{t('coach.cashTitle')}</Text>
        <Text style={[styles.badge, high && styles.badgeWarning]} testID="cash-level">
          {high ? '⚠ ' : ''}
          {level.label}
        </Text>
      </View>
      <Text style={styles.big} testID="cash-share">
        {percent(cashout.share)}
        <Text style={styles.bigSuffix}>{t('coach.cashShare')}</Text>
      </Text>
      <View style={styles.track}>
        <View style={[styles.bar, high && { backgroundColor: colors.warning }, { width: `${Math.min(cashout.share * 100, 100)}%` }]} />
      </View>
      <Text style={styles.muted}>
        {t('coach.cashCount', { count: cashout.count, amount: money(cashout.total) })}
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
  const { t } = useI18n();
  return (
    <View style={[styles.card, { gap: 10 }]} testID={testID} accessibilityLabel={t('common.loading')} accessibilityRole="progressbar">
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[styles.skeletonLine, { width: `${90 - i * 20}%` }]} />
      ))}
    </View>
  );
}

export function RetryCard({ message, onRetry, testID }: { message: string; onRetry: () => void; testID: string }) {
  const { t } = useI18n();
  return (
    <View style={[styles.card, { gap: 12 }]} testID={testID} accessibilityRole="alert">
      <Text style={styles.body}>{message}</Text>
      <Button title={t('common.tryAgain')} variant="secondary" onPress={onRetry} testID={`${testID}-retry`} />
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
