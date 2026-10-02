import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button, colors, ErrorBanner, Screen } from '@/components/ui';
import { ApiError, getTransactions, type TransactionRow } from '@/lib/api';
import { formatDateTime, formatTaka, receiptText } from '@/lib/format';
import { messageFor } from '@/lib/messages';
import { shareText } from '@/lib/share';

// TC-P1-PAY-13
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [txn, setTxn] = useState<TransactionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  useEffect(() => {
    getTransactions({ id })
      .then((rows) => (rows[0] ? setTxn(rows[0]) : setError(messageFor('INTERNAL_ERROR'))))
      .catch((e) => setError(messageFor(e instanceof ApiError ? e.code : null)));
  }, [id]);

  if (error) {
    return (
      <Screen>
        <ErrorBanner message={error} />
        <Button title="Done" onPress={() => router.dismissTo('/')} />
      </Screen>
    );
  }
  if (!txn) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const rows: [string, string][] = [
    ['Transaction ID', txn.id],
    [txn.direction === 'OUT' ? 'Paid to' : 'Received from', txn.counterparty_name ?? '—'],
    ['Merchant ID', txn.counterparty_ref ?? '—'],
    ['Date & time', formatDateTime(txn.created_at)],
  ];

  return (
    <Screen>
      <View style={styles.hero} testID="receipt">
        <Text style={styles.status} testID="receipt-status">
          {txn.status === 'SUCCESS' ? 'Payment successful' : txn.status}
        </Text>
        <Text style={styles.amount} testID="receipt-amount">
          {formatTaka(Number(txn.amount))}
        </Text>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} selectable>
            {value}
          </Text>
        </View>
      ))}
      <Button
        title="Share receipt"
        variant="secondary"
        onPress={async () => {
          const result = await shareText(receiptText(txn));
          setShareNote(result === 'copied' ? 'Receipt copied to clipboard.' : null);
        }}
        testID="share-receipt"
      />
      {shareNote && <Text style={styles.label} testID="share-note">{shareNote}</Text>}
      <Button title="Done" onPress={() => router.dismissTo('/')} testID="receipt-done" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6, paddingVertical: 16 },
  status: { color: colors.success, fontSize: 18, fontWeight: '700' },
  amount: { color: colors.text, fontSize: 36, fontWeight: '700' },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 10, gap: 2 },
  label: { color: colors.muted, fontSize: 13 },
  value: { color: colors.text, fontSize: 16 },
});
