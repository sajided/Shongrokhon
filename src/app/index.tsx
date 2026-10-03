import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotificationBanner } from '@/components/NotificationBanner';
import { Button, colors, ErrorBanner } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { ApiError, getNotifications, getTransactions, markNotificationRead, type Notice, type TransactionRow } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { formatDateTime, formatTaka } from '@/lib/format';
import { messageFor } from '@/lib/messages';

export default function Home() {
  const { profile, refreshProfile } = useSession();
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
      setError(messageFor(e instanceof ApiError ? e.code : null));
    } finally {
      setRefreshing(false);
    }
  }, [refreshProfile]);

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
              <Text style={styles.balanceLabel}>Available balance</Text>
              <Text style={styles.balance} testID="balance">
                {profile ? formatTaka(Number(profile.balance)) : '—'}
              </Text>
              <Text style={styles.phone}>{profile?.phone}</Text>
            </View>
            <NotificationBanner notices={notices} onDismiss={dismiss} />
            <Button title="Scan QR to pay" onPress={() => router.push('/scan')} testID="scan-button" />
            <Button title="AI coach: your spending" variant="secondary" onPress={() => router.push('/coach')} testID="coach-button" />
            <ErrorBanner message={error} />
            <Text style={styles.section}>Recent transactions</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No transactions yet.</Text>}
        renderItem={({ item }) => <TransactionItem row={item} />}
        ListFooterComponent={
          <View style={{ marginTop: 24 }}>
            <Button title="Log out" variant="secondary" onPress={signOut} testID="logout" />
          </View>
        }
      />
    </SafeAreaView>
  );
}

function TransactionItem({ row }: { row: TransactionRow }) {
  const out = row.direction === 'OUT';
  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/receipt/${row.id}`)}
      testID="txn-row"
      accessibilityRole="button"
      accessibilityLabel={`${out ? 'Paid' : 'Received'} ${formatTaka(Number(row.amount))} ${out ? 'to' : 'from'} ${row.counterparty_name ?? ''}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>
          {row.counterparty_name ?? (row.type === 'TOPUP' ? 'Top-up' : row.type === 'CASHOUT' ? 'Cash out' : 'Payment')}
        </Text>
        <Text style={styles.rowMeta}>
          {formatDateTime(row.created_at)} · {row.status}
        </Text>
      </View>
      <Text style={[styles.rowAmount, { color: out ? colors.text : colors.success }]}>
        {out ? '−' : '+'}
        {formatTaka(Number(row.amount))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: { gap: 16, marginBottom: 8 },
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
