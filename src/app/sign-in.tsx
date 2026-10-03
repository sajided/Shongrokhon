import { router } from 'expo-router';
import { useState } from 'react';

import { Body, Button, ErrorBanner, Field, Screen, Title } from '@/components/ui';
import { useI18n } from '@/i18n/LocaleProvider';
import { ApiError } from '@/lib/api';
import { sendOtp, linkError } from '@/lib/auth';
import { readAuthMethod } from '@/lib/config';
import { normalizeBdPhone, normalizeEmail } from '@/lib/validation';

const AUTH_METHOD = readAuthMethod();

export default function SignIn() {
  const { t, msg } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  // An expired or used email link lands back here with the reason in the URL fragment.
  const [error, setError] = useState<string | null>(() => {
    const code = AUTH_METHOD === 'email' ? linkError() : null;
    return code ? msg(code) : null;
  });
  // Email sign-in: the address a link was sent to. Opening the link signs in, and
  // the session listener then routes to set-pin or home.
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const email = AUTH_METHOD === 'email';

  const submit = async () => {
    // TC-P1-AUTH-02: validate before any network call.
    const to = email ? normalizeEmail(value) : normalizeBdPhone(value);
    if (!to) return setError(msg(email ? 'INVALID_EMAIL' : 'INVALID_PHONE'));
    setError(null);
    setBusy(true);
    try {
      await sendOtp(to);
      if (email) setLinkSentTo(to);
      else router.push({ pathname: '/verify', params: { to } });
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
          onChangeText={(next) => {
            setValue(next);
            setLinkSentTo(null);
          }}
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
      {linkSentTo && (
        <Body muted testID="link-sent">
          {t('signIn.linkSent', { email: linkSentTo })}
        </Body>
      )}
      <ErrorBanner message={error} />
      <Button
        title={t(email ? (linkSentTo ? 'signIn.resendLink' : 'signIn.sendLink') : 'signIn.send')}
        variant={linkSentTo ? 'secondary' : undefined}
        onPress={submit}
        busy={busy}
        testID="send-otp"
      />
    </Screen>
  );
}
