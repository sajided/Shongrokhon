import { router } from 'expo-router';
import { useState } from 'react';

import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui';
import { useI18n } from '@/i18n/LocaleProvider';
import { ApiError } from '@/lib/api';
import { sendOtp } from '@/lib/auth';
import { readAuthMethod } from '@/lib/config';
import { normalizeBdPhone, normalizeEmail } from '@/lib/validation';

const AUTH_METHOD = readAuthMethod();

export default function SignIn() {
  const { t, msg } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = AUTH_METHOD === 'email';

  const submit = async () => {
    // TC-P1-AUTH-02: validate before any network call.
    const to = email ? normalizeEmail(value) : normalizeBdPhone(value);
    if (!to) return setError(msg(email ? 'INVALID_EMAIL' : 'INVALID_PHONE'));
    setError(null);
    setBusy(true);
    try {
      await sendOtp(to);
      router.push({ pathname: '/verify', params: { to } });
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('signIn.title')}</Title>
      <Body muted>{t(email ? 'signIn.bodyEmail' : 'signIn.body')}</Body>
      {email ? (
        <Field
          label={t('signIn.email')}
          testID="email-input"
          value={value}
          onChangeText={setValue}
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
          maxLength={254}
        />
      ) : (
        <Field
          label={t('signIn.phone')}
          testID="phone-input"
          value={value}
          onChangeText={setValue}
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          maxLength={16}
        />
      )}
      <ErrorBanner message={error} />
      <Button title={t('signIn.send')} onPress={submit} busy={busy} testID="send-otp" />
    </Screen>
  );
}
