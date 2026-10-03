// Personal Savings Planner (TC-P3-SAVE-*). Goals are records only; no money moves.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { coachStyles, RetryCard, Skeleton } from '@/components/CoachCards';
import { GoalCard, GoalForm } from '@/components/Goals';
import { Body, Screen, Text, Title } from '@/components/ui';
import { useI18n } from '@/i18n/LocaleProvider';
import { useScreenView } from '@/lib/analytics';
import {
  addSavingsContribution, ApiError, createSavingsGoal, deleteSavingsGoal, getSavingsGoals, updateSavingsGoal,
  type SavingsOverview,
} from '@/lib/api';
import { checkCommitment } from '@/lib/savings';

export default function SavingsScreen() {
  const { t, msg, money } = useI18n();
  useScreenView('savings');
  const [data, setData] = useState<SavingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getSavingsGoals());
      setError(null);
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    }
  }, [msg]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const surplus = data?.surplus.surplus ?? null;
  const commitment = data ? checkCommitment(data.goals, surplus, new Date()) : null;

  return (
    <Screen>
      <Title>{t('savings.title')}</Title>
      {error && <RetryCard message={error} onRetry={load} testID="savings-error" />}
      {!data && !error && <Skeleton testID="savings-skeleton" />}
      {data && (
        <>
          <Body muted>
            {surplus === null
              ? t('savings.noHistory')
              : surplus > 0
                ? t('savings.surplus', { amount: money(surplus) })
                : t('savings.deficit')}
          </Body>
          {commitment?.overCommitted && (
            <Text style={[coachStyles.body, { fontWeight: '700' }]} testID="overcommitted" accessibilityRole="alert">
              {t('savings.overcommitted', { amount: money(commitment.total) })}
            </Text>
          )}
          {data.goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              surplus={surplus}
              onContribute={async (amount) => {
                await addSavingsContribution(goal.id, amount);
                await load();
              }}
              onEdit={async (name, target, months) => {
                await updateSavingsGoal(goal.id, name, target, months);
                await load();
              }}
              onDelete={async () => {
                await deleteSavingsGoal(goal.id);
                await load();
              }}
            />
          ))}
          <Text style={coachStyles.cardTitle}>{t('savings.newGoal')}</Text>
          <GoalForm
            key={data.goals.length} // a fresh form after each new goal
            surplus={surplus}
            submitLabel={t('goal.save')}
            onSubmit={async (name, target, months) => {
              await createSavingsGoal(name, target, months);
              await load();
            }}
          />
        </>
      )}
    </Screen>
  );
}
