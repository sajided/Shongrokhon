import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Scanner } from '@/components/Scanner';
import { Button, colors, ErrorBanner } from '@/components/ui';
import { messageFor } from '@/lib/messages';
import { parseBanglaQr } from '@/lib/qr/emv';

export default function Scan() {
  const [focused, setFocused] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const handlePayload = useCallback((payload: string) => {
    // TC-P1-QR-05/06/07: reject before any payment screen opens.
    const parsed = parseBanglaQr(payload);
    if (!parsed.ok) {
      setError(messageFor(parsed.code));
      return;
    }
    setError(null);
    router.push({ pathname: '/pay', params: { payload: parsed.qr.raw } });
  }, []);

  return (
    <View style={styles.container}>
      <Scanner onPayload={handlePayload} active={focused && !error} />
      {error && (
        <View style={styles.sheet}>
          <ErrorBanner message={error} testID="qr-error" />
          <Button title="Scan again" onPress={() => setError(null)} testID="scan-again" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  sheet: { position: 'absolute', left: 16, right: 16, top: 16, gap: 12, backgroundColor: colors.background, padding: 16, borderRadius: 12 },
});
