import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { sendOtp, verifyOtp } from '@/lib/auth';
import { messageFor } from '@/lib/messages';
import { isValidOtp } from '@/lib/validation';

export default function Verify() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canResend, setCanResend] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    if (!isValidOtp(code)) return setError(messageFor('INVALID_OTP_FORMAT'));
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      // On success the session listener routes to set-pin or home.
      await verifyOtp(phone, code);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(messageFor(err?.code, err?.details as { attempts_left?: number }));
      setCanResend(err?.code === 'OTP_EXPIRED' || err?.code === 'OTP_NOT_REQUESTED');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await sendOtp(phone);
      setError(null);
      setCanResend(false);
      setInfo('A new code has been sent.');
    } catch (e) {
      setError(messageFor(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Enter the code</Title>
      <Body muted>We sent a 6-digit code to {phone}.</Body>
      <Field
        label="Verification code"
        testID="otp-input"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
      />
      {info && <Body muted>{info}</Body>}
      <ErrorBanner message={error} />
      <Button title="Verify" onPress={submit} busy={busy} testID="verify-otp" />
      {canResend && <Button title="Resend code" variant="secondary" onPress={resend} testID="resend-otp" />}
    </Screen>
  );
}
