// AI Financial Health Coach dashboard (TC-P3-COACH-*). Numbers load first from
// get_coach_dashboard; insight text loads separately from the `coach` Edge
// Function (slower: LLM), with its own skeleton and retry.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AskCoach } from '@/components/AskCoach';
import {
  CashDependencyCard, CategoryBreakdown, EmptyState, InsightCards, PeriodFilter, RetryCard, Skeleton, SummaryRow,
} from '@/components/CoachCards';
import { Button, colors } from '@/components/ui';
import {
  ApiError, getCoachDashboard, getInsights, type CoachDashboard, type CoachPeriod, type InsightsResponse,
} from '@/lib/api';
import { messageFor } from '@/lib/messages';

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

const errorOf = (e: unknown) => ({ state: 'error' as const, message: messageFor(e instanceof ApiError ? e.code : null) });

export default function CoachScreen() {
  const [period, setPeriod] = useState<CoachPeriod>('MONTH');
  const [dashboard, setDashboard] = useState<Load<CoachDashboard>>({ state: 'loading' });
  const [insights, setInsights] = useState<Load<InsightsResponse>>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0); // ignore responses for a period the user has already left

  const loadDashboard = useCallback(async (p: CoachPeriod, request: number) => {
    try {
      const data = await getCoachDashboard(p);
      if (latest.current === request) setDashboard({ state: 'ready', data });
    } catch (e) {
      if (latest.current === request) setDashboard(errorOf(e));
    }
  }, []);

  const loadInsights = useCallback(async (p: CoachPeriod, request: number) => {
    try {
      const data = await getInsights(p);
      if (latest.current !== request) return;
      setInsights({ state: 'ready', data });
      // New merchants were just categorised: reload the numbers so the breakdown uses them.
      if (data.categories_updated) await loadDashboard(p, request);
    } catch (e) {
      if (latest.current === request) setInsights(errorOf(e));
    }
  }, [loadDashboard]);

  const load = useCallback(async (p: CoachPeriod) => {
    const request = ++latest.current;
    setDashboard({ state: 'loading' });
    setInsights({ state: 'loading' });
    await Promise.all([loadDashboard(p, request), loadInsights(p, request)]);
  }, [loadDashboard, loadInsights]);

  useFocusEffect(
    useCallback(() => {
      load(period);
    }, [load, period]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(period);
    setRefreshing(false);
  }, [load, period]);

  const empty = dashboard.state === 'ready' && dashboard.data.txn_count === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <PeriodFilter value={period} onChange={setPeriod} />

        {dashboard.state === 'loading' && <Skeleton lines={4} testID="dashboard-skeleton" />}
        {dashboard.state === 'error' && (
          <RetryCard message={dashboard.message} onRetry={() => load(period)} testID="dashboard-error" />
        )}
        {empty && (
          <EmptyState
            title="Nothing to show yet"
            body="Make a few payments with Shongrokhon and your coach will explain where your money goes."
          />
        )}
        {dashboard.state === 'ready' && !empty && (
          <>
            <SummaryRow dashboard={dashboard.data} />
            <CashDependencyCard cashout={dashboard.data.cashout} />
            <CategoryBreakdown categories={dashboard.data.categories} />
          </>
        )}

        {!empty && (
          <View style={{ gap: 12 }}>
            <Text style={styles.section}>Coach insights</Text>
            {insights.state === 'loading' && <Skeleton testID="insights-skeleton" />}
            {insights.state === 'error' && (
              <RetryCard message={insights.message} onRetry={() => load(period)} testID="insights-error" />
            )}
            {insights.state === 'ready' && insights.data.status === 'INSUFFICIENT_DATA' && (
              <EmptyState title="Not enough data yet" body="A few more transactions and your coach will have tips for you."
                testID="insights-empty" />
            )}
            {insights.state === 'ready' && insights.data.status === 'OK' && <InsightCards insights={insights.data.insights} />}
          </View>
        )}

        <Button title="Savings planner" variant="secondary" onPress={() => router.push('/coach/savings')} testID="open-savings" />
        <Button title="Cash-flow forecast" variant="secondary" onPress={() => router.push('/coach/forecast')} testID="open-forecast" />
        {!empty && <AskCoach />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16, width: '100%', maxWidth: 480, alignSelf: 'center' },
  section: { fontSize: 16, fontWeight: '700', color: colors.text },
});
