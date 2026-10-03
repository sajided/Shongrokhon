import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, colors, ErrorBanner, Screen, Text } from '@/components/ui';
import { useI18n } from '@/i18n/LocaleProvider';
import { ApiError, getTransactions, type TransactionRow } from '@/lib/api';
import { receiptText } from '@/lib/format';
import { shareText } from '@/lib/share';

// TC-P1-PAY-13
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const i18n = useI18n();
  const { t, msg, money, dateTime } = i18n;
  const [txn, setTxn] = useState<TransactionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  useEffect(() => {
    getTransactions({ id })
      .then((rows) => (rows[0] ? setTxn(rows[0]) : setError(msg('INTERNAL_ERROR'))))
      .catch((e) => setError(msg(e instanceof ApiError ? e.code : null)));
  }, [id, msg]);

  if (error) {
    return (
      <Screen>
        <ErrorBanner message={error} />
        <Button title={t('common.done')} onPress={() => router.dismissTo('/')} />
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
    [t('receipt.id'), txn.id, 'receipt-id'],
    [t(txn.direction === 'OUT' ? 'receipt.paidTo' : 'receipt.receivedFrom'), txn.counterparty_name ?? '—', 'receipt-counterparty'],
    [t('receipt.ref'), txn.counterparty_ref ?? '—', 'receipt-merchant-id'],
    [t('receipt.date'), dateTime(txn.created_at), 'receipt-date'],
  ];
  const success = txn.type === 'CASHOUT' ? t('receipt.successCashout')
    : txn.type === 'TRANSFER' ? t('receipt.successTransfer') : t('receipt.success');

  return (
    <Screen>
      <View style={styles.hero} testID="receipt">
        <Text style={styles.status} testID="receipt-status">
          {txn.status === 'SUCCESS' ? success : t(`status.${txn.status}`)}
        </Text>
        <Text style={styles.amount} testID="receipt-amount">
          {money(Number(txn.amount))}
        </Text>
      </View>
      {txn.flagged && (
        // TC-P2-FLOW-02: the payment went through and is being reviewed.
        <View style={styles.flag} testID="receipt-flag-notice" accessibilityRole="alert">
          <Text style={styles.flagText}>{t('receipt.flagged')}</Text>
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
        title={t('receipt.share')}
        variant="secondary"
        onPress={async () => {
          const result = await shareText(receiptText(txn, i18n));
          setShareNote(result === 'copied' ? t('receipt.copied') : null);
        }}
        testID="share-receipt"
      />
      {shareNote && <Text style={styles.label} testID="share-note">{shareNote}</Text>}
      <Button title={t('common.done')} onPress={() => router.dismissTo('/')} testID="receipt-done" />
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
