// Success-metric events (testcase.md §5, TC-MET-04/05). Fire-and-forget: a
// failed event never affects the app. The server keeps only allowlisted event
// names and short code values, keyed by an HMAC of the user, and counts a screen
// view once per visit (30-second window).
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { callRpc } from './api';

export type Screen = 'home' | 'coach' | 'savings' | 'forecast' | 'cashout' | 'send' | 'bills' | 'settings';
export type AnalyticsEvent =
  | { event: 'screen_view'; props: { screen: Screen } }
  | { event: 'insights_loaded'; props: { period: string; source: string } }
  | { event: 'ask_coach'; props: { topic: string } }
  | { event: 'goal_created'; props: { status: string } }
  | { event: 'forecast_warning'; props: { action: 'shown' | 'pay_bill' } };

export function track<E extends AnalyticsEvent>(event: E['event'], props: E['props']): void {
  callRpc('log_event', { p_event: event, p_props: props }).catch(() => undefined);
}

/** One screen_view each time the screen comes into focus. */
export function useScreenView(screen: Screen) {
  useFocusEffect(
    useCallback(() => {
      track('screen_view', { screen });
    }, [screen]),
  );
}
