import { NotoSansBengali_400Regular, NotoSansBengali_700Bold, useFonts } from '@expo-google-fonts/noto-sans-bengali';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfigGate } from '@/components/ConfigGate';
import { Body, Button, colors, Screen, Title } from '@/components/ui';
import { SessionProvider, useSession } from '@/hooks/session';
import { LocaleProvider, useI18n } from '@/i18n/LocaleProvider';
import { signOut } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ConfigGate>
        <SessionProvider>
          <LocaleProvider>
            <RootNavigator />
          </LocaleProvider>
        </SessionProvider>
      </ConfigGate>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, profile, loading, profileError, refreshProfile } = useSession();
  const { t, msg } = useI18n();
  // Bangla font (TC-P4-L10N-03). A load failure falls back to the system font, so it never blocks the app.
  const [fontsLoaded, fontError] = useFonts({ NotoSansBengali_400Regular, NotoSansBengali_700Bold });
  const ready = !loading && (fontsLoaded || !!fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  if (session && !profile) {
    return (
      <Screen>
        <Title>{t('root.loadFailed')}</Title>
        <Body muted>{msg(profileError === 'NETWORK' ? 'NETWORK' : 'INTERNAL_ERROR')}</Body>
        <Button title={t('common.tryAgain')} onPress={refreshProfile} testID="profile-retry" />
        <Button title={t('common.signOut')} variant="secondary" onPress={signOut} />
      </Screen>
    );
  }

  const signedIn = !!session;
  const hasPin = !!profile?.has_pin;

  // Route guards (TC-P1-AUTH-09): protected screens are unreachable without a session.
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: t('nav.signIn') }} />
        <Stack.Screen name="verify" options={{ title: t('nav.verify') }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasPin}>
        <Stack.Screen name="set-pin" options={{ title: t('nav.setPin'), headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasPin}>
        <Stack.Screen name="index" options={{ title: t('nav.home'), headerShown: false }} />
        <Stack.Screen name="scan" options={{ title: t('nav.scan') }} />
        <Stack.Screen name="pay" options={{ title: t('nav.pay') }} />
        <Stack.Screen name="receipt/[id]" options={{ title: t('nav.receipt'), headerBackVisible: false }} />
        <Stack.Screen name="coach/index" options={{ title: t('nav.coach') }} />
        <Stack.Screen name="coach/savings" options={{ title: t('nav.savings') }} />
        <Stack.Screen name="coach/forecast" options={{ title: t('nav.forecast') }} />
        <Stack.Screen name="cashout" options={{ title: t('nav.cashout') }} />
        <Stack.Screen name="send" options={{ title: t('nav.send') }} />
        <Stack.Screen name="bills" options={{ title: t('nav.bills') }} />
        <Stack.Screen name="settings" options={{ title: t('nav.settings') }} />
      </Stack.Protected>
    </Stack>
  );
}
