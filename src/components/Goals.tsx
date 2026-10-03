// Savings planner pieces (TC-P3-SAVE-*): the goal form with a live plan
// preview, and a goal card with progress, contributions, edit and delete.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SavingsGoal } from '@/lib/api';
import { formatTaka } from '@/lib/format';
import { messageFor } from '@/lib/messages';
import { planGoal, progress, stillNeededMonthly, type GoalPlan } from '@/lib/savings';
import { validateAmount, validateGoalAmount, validateGoalMonths } from '@/lib/validation';

import { coachStyles } from './CoachCards';
import { Button, colors, ErrorBanner, Field } from './ui';

export function PlanPreview({ plan, months }: { plan: GoalPlan; months: number }) {
  const ok = plan.status === 'ACHIEVABLE';
  return (
    <View style={[styles.preview, !ok && plan.status !== 'UNKNOWN' && { backgroundColor: colors.warningSurface }]}
      testID="plan-preview" accessibilityLiveRegion="polite">
      <Text style={coachStyles.cardTitle} testID="plan-monthly">
        {formatTaka(plan.monthly)} a month for {months} month{months === 1 ? '' : 's'}
      </Text>
      <Text style={coachStyles.body} testID="plan-status">
        {plan.status === 'ACHIEVABLE' && `Realistic: that is ${Math.round(plan.shareOfSurplus! * 100)}% of what you usually have left each month.`}
        {plan.status === 'TIGHT' && 'Possible but tight: it needs almost everything you usually have left each month.'}
        {plan.status === 'UNREALISTIC' && 'Not realistic right now: it needs more than you usually have left each month.'}
        {plan.status === 'UNKNOWN' && 'We need a month of your transactions to check this plan against your spending.'}
      </Text>
      {plan.alternatives && (
        <Text style={coachStyles.body} testID="plan-alternatives">
          {plan.alternatives.months
            ? `Try ${plan.alternatives.months} months instead`
            : 'A longer timeline would not be enough'}
          {plan.alternatives.target > 0 ? `, or a target of ${formatTaka(plan.alternatives.target)} in ${months} months.` : '.'}
        </Text>
      )}
    </View>
  );
}

export function GoalForm({
  surplus,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  surplus: number | null;
  initial?: { name: string; target: number; months: number };
  submitLabel: string;
  onSubmit: (name: string, target: number, months: number) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial ? String(initial.target) : '');
  const [months, setMonths] = useState(initial ? String(initial.months) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = validateGoalAmount(target);
  const duration = validateGoalMonths(months);
  const plan = amount.ok && duration.ok ? planGoal(amount.value, duration.value, surplus) : null;

  async function submit() {
    if (!name.trim()) return setError(messageFor('GOAL_NAME_INVALID'));
    if (!amount.ok) return setError(messageFor(amount.code));
    if (!duration.ok) return setError(messageFor(duration.code));
    setError(null);
    setBusy(true);
    try {
      await onSubmit(name.trim(), amount.value, duration.value);
    } catch (e) {
      setError(messageFor((e as { code?: string }).code ?? null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={coachStyles.card} testID="goal-form">
      <Field label="Goal" value={name} onChangeText={setName} placeholder="Eid shopping" maxLength={60} testID="goal-name" />
      <Field label="Target (৳)" value={target} onChangeText={setTarget} keyboardType="numeric" placeholder="30000" testID="goal-target" />
      <Field label="Months" value={months} onChangeText={setMonths} keyboardType="number-pad" placeholder="6" testID="goal-months" />
      {plan && <PlanPreview plan={plan} months={duration.ok ? duration.value : 0} />}
      <ErrorBanner message={error} testID="goal-error" />
      <Button title={submitLabel} onPress={submit} busy={busy} testID="goal-submit" />
      {onCancel && <Button title="Cancel" variant="secondary" onPress={onCancel} testID="goal-cancel" />}
    </View>
  );
}

export function GoalCard({
  goal,
  surplus,
  today = new Date(),
  onContribute,
  onEdit,
  onDelete,
}: {
  goal: SavingsGoal;
  surplus: number | null;
  today?: Date;
  onContribute: (amount: number) => Promise<void>;
  onEdit: (name: string, target: number, months: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm-delete'>('view');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const share = progress(goal);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(messageFor((e as { code?: string }).code ?? null));
    } finally {
      setBusy(false);
    }
  }

  async function contribute() {
    const v = validateAmount(amount, Number.POSITIVE_INFINITY);
    if (!v.ok) return setError(messageFor(v.code));
    await run(async () => {
      await onContribute(v.value);
      setAmount('');
    });
  }

  if (mode === 'edit') {
    return (
      <GoalForm
        surplus={surplus}
        initial={{ name: goal.name, target: goal.target_amount, months: goal.months }}
        submitLabel="Save changes"
        onSubmit={async (n, t, m) => {
          await onEdit(n, t, m);
          setMode('view');
        }}
        onCancel={() => setMode('view')}
      />
    );
  }

  return (
    <View style={coachStyles.card} testID="goal-card">
      <View style={styles.row}>
        <Text style={coachStyles.cardTitle}>{goal.name}</Text>
        <Text style={coachStyles.muted}>{formatTaka(goal.target_amount)}</Text>
      </View>
      <View style={coachStyles.track} accessible accessibilityRole="progressbar"
        accessibilityLabel={`${Math.round(share * 100)}% saved`}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
        <View style={[coachStyles.bar, { width: `${share * 100}%` }]} testID="goal-progress-bar" />
      </View>
      <Text style={coachStyles.body} testID="goal-progress">
        {formatTaka(goal.saved)} saved · {formatTaka(goal.remaining)} to go
      </Text>
      {goal.remaining > 0 && (
        <Text style={coachStyles.muted} testID="goal-monthly">
          About {formatTaka(stillNeededMonthly(goal, today))} a month to finish on time
        </Text>
      )}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Add savings (৳)" value={amount} onChangeText={setAmount} keyboardType="numeric" testID="contribution-amount" />
        </View>
      </View>
      <Button title="Add" onPress={contribute} busy={busy} disabled={!amount.trim()} testID="contribution-submit" />
      <ErrorBanner message={error} testID="goal-card-error" />
      {mode === 'confirm-delete' ? (
        <View style={styles.confirm} testID="delete-confirm" accessibilityRole="alert">
          <Text style={coachStyles.body}>Delete “{goal.name}” and its saved progress?</Text>
          <Button title="Delete goal" onPress={() => run(onDelete)} busy={busy} testID="delete-confirm-yes" />
          <Button title="Keep it" variant="secondary" onPress={() => setMode('view')} testID="delete-confirm-no" />
        </View>
      ) : (
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button title="Edit" variant="secondary" onPress={() => setMode('edit')} testID="goal-edit" />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Delete" variant="secondary" onPress={() => setMode('confirm-delete')} testID="goal-delete" />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { backgroundColor: colors.background, borderRadius: 10, padding: 12, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', gap: 8 },
  confirm: { backgroundColor: colors.dangerSurface, borderRadius: 10, padding: 12, gap: 8 },
});
