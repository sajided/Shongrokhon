import { router } from 'expo-router';
import { useState } from 'react';

import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { sendOtp } from '@/lib/auth';
import { messageFor } from '@/lib/messages';
import { normalizeBdPhone } from '@/lib/validation';

export default function SignIn() {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    // TC-P1-AUTH-02: validate before any network call.
    const e164 = normalizeBdPhone(phone);
    if (!e164) return setError(messageFor('INVALID_PHONE'));
    setError(null);
    setBusy(true);
    try {
      await sendOtp(e164);
      router.push({ pathname: '/verify', params: { phone: e164 } });
    } catch (e) {
      setError(messageFor(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Welcome</Title>
      <Body muted>Enter your mobile number. New numbers are registered automatically.</Body>
      <Field
        label="Mobile number"
        testID="phone-input"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="01XXXXXXXXX"
        maxLength={16}
      />
      <ErrorBanner message={error} />
      <Button title="Send code" onPress={submit} busy={busy} testID="send-otp" />
    </Screen>
  );
}
