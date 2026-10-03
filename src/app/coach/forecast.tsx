// Cash-Flow Forecasting (TC-P3-FCST-*): computed on the device from the user's
// own history (src/lib/forecast.ts); no LLM involved.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { RetryCard, Skeleton } from '@/components/CoachCards';
import { ForecastChart, LowBalanceWarning, LowConfidenceNote, RecurringList } from '@/components/ForecastView';
import { Body, Screen, Title } from '@/components/ui';
import { ApiError, getCashHistory } from '@/lib/api';
import { forecast, type Forecast } from '@/lib/forecast';
import { useI18n } from '@/i18n/LocaleProvider';
import { useScreenView } from '@/lib/analytics';

export default function ForecastScreen() {
  const { t, msg } = useI18n();
  useScreenView('forecast');
  const [result, setResult] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setResult(forecast(await getCashHistory(120)));
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

  return (
    <Screen>
      <Title>{t('forecast.title')}</Title>
      {error && <RetryCard message={error} onRetry={load} testID="forecast-error" />}
      {!result && !error && <Skeleton testID="forecast-skeleton" />}
      {result && (
        <>
          {result.lowConfidence && <LowConfidenceNote days={result.historyDays} />}
          {result.warning && (
            <LowBalanceWarning warning={result.warning}
              onPayBill={(merchantId) => router.push({ pathname: '/pay', params: { merchantId, bill: '1' } })} />
          )}
          <ForecastChart forecast={result} />
          <RecurringList forecast={result} />
          <Body muted>{t('forecast.footer')}</Body>
        </>
      )}
    </Screen>
  );
}
