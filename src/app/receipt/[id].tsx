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

  const rows: [string, string, string][] = [
    ['Transaction ID', txn.id, 'receipt-id'],
    [txn.direction === 'OUT' ? 'Paid to' : 'Received from', txn.counterparty_name ?? '—', 'receipt-counterparty'],
    ['Merchant ID', txn.counterparty_ref ?? '—', 'receipt-merchant-id'],
    ['Date & time', formatDateTime(txn.created_at), 'receipt-date'],
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
      {txn.flagged && (
        // TC-P2-FLOW-02: the payment went through and is being reviewed.
        <View style={styles.flag} testID="receipt-flag-notice" accessibilityRole="alert">
          <Text style={styles.flagText}>
            This payment has been flagged for a routine review. You don&apos;t need to do anything.
          </Text>
        </View>
      )}
      {rows.map(([label, value, testID]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} selectable testID={testID}>
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
  flag: { backgroundColor: colors.warningSurface, borderRadius: 12, padding: 12 },
  flagText: { color: colors.warning, fontSize: 14, lineHeight: 20 },
});
