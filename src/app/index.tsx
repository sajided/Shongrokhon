import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotificationBanner } from '@/components/NotificationBanner';
import { Button, colors, ErrorBanner, Text } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { useI18n } from '@/i18n/LocaleProvider';
import { useScreenView } from '@/lib/analytics';
import { ApiError, getNotifications, getTransactions, markNotificationRead, type Notice, type TransactionRow } from '@/lib/api';
import { signOut } from '@/lib/auth';

export default function Home() {
  const { profile, refreshProfile } = useSession();
  const { t, msg, money } = useI18n();
  useScreenView('home');
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [txns, unread] = await Promise.all([getTransactions({ limit: 50 }), getNotifications(), refreshProfile()]);
      setRows(txns);
      setNotices(unread);
      setError(null);
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setRefreshing(false);
    }
  }, [refreshProfile, msg]);

  const dismiss = useCallback((id: string) => {
    setNotices((all) => all.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    markNotificationRead(id).catch(() => undefined); // shows again next time if this fails
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>{t('home.balance')}</Text>
              <Text style={styles.balance} testID="balance">
                {profile ? money(Number(profile.balance)) : '—'}
              </Text>
              <Text style={styles.phone}>{profile?.phone}</Text>
            </View>
            <NotificationBanner notices={notices} onDismiss={dismiss} />
            <View style={styles.actions}>
              <View style={styles.action}>
                <Button title={t('home.scan')} onPress={() => router.push('/scan')} testID="scan-button" />
              </View>
              <View style={styles.action}>
                <Button title={t('home.cashout')} variant="secondary" onPress={() => router.push('/cashout')} testID="cashout-button" />
              </View>
              <View style={styles.action}>
                <Button title={t('home.send')} variant="secondary" onPress={() => router.push('/send')} testID="send-button" />
              </View>
              <View style={styles.action}>
                <Button title={t('home.bills')} variant="secondary" onPress={() => router.push('/bills')} testID="bills-button" />
              </View>
            </View>
            <Button title={t('home.coach')} variant="secondary" onPress={() => router.push('/coach')} testID="coach-button" />
            <ErrorBanner message={error} />
            <Text style={styles.section}>{t('home.recent')}</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>{t('home.empty')}</Text>}
        renderItem={({ item }) => <TransactionItem row={item} />}
        ListFooterComponent={
          <View style={{ marginTop: 24, gap: 12 }}>
            <Button title={t('home.settings')} variant="secondary" onPress={() => router.push('/settings')} testID="settings-button" />
            <Button title={t('common.logOut')} variant="secondary" onPress={signOut} testID="logout" />
          </View>
        }
      />
    </SafeAreaView>
  );
}

function TransactionItem({ row }: { row: TransactionRow }) {
  const { t, money, dateTime } = useI18n();
  const out = row.direction === 'OUT';
  const fallback = row.type === 'TOPUP' ? t('txn.topup') : row.type === 'CASHOUT' ? t('txn.cashout')
    : row.type === 'FEE' ? t('txn.fee') : row.type === 'TRANSFER' ? t(out ? 'txn.transfer' : 'txn.transferIn') : t('txn.payment');
  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/receipt/${row.id}`)}
      testID="txn-row"
      accessibilityRole="button"
      accessibilityLabel={t(out ? 'txn.a11yOut' : 'txn.a11yIn', { amount: money(Number(row.amount)), name: row.counterparty_name ?? fallback })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>
          {row.counterparty_name ?? fallback}
        </Text>
        <Text style={styles.rowMeta}>
          {dateTime(row.created_at)} · {t(`status.${row.status}`)}
        </Text>
      </View>
      <Text style={[styles.rowAmount, { color: out ? colors.text : colors.success }]}>
        {out ? '−' : '+'}
        {money(Number(row.amount))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: { gap: 16, marginBottom: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexBasis: '48%', flexGrow: 1 },
  balanceCard: { backgroundColor: colors.primary, borderRadius: 16, padding: 20, gap: 4 },
  balanceLabel: { color: '#D7F0E6', fontSize: 14 },
  balance: { color: '#FFFFFF', fontSize: 32, fontWeight: '700' },
  phone: { color: '#D7F0E6', fontSize: 13 },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 8 },
  empty: { color: colors.muted, paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 13, color: colors.muted },
  rowAmount: { fontSize: 16, fontWeight: '700' },
});
