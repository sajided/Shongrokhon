// Personal Savings Planner (TC-P3-SAVE-*). Goals are records only; no money moves.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { coachStyles, RetryCard, Skeleton } from '@/components/CoachCards';
import { GoalCard, GoalForm } from '@/components/Goals';
import { Body, Screen, Title } from '@/components/ui';
import {
  addSavingsContribution, ApiError, createSavingsGoal, deleteSavingsGoal, getSavingsGoals, updateSavingsGoal,
  type SavingsOverview,
} from '@/lib/api';
import { formatTaka } from '@/lib/format';
import { messageFor } from '@/lib/messages';
import { checkCommitment } from '@/lib/savings';

export default function SavingsScreen() {
  const [data, setData] = useState<SavingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getSavingsGoals());
      setError(null);
    } catch (e) {
      setError(messageFor(e instanceof ApiError ? e.code : null));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const surplus = data?.surplus.surplus ?? null;
  const commitment = data ? checkCommitment(data.goals, surplus, new Date()) : null;

  return (
    <Screen>
      <Title>Savings planner</Title>
      {error && <RetryCard message={error} onRetry={load} testID="savings-error" />}
      {!data && !error && <Skeleton testID="savings-skeleton" />}
      {data && (
        <>
          <Body muted>
            {surplus === null
              ? 'Once you have a month of transactions, we will check each goal against your spending.'
              : surplus > 0
                ? `You usually have about ${formatTaka(surplus)} left each month after spending.`
                : 'Lately you have spent more than came in each month.'}
          </Body>
          {commitment?.overCommitted && (
            <Text style={[coachStyles.body, { fontWeight: '700' }]} testID="overcommitted" accessibilityRole="alert">
              ⚠ Your goals need {formatTaka(commitment.total)} a month together, more than you usually have left.
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
          <Text style={coachStyles.cardTitle}>New goal</Text>
          <GoalForm
            key={data.goals.length} // a fresh form after each new goal
            surplus={surplus}
            submitLabel="Save goal"
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
