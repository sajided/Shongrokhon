import { router } from 'expo-router';
import { useState } from 'react';
import { View, StyleSheet, ScrollView, SafeAreaView } from 'react-native';

import { Body, Button, ErrorBanner, Field, Title, Text } from '@/components/ui';
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
  const [error, setError] = useState<string | null>(() => {
    const code = AUTH_METHOD === 'email' ? linkError() : null;
    return code ? msg(code) : null;
  });
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const email = AUTH_METHOD === 'email';

  const submit = async () => {
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
    <SafeAreaView style={styles.safe}>
      {/* Decorative ambient background accents */}
      <View style={styles.ambientCircleTop} pointerEvents="none" />
      <View style={styles.ambientCircleBottom} pointerEvents="none" />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          {/* Logo badge with creative concentric halo */}
          <View style={styles.logoHaloOuter}>
            <View style={styles.logoHaloInner}>
              <View style={styles.logoContainer}>
                <Text style={styles.logoText}>S</Text>
              </View>
            </View>
          </View>

          <View style={styles.pillBadge}>
            <Text style={styles.pillBadgeText}>{t('signIn.brandBadge')}</Text>
          </View>

          <Title>{t('signIn.title')}</Title>
          <Body muted style={styles.subtitle}>
            {t(email ? 'signIn.bodyEmail' : 'signIn.body')}
          </Body>
        </View>

        <View style={styles.card}>
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
            <View style={styles.linkSentBox}>
              <Text style={styles.linkSentIcon}>✉️</Text>
              <Body muted testID="link-sent" style={styles.linkSent}>
                {t('signIn.linkSent', { email: linkSentTo })}
              </Body>
            </View>
          )}

          <ErrorBanner message={error} />

          <Button
            title={t(email ? (linkSentTo ? 'signIn.resendLink' : 'signIn.sendLink') : 'signIn.send')}
            variant={linkSentTo ? 'secondary' : 'primary'}
            onPress={submit}
            busy={busy}
            testID="send-otp"
          />

          <View style={styles.securityNote}>
            <Text style={styles.securityText}>🔒 {t('signIn.security')}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    position: 'relative',
    overflow: 'hidden',
  },
  ambientCircleTop: {
    position: 'absolute',
    top: -120,
    left: '50%',
    marginLeft: -250,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(226, 232, 240, 0.45)',
  },
  ambientCircleBottom: {
    position: 'absolute',
    bottom: -150,
    right: -100,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(241, 245, 249, 0.6)',
  },
  content: {
    padding: 24,
    paddingTop: 50,
    paddingBottom: 40,
    gap: 20,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    minHeight: '100%',
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  logoHaloOuter: {
    width: 96,
    height: 96,
    borderRadius: 32,
    backgroundColor: 'rgba(226, 232, 240, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  logoHaloInner: {
    width: 84,
    height: 84,
    borderRadius: 27,
    backgroundColor: 'rgba(241, 245, 249, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    width: 68,
    height: 68,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
  },
  pillBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    marginTop: 4,
    marginBottom: 2,
  },
  pillBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
    letterSpacing: 1.2,
  },
  subtitle: {
    textAlign: 'center',
    paddingHorizontal: 20,
    fontSize: 14,
    lineHeight: 20,
    color: '#64748B',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 24,
    gap: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 3,
  },
  linkSentBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkSentIcon: {
    fontSize: 18,
  },
  linkSent: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#166534',
  },
  securityNote: {
    alignItems: 'center',
    marginTop: 4,
  },
  securityText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
});

