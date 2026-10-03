// Savings planner pieces (TC-P3-SAVE-*): the goal form with a live plan
// preview, and a goal card with progress, contributions, edit and delete.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useI18n } from '@/i18n/LocaleProvider';
import type { SavingsGoal } from '@/lib/api';
import { planGoal, progress, stillNeededMonthly, type GoalPlan } from '@/lib/savings';
import { validateAmount, validateGoalAmount, validateGoalMonths } from '@/lib/validation';

import { coachStyles } from './CoachCards';
import { Button, colors, ErrorBanner, Field, Text } from './ui';

export function PlanPreview({ plan, months }: { plan: GoalPlan; months: number }) {
  const { t, money, percent } = useI18n();
  const ok = plan.status === 'ACHIEVABLE';
  return (
    <View style={[styles.preview, !ok && plan.status !== 'UNKNOWN' && { backgroundColor: colors.warningSurface }]}
      testID="plan-preview" accessibilityLiveRegion="polite">
      <Text style={coachStyles.cardTitle} testID="plan-monthly">
        {t('goal.monthly', { amount: money(plan.monthly), count: months })}
      </Text>
      <Text style={coachStyles.body} testID="plan-status">
        {t(`goal.${plan.status}`, { share: plan.shareOfSurplus !== null ? percent(plan.shareOfSurplus) : '' })}
      </Text>
      {plan.alternatives && (
        <Text style={coachStyles.body} testID="plan-alternatives">
          {plan.alternatives.months
            ? t('goal.altMonths', { months: plan.alternatives.months })
            : t('goal.altNone')}
          {plan.alternatives.target > 0 ? t('goal.altTarget', { target: money(plan.alternatives.target), months }) : t('goal.altEnd')}
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
  const { t, msg } = useI18n();
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial ? String(initial.target) : '');
  const [months, setMonths] = useState(initial ? String(initial.months) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = validateGoalAmount(target);
  const duration = validateGoalMonths(months);
  const plan = amount.ok && duration.ok ? planGoal(amount.value, duration.value, surplus) : null;

  async function submit() {
    if (!name.trim()) return setError(msg('GOAL_NAME_INVALID'));
    if (!amount.ok) return setError(msg(amount.code));
    if (!duration.ok) return setError(msg(duration.code));
    setError(null);
    setBusy(true);
    try {
      await onSubmit(name.trim(), amount.value, duration.value);
    } catch (e) {
      setError(msg((e as { code?: string }).code ?? null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={coachStyles.card} testID="goal-form">
      <Field label={t('goal.name')} value={name} onChangeText={setName} placeholder={t('goal.namePlaceholder')} maxLength={60} testID="goal-name" />
      <Field label={t('goal.target')} value={target} onChangeText={setTarget} keyboardType="numeric" placeholder="30000" testID="goal-target" />
      <Field label={t('goal.months')} value={months} onChangeText={setMonths} keyboardType="number-pad" placeholder="6" testID="goal-months" />
      {plan && <PlanPreview plan={plan} months={duration.ok ? duration.value : 0} />}
      <ErrorBanner message={error} testID="goal-error" />
      <Button title={submitLabel} onPress={submit} busy={busy} testID="goal-submit" />
      {onCancel && <Button title={t('common.cancel')} variant="secondary" onPress={onCancel} testID="goal-cancel" />}
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
  const { t, msg, money, percent } = useI18n();
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
      setError(msg((e as { code?: string }).code ?? null));
    } finally {
      setBusy(false);
    }
  }

  async function contribute() {
    const v = validateAmount(amount, Number.POSITIVE_INFINITY);
    if (!v.ok) return setError(msg(v.code));
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
        submitLabel={t('goal.saveChanges')}
        onSubmit={async (n, target, m) => {
          await onEdit(n, target, m);
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
        <Text style={coachStyles.muted}>{money(goal.target_amount)}</Text>
      </View>
      <View style={coachStyles.track} accessible accessibilityRole="progressbar"
        accessibilityLabel={t('goal.progressA11y', { percent: percent(share) })}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
        <View style={[coachStyles.bar, { width: `${share * 100}%` }]} testID="goal-progress-bar" />
      </View>
      <Text style={coachStyles.body} testID="goal-progress">
        {t('goal.progress', { saved: money(goal.saved), remaining: money(goal.remaining) })}
      </Text>
      {goal.remaining > 0 && (
        <Text style={coachStyles.muted} testID="goal-monthly">
          {t('goal.stillNeeded', { amount: money(stillNeededMonthly(goal, today)) })}
        </Text>
      )}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label={t('goal.add')} value={amount} onChangeText={setAmount} keyboardType="numeric" testID="contribution-amount" />
        </View>
      </View>
      <Button title={t('goal.addButton')} onPress={contribute} busy={busy} disabled={!amount.trim()} testID="contribution-submit" />
      <ErrorBanner message={error} testID="goal-card-error" />
      {mode === 'confirm-delete' ? (
        <View style={styles.confirm} testID="delete-confirm" accessibilityRole="alert">
          <Text style={coachStyles.body}>{t('goal.deleteConfirm', { name: goal.name })}</Text>
          <Button title={t('goal.deleteYes')} onPress={() => run(onDelete)} busy={busy} testID="delete-confirm-yes" />
          <Button title={t('goal.deleteNo')} variant="secondary" onPress={() => setMode('view')} testID="delete-confirm-no" />
        </View>
      ) : (
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button title={t('goal.edit')} variant="secondary" onPress={() => setMode('edit')} testID="goal-edit" />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={t('goal.delete')} variant="secondary" onPress={() => setMode('confirm-delete')} testID="goal-delete" />
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
