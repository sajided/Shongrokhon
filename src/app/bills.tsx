// Pay a bill (Phase 4): pick a biller, then the normal scored payment flow
// (/pay with merchantId) with an account-number field. Billers are merchants
// with a biller_category (list_billers).
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Body, colors, ErrorBanner, Screen, Text, Title } from '@/components/ui';
import { useI18n } from '@/i18n/LocaleProvider';
import { useScreenView } from '@/lib/analytics';
import { ApiError, listBillers, type Biller } from '@/lib/api';

export default function Bills() {
  const { t, msg } = useI18n();
  useScreenView('bills');
  const [billers, setBillers] = useState<Biller[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      listBillers()
        .then(setBillers)
        .catch((e) => setError(msg(e instanceof ApiError ? e.code : null)));
    }, [msg]),
  );

  return (
    <Screen>
      <Title>{t('bills.choose')}</Title>
      <ErrorBanner message={error} />
      {billers?.length === 0 && <Body muted>{t('bills.empty')}</Body>}
      {billers?.map((b) => (
        <Pressable
          key={b.merchant_id}
          style={styles.row}
          accessibilityRole="button"
          testID={`biller-${b.merchant_id}`}
          onPress={() => router.push({ pathname: '/pay', params: { merchantId: b.merchant_id, bill: '1' } })}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name}>{b.merchant_name}</Text>
            <Text style={styles.category}>{t(`bills.category.${b.biller_category}`)}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: 16, gap: 12 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  category: { fontSize: 13, color: colors.muted },
  chevron: { fontSize: 22, color: colors.muted },
});
