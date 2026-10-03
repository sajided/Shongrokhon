// Cash-Flow Forecasting (TC-P3-FCST-*): computed on the device from the user's
// own history (src/lib/forecast.ts); no LLM involved.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { RetryCard, Skeleton } from '@/components/CoachCards';
import { ForecastChart, LowBalanceWarning, LowConfidenceNote, RecurringList } from '@/components/ForecastView';
import { Body, Screen, Title } from '@/components/ui';
import { ApiError, getCashHistory } from '@/lib/api';
import { forecast, type Forecast } from '@/lib/forecast';
import { messageFor } from '@/lib/messages';

export default function ForecastScreen() {
  const [result, setResult] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setResult(forecast(await getCashHistory(120)));
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

  return (
    <Screen>
      <Title>Cash-flow forecast</Title>
      {error && <RetryCard message={error} onRetry={load} testID="forecast-error" />}
      {!result && !error && <Skeleton testID="forecast-skeleton" />}
      {result && (
        <>
          {result.lowConfidence && <LowConfidenceNote days={result.historyDays} />}
          {result.warning && <LowBalanceWarning warning={result.warning} />}
          <ForecastChart forecast={result} />
          <RecurringList forecast={result} />
          <Body muted>Based on your regular income, bills and everyday spending. Real days will differ.</Body>
        </>
      )}
    </Screen>
  );
}
