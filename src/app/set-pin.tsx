import { useState } from 'react';

import { PinSetupForm } from '@/components/PinSetupForm';
import { Body, Screen, Title } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { ApiError, setPin } from '@/lib/api';
import { messageFor } from '@/lib/messages';

export default function SetPin() {
  const { refreshProfile } = useSession();
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
      setError(messageFor(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Create your transaction PIN</Title>
      <Body muted>You will enter this PIN to approve every payment. Never share it with anyone.</Body>
      <PinSetupForm onSubmit={submit} busy={busy} serverError={error} />
    </Screen>
  );
}
