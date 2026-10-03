import { useState } from 'react';

import { PinSetupForm } from '@/components/PinSetupForm';
import { Body, Screen, Title } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { useI18n } from '@/i18n/LocaleProvider';
import { ApiError, setPin } from '@/lib/api';

export default function SetPin() {
  const { refreshProfile } = useSession();
  const { t, msg } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      await setPin(pin);
      // has_pin flips to true and the guard routes to home.
      await refreshProfile();
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('pin.title')}</Title>
      <Body muted>{t('pin.body')}</Body>
      <PinSetupForm onSubmit={submit} busy={busy} serverError={error} />
    </Screen>
  );
}
