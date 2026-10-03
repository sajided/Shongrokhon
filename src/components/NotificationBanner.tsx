import { StyleSheet, View } from 'react-native';

import { useI18n, type I18n } from '@/i18n/LocaleProvider';
import { hasKey } from '@/i18n/translate';
import type { Notice } from '@/lib/api';

import { Button, colors, Text } from './ui';

/**
 * Notice text in the selected language, from its kind and data (TC-P4-L10N-01).
 * The server's English title/body is the fallback for kinds the app doesn't know.
 */
export function noticeText(n: Notice, i18n: I18n): { title: string; body: string } {
  const titleKey = `notice.${n.kind}.title`;
  const bodyKey = `notice.${n.kind}.body`;
  if (!hasKey(titleKey) || !hasKey(bodyKey)) return { title: n.title, body: n.body };
  const d = n.data as { amount?: number; merchant_name?: string; flow?: string; from?: string };
  const flowKey = `notice.flow.${d.flow}`;
  return {
    title: i18n.t(titleKey),
    body: i18n.t(bodyKey, {
      amount: typeof d.amount === 'number' ? i18n.money(Number(d.amount)) : '',
      merchant: d.merchant_name ?? '',
      flow: hasKey(flowKey) ? i18n.t(flowKey) : '',
      from: d.from ?? '',
    }),
  };
}

/** Unread in-app notices, e.g. a payment flagged for review (TC-P2-FLOW-02). */
export function NotificationBanner({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: string) => void }) {
  const i18n = useI18n();
  const unread = notices.filter((n) => !n.read_at);
  if (unread.length === 0) return null;
  return (
    <View style={styles.list}>
      {unread.map((n) => {
        const { title, body } = noticeText(n, i18n);
        return (
          <View key={n.id} style={styles.notice} accessibilityRole="alert" testID="notice">
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body} testID="notice-body">
              {body}
            </Text>
            <Button title={i18n.t('common.ok')} variant="secondary" onPress={() => onDismiss(n.id)} testID="notice-dismiss" />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  notice: { backgroundColor: colors.warningSurface, borderRadius: 12, padding: 16, gap: 8 },
  title: { color: colors.warning, fontSize: 16, fontWeight: '700' },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
