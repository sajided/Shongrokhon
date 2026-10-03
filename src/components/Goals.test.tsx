import { fireEvent, render, screen } from '@testing-library/react-native';

import type { SavingsGoal } from '@/lib/api';
import { ApiError } from '@/lib/errors';

import { GoalCard, GoalForm } from './Goals';

const goal = (over: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'g1', name: 'Eid', target_amount: 30000, months: 6, start_date: '2026-10-03', created_at: '2026-10-03T00:00:00Z',
  saved: 9000, remaining: 21000, ...over,
});

describe('TC-P3-SAVE-01/02/08: goal form with plan preview', () => {
  it('Bangla digits: ৩০০০০ over ৬ months is ৳5,000 a month, realistic on an ৳8,000 surplus', async () => {
    const onSubmit = jest.fn(async () => {});
    await render(<GoalForm surplus={8000} submitLabel="Save goal" onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('goal-name'), 'Eid');
    await fireEvent.changeText(screen.getByTestId('goal-target'), '৩০০০০');
    await fireEvent.changeText(screen.getByTestId('goal-months'), '৬');
    expect(screen.getByTestId('plan-monthly')).toHaveTextContent('৳5,000.00 a month for 6 months');
    expect(screen.getByTestId('plan-status')).toHaveTextContent(/Realistic/);
    await fireEvent.press(screen.getByTestId('goal-submit'));
    expect(onSubmit).toHaveBeenCalledWith('Eid', 30000, 6);
  });

  it('flags the same goal as unrealistic on a ৳3,000 surplus, with alternatives', async () => {
    await render(<GoalForm surplus={3000} submitLabel="Save goal" onSubmit={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('goal-target'), '30000');
    await fireEvent.changeText(screen.getByTestId('goal-months'), '6');
    expect(screen.getByTestId('plan-status')).toHaveTextContent(/Not realistic/);
    expect(screen.getByTestId('plan-alternatives')).toHaveTextContent('Try 13 months instead, or a target of ৳14,400.00 in 6 months.');
  });

  it.each([
    ['', '30000', '6', /Give your goal a name/],
    ['Eid', '0', '6', /greater than zero/],
    ['Eid', 'abc', '6', /greater than zero/],
    ['Eid', '30000', '0', /between 1 and 60/],
    ['Eid', '30000', '61', /between 1 and 60/],
    ['Eid', '2000000', '6', /at most ৳10,00,000/],
  ])('TC-P3-SAVE-03: rejects name=%p target=%p months=%p', async (name, target, months, message) => {
    const onSubmit = jest.fn();
    await render(<GoalForm surplus={8000} submitLabel="Save goal" onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('goal-name'), name);
    await fireEvent.changeText(screen.getByTestId('goal-target'), target);
    await fireEvent.changeText(screen.getByTestId('goal-months'), months);
    await fireEvent.press(screen.getByTestId('goal-submit'));
    expect(screen.getByTestId('goal-error')).toHaveTextContent(message);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows server errors', async () => {
    const onSubmit = jest.fn(async () => {
      throw new ApiError('GOAL_LIMIT_REACHED');
    });
    await render(<GoalForm surplus={8000} submitLabel="Save goal" onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('goal-name'), 'Eid');
    await fireEvent.changeText(screen.getByTestId('goal-target'), '1000');
    await fireEvent.changeText(screen.getByTestId('goal-months'), '2');
    await fireEvent.press(screen.getByTestId('goal-submit'));
    expect(await screen.findByTestId('goal-error')).toHaveTextContent(/up to 10 goals/);
  });
});

describe('TC-P3-SAVE-05/06: goal card', () => {
  const handlers = () => ({ onContribute: jest.fn(async () => {}), onEdit: jest.fn(async () => {}), onDelete: jest.fn(async () => {}) });

  it('shows progress and adds a contribution', async () => {
    const h = handlers();
    await render(<GoalCard goal={goal()} surplus={8000} today={new Date(2026, 9, 3)} {...h} />);
    expect(screen.getByTestId('goal-progress')).toHaveTextContent('৳9,000.00 saved · ৳21,000.00 to go');
    expect(screen.getByTestId('goal-progress-bar').props.style).toEqual(expect.arrayContaining([{ width: '30%' }]));
    expect(screen.getByTestId('goal-monthly')).toHaveTextContent('About ৳3,500.00 a month to finish on time');
    await fireEvent.changeText(screen.getByTestId('contribution-amount'), '২৫০০');
    await fireEvent.press(screen.getByTestId('contribution-submit'));
    expect(h.onContribute).toHaveBeenCalledWith(2500);
  });

  it('asks for confirmation before deleting', async () => {
    const h = handlers();
    await render(<GoalCard goal={goal()} surplus={8000} {...h} />);
    await fireEvent.press(screen.getByTestId('goal-delete'));
    expect(screen.getByTestId('delete-confirm')).toHaveTextContent(/Delete “Eid”/);
    await fireEvent.press(screen.getByTestId('delete-confirm-no'));
    expect(h.onDelete).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('goal-delete'));
    await fireEvent.press(screen.getByTestId('delete-confirm-yes'));
    expect(h.onDelete).toHaveBeenCalled();
  });

  it('edits the goal and recalculates the plan', async () => {
    const h = handlers();
    await render(<GoalCard goal={goal()} surplus={8000} {...h} />);
    await fireEvent.press(screen.getByTestId('goal-edit'));
    await fireEvent.changeText(screen.getByTestId('goal-target'), '24000');
    expect(screen.getByTestId('plan-monthly')).toHaveTextContent('৳4,000.00 a month for 6 months');
    await fireEvent.press(screen.getByTestId('goal-submit'));
    expect(h.onEdit).toHaveBeenCalledWith('Eid', 24000, 6);
    expect(await screen.findByTestId('goal-card')).toBeTruthy();
  });
});
