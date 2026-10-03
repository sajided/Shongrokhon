import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotificationBanner } from '@/components/NotificationBanner';
import { colors, ErrorBanner, Text } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { useI18n } from '@/i18n/LocaleProvider';
import type { TranslationKey } from '@/i18n/en';
import { useScreenView } from '@/lib/analytics';
import { ApiError, getNotifications, getTransactions, markNotificationRead, type Notice, type TransactionRow } from '@/lib/api';
import { signOut } from '@/lib/auth';

type IconName = ComponentProps<typeof Ionicons>['name'];

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

  const unread = notices.filter((n) => !n.read_at).length;
  // "৳18,450.69" → "৳18,450" + a muted ".69"; the element's text stays the whole amount.
  const balance = profile ? money(Number(profile.balance)) : '—';
  const dot = balance.lastIndexOf('.');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.topBar}>
              <Pressable
                style={styles.avatar}
                onPress={() => router.push('/settings')}
                accessibilityRole="button"
                accessibilityLabel={t('home.profile')}>
                {profile?.full_name?.trim() ? (
                  <Text style={styles.initial}>{profile.full_name.trim()[0].toUpperCase()}</Text>
                ) : (
                  <Ionicons name="person" size={22} color={colors.primaryText} />
                )}
              </Pressable>
              <Pressable
                style={styles.bell}
                onPress={load}
                accessibilityRole="button"
                accessibilityLabel={unread ? t('home.unread', { count: unread }) : t('home.notifications')}>
                <Ionicons name="notifications" size={20} color={colors.text} />
                {unread > 0 && <View style={styles.badge} />}
              </Pressable>
            </View>

            <View style={{ gap: 4 }}>
              <Text style={styles.balanceLabel}>{t('home.balance')}</Text>
              <Text style={styles.balance} testID="balance" numberOfLines={1} adjustsFontSizeToFit>
                {dot < 0 ? balance : (
                  <>
                    {balance.slice(0, dot)}
                    <Text style={styles.balanceFraction}>{balance.slice(dot)}</Text>
                  </>
                )}
              </Text>
            </View>

            <View style={styles.actions}>
              <RoundAction icon="scan" label={t('home.scan')} href="/scan" testID="scan-button" />
              <RoundAction icon="paper-plane" label={t('home.send')} href="/send" testID="send-button" />
              <RoundAction icon="swap-horizontal" label={t('home.cashout')} href="/cashout" testID="cashout-button" />
            </View>

            <NotificationBanner notices={notices} onDismiss={dismiss} />
            <ErrorBanner message={error} />

            <Text style={styles.section} accessibilityRole="header">{t('home.quick')}</Text>
            <View style={styles.cards}>
              <WalletCard tone="red" icon="sparkles" title={t('nav.coach')} body={t('home.coachCard')} href="/coach" testID="coach-button" />
              <WalletCard tone="blue" icon="receipt" title={t('home.bills')} body={t('home.billsCard')} href="/bills" testID="bills-button" />
            </View>

            <Text style={styles.section} accessibilityRole="header">{t('home.recent')}</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>{t('home.empty')}</Text>}
        renderItem={({ item }) => <TransactionItem row={item} />}
        ListFooterComponent={
          <Pressable style={styles.logout} onPress={signOut} testID="logout" accessibilityRole="button">
            <Ionicons name="log-out-outline" size={18} color={colors.muted} />
            <Text style={styles.logoutText}>{t('common.logOut')}</Text>
          </Pressable>
        }
      />
      <TabBar />
    </SafeAreaView>
  );
}

function RoundAction({ icon, label, href, testID }: { icon: IconName; label: string; href: Href; testID: string }) {
  return (
    <Pressable style={styles.action} onPress={() => router.push(href)} testID={testID} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <>
          <View style={[styles.actionCircle, pressed && { backgroundColor: colors.border }]}>
            <Ionicons name={icon} size={30} color={colors.text} />
          </View>
          <Text style={styles.actionLabel} numberOfLines={1}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const TONES = {
  red: { frame: colors.red, body: colors.redDeep },
  blue: { frame: colors.blue, body: colors.blueDeep },
};

/** A wallet-shaped card: a bright frame with a slot cut out at the top, and a deeper body in front. */
function WalletCard({ tone, icon, title, body, href, testID }: {
  tone: keyof typeof TONES; icon: IconName; title: string; body: string; href: Href; testID: string;
}) {
  const c = TONES[tone];
  return (
    <Pressable
      style={({ pressed }) => [styles.wallet, { backgroundColor: c.frame }, pressed && { opacity: 0.9 }]}
      onPress={() => router.push(href)}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}>
      <View style={styles.walletSlot} />
      <View style={[styles.walletBody, { backgroundColor: c.body }]}>
        <View style={[styles.walletIcon, { backgroundColor: c.frame }]}>
          <Ionicons name={icon} size={20} color="#FFFFFF" />
        </View>
        <Text style={styles.walletTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.walletText} numberOfLines={2}>{body}</Text>
      </View>
    </Pressable>
  );
}

const TXN_ICON: Record<string, IconName> = {
  PAYMENT: 'bag-handle',
  TRANSFER: 'person',
  CASHOUT: 'cash',
  TOPUP: 'add',
  FEE: 'pricetag',
};

const STATUS_COLOR: Record<string, string> = { SUCCESS: colors.success, PENDING: colors.warning, FAILED: colors.danger };

function TransactionItem({ row }: { row: TransactionRow }) {
  const { t, money, dateTime } = useI18n();
  const out = row.direction === 'OUT';
  const fallback = row.type === 'TOPUP' ? t('txn.topup') : row.type === 'CASHOUT' ? t('txn.cashout')
    : row.type === 'FEE' ? t('txn.fee') : row.type === 'TRANSFER' ? t(out ? 'txn.transfer' : 'txn.transferIn') : t('txn.payment');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
      onPress={() => router.push(`/receipt/${row.id}`)}
      testID="txn-row"
      accessibilityRole="button"
      accessibilityLabel={t(out ? 'txn.a11yOut' : 'txn.a11yIn', { amount: money(Number(row.amount)), name: row.counterparty_name ?? fallback })}>
      <View style={[styles.rowIcon, { backgroundColor: out ? colors.surface : colors.successSurface }]}>
        <Ionicons name={TXN_ICON[row.type] ?? 'swap-horizontal'} size={18} color={out ? colors.text : colors.success} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{row.counterparty_name ?? fallback}</Text>
        <Text style={styles.rowMeta}>{dateTime(row.created_at)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={[styles.rowAmount, !out && { color: colors.success }]}>
          {out ? '−' : '+'}
          {money(Number(row.amount))}
        </Text>
        <Text style={[styles.rowStatus, { color: STATUS_COLOR[row.status] ?? colors.muted }]}>{t(`status.${row.status}`)}</Text>
      </View>
    </Pressable>
  );
}

const TABS: { icon: IconName; label: TranslationKey; href?: Href; testID?: string }[] = [
  { icon: 'home', label: 'tab.home' },
  { icon: 'sparkles-outline', label: 'tab.coach', href: '/coach', testID: 'tab-coach' },
  { icon: 'wallet-outline', label: 'tab.savings', href: '/coach/savings', testID: 'tab-savings' },
  { icon: 'trending-up-outline', label: 'tab.forecast', href: '/coach/forecast', testID: 'tab-forecast' },
  { icon: 'person-outline', label: 'tab.profile', href: '/settings', testID: 'settings-button' },
];

function TabBar() {
  const { t } = useI18n();
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const active = !tab.href;
        return (
          <Pressable
            key={tab.label}
            style={styles.tab}
            onPress={tab.href ? () => router.push(tab.href!) : undefined}
            testID={tab.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(tab.label)}>
            <Ionicons name={tab.icon} size={24} color={active ? colors.text : colors.muted} />
            {active && <View style={styles.tabDot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: { gap: 24, marginBottom: 8 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  initial: { color: colors.primaryText, fontSize: 18, fontWeight: '700' },
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 10, right: 11, width: 9, height: 9, borderRadius: 5,
    backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.surface,
  },
  balanceLabel: { color: colors.muted, fontSize: 16, fontWeight: '600' },
  balance: { color: colors.text, fontSize: 46, fontWeight: '800', letterSpacing: -1.5 },
  balanceFraction: { color: '#A3A3A3', fontSize: 30, letterSpacing: -0.5 },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1, alignItems: 'center', gap: 8 },
  actionCircle: {
    width: '100%', maxWidth: 100, aspectRatio: 1, borderRadius: 999,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  section: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: -8 },
  cards: { flexDirection: 'row', gap: 12 },
  wallet: { flex: 1, minHeight: 172, borderRadius: 28, paddingTop: 34, overflow: 'hidden' },
  walletSlot: {
    position: 'absolute', top: 12, left: 14, right: 14, height: 48,
    borderRadius: 16, backgroundColor: colors.background,
  },
  walletBody: {
    flex: 1, borderRadius: 26, padding: 14, gap: 4, justifyContent: 'flex-end',
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.25)',
  },
  walletIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 'auto' },
  walletTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', marginTop: 12 },
  walletText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 18 },
  empty: { color: colors.muted, paddingVertical: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  rowIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.muted },
  rowAmount: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowStatus: { fontSize: 12, fontWeight: '600' },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24, paddingVertical: 12 },
  logoutText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  tabBar: {
    flexDirection: 'row', width: '100%', maxWidth: 480, alignSelf: 'center',
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 6 },
  tabDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.text },
});
