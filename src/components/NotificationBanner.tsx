import { StyleSheet, Text, View } from 'react-native';

import type { Notice } from '@/lib/api';

import { Button, colors } from './ui';

/** Unread in-app notices, e.g. a payment flagged for review (TC-P2-FLOW-02). */
export function NotificationBanner({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: string) => void }) {
  const unread = notices.filter((n) => !n.read_at);
  if (unread.length === 0) return null;
  return (
    <View style={styles.list}>
      {unread.map((n) => (
        <View key={n.id} style={styles.notice} accessibilityRole="alert" testID="notice">
          <Text style={styles.title}>{n.title}</Text>
          <Text style={styles.body} testID="notice-body">
            {n.body}
          </Text>
          <Button title="OK" variant="secondary" onPress={() => onDismiss(n.id)} testID="notice-dismiss" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  notice: { backgroundColor: colors.warningSurface, borderRadius: 12, padding: 16, gap: 8 },
  title: { color: colors.warning, fontSize: 16, fontWeight: '700' },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
