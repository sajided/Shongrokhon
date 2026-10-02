import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfigGate } from '@/components/ConfigGate';
import { Body, Button, Screen, Title } from '@/components/ui';
import { SessionProvider, useSession } from '@/hooks/session';
import { signOut } from '@/lib/auth';
import { messageFor } from '@/lib/messages';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ConfigGate>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </ConfigGate>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, profile, loading, profileError, refreshProfile } = useSession();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  if (session && !profile) {
    return (
      <Screen>
        <Title>Couldn&apos;t load your account</Title>
        <Body muted>{messageFor(profileError === 'NETWORK' ? 'NETWORK' : 'INTERNAL_ERROR')}</Body>
        <Button title="Try again" onPress={refreshProfile} testID="profile-retry" />
        <Button title="Sign out" variant="secondary" onPress={signOut} />
      </Screen>
    );
  }

  const signedIn = !!session;
  const hasPin = !!profile?.has_pin;

  // Route guards (TC-P1-AUTH-09): protected screens are unreachable without a session.
  return (
    <Stack screenOptions={{ headerTitleStyle: { fontWeight: '600' } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="verify" options={{ title: 'Verify number' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasPin}>
        <Stack.Screen name="set-pin" options={{ title: 'Set your PIN', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasPin}>
        <Stack.Screen name="index" options={{ title: 'Shongrokhon' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan QR' }} />
        <Stack.Screen name="pay" options={{ title: 'Pay merchant' }} />
        <Stack.Screen name="receipt/[id]" options={{ title: 'Receipt', headerBackVisible: false }} />
      </Stack.Protected>
    </Stack>
  );
}
