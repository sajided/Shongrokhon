import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, colors } from '@/components/ui';
import type { TranslationKey } from '@/i18n/en';
import { useI18n } from '@/i18n/LocaleProvider';

/**
 * Product tour for signed-out visitors: mock screens in a phone frame, all
 * client-side with made-up data. Nothing here calls the backend.
 */

type IconName = ComponentProps<typeof Ionicons>['name'];

const STEPS = [1, 2, 3, 4, 5, 6] as const;
type Step = (typeof STEPS)[number];
const WIDE = 860;
const PHONE_W = 300;

const STEP_ICON: Record<Step, IconName> = {
  1: 'home-outline',
  2: 'qr-code-outline',
  3: 'pulse-outline',
  4: 'hand-left-outline',
  5: 'sparkles-outline',
  6: 'trending-up-outline',
};

export function DemoTour() {
  const { t, locale, setLanguage } = useI18n();
  const width = useWindowDimensions().width;
  const wide = width >= WIDE;
  const [step, setStep] = useState<Step>(1);
  const last = step === STEPS.length;

  const exit = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));
  const next = () => (last ? exit() : setStep((step + 1) as Step));

  const controls = (
    <View style={styles.controls}>
      <View style={styles.dots}>
        {STEPS.map((s) => (
          <Pressable key={s} onPress={() => setStep(s)} testID={`demo-dot-${s}`} accessibilityRole="button"
            accessibilityLabel={t('demo.goTo', { n: s })} hitSlop={8}
            style={[styles.dot, s === step && styles.dotOn]} />
        ))}
      </View>

      <View style={styles.nav}>
        <Pressable onPress={() => setStep((step - 1) as Step)} disabled={step === 1} testID="demo-prev"
          accessibilityRole="button" style={[styles.navButton, styles.navSecondary, step === 1 && { opacity: 0.4 }]}>
          <Ionicons name="arrow-back" size={16} color={colors.text} />
          <Text style={styles.navSecondaryText}>{t('demo.prev')}</Text>
        </Pressable>
        <Pressable onPress={next} testID="demo-next" accessibilityRole="button" style={[styles.navButton, styles.navPrimary]}>
          <Text style={styles.navPrimaryText}>{t(last ? 'demo.finish' : 'demo.next')}</Text>
          <Ionicons name={last ? 'person-add-outline' : 'arrow-forward'} size={16} color={colors.primaryText} />
        </Pressable>
      </View>
    </View>
  );

  const caption = (
    <View style={[styles.caption, wide && styles.captionWide]}>
      <View style={styles.stepTag}>
        <Ionicons name={STEP_ICON[step]} size={14} color={colors.text} />
        <Text style={styles.stepTagText}>{t('demo.stepOf', { n: step, total: STEPS.length })}</Text>
      </View>
      <Text style={[styles.title, wide && styles.titleWide]} accessibilityRole="header" testID="demo-title">
        {t(`demo.s${step}.title`)}
      </Text>
      <Text style={styles.body}>{t(`demo.s${step}.body`)}</Text>

      {wide ? controls : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.scrollWide]}>
        <View style={[styles.frame, wide && styles.frameWide]}>
          <View style={styles.topBar}>
            <Pressable onPress={exit} style={styles.backPill} testID="demo-exit" accessibilityRole="button">
              <Ionicons name="arrow-back" size={16} color={colors.text} />
              <Text style={styles.backText}>{t('demo.back')}</Text>
            </Pressable>
            <View style={styles.langSwitch}>
              {(['en', 'bn'] as const).map((l) => (
                <Pressable key={l} onPress={() => setLanguage(l)} testID={`demo-lang-${l}`}
                  accessibilityRole="radio" accessibilityState={{ selected: locale === l }}
                  style={[styles.langOption, locale === l && styles.langOptionOn]}>
                  <Text style={[styles.langText, locale === l && styles.langTextOn]}>
                    {t(l === 'en' ? 'settings.english' : 'settings.bangla')}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={[styles.stage, wide && styles.stageWide]}>
            {caption}
            <View style={styles.phoneCol}>
              <View style={styles.badge}>
                <View style={styles.badgeDot} />
                <Text style={styles.badgeText}>{t('demo.badge')}</Text>
              </View>
              <Phone width={Math.min(PHONE_W, width - 48)} height={wide ? 600 : 500}>
                <Screen step={step} />
              </Phone>
            </View>
          </View>
        </View>
      </ScrollView>
      {wide ? null : <View style={styles.bottomBar}>{controls}</View>}
    </SafeAreaView>
  );
}

function Phone({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  return (
    <View style={[styles.phone, { width, height }]}>
      <View style={styles.notch} />
      <View style={styles.phoneScreen}>{children}</View>
    </View>
  );
}

function Screen({ step }: { step: Step }) {
  switch (step) {
    case 1: return <HomeScreen />;
    case 2: return <PayScreen />;
    case 3: return <CheckScreen />;
    case 4: return <CashoutScreen />;
    case 5: return <CoachScreen />;
    case 6: return <PlanScreen />;
  }
}

function HomeScreen() {
  const { t, money } = useI18n();
  const rows: { name: TranslationKey; when: TranslationKey; amount: number; icon: IconName }[] = [
    { name: 'demo.m.grocer', when: 'demo.when.today', amount: -450, icon: 'storefront' },
    { name: 'demo.m.gas', when: 'demo.when.yesterday', amount: -1080, icon: 'receipt' },
    { name: 'demo.m.salary', when: 'demo.when.monday', amount: 28000, icon: 'arrow-down' },
  ];
  return (
    <View style={styles.screen} testID="demo-screen-home">
      <View style={styles.mTop}>
        <View style={styles.mAvatar}><Ionicons name="person" size={14} color={colors.primaryText} /></View>
        <View style={styles.mBell}><Ionicons name="notifications" size={13} color={colors.text} /></View>
      </View>
      <Text style={styles.mLabel}>{t('home.balance')}</Text>
      <Text style={styles.mBalance}>{money(5000)}</Text>
      <View style={styles.mActions}>
        {([['scan', 'home.scan'], ['paper-plane', 'home.send'], ['swap-horizontal', 'home.cashout']] as const).map(([icon, key]) => (
          <View key={key} style={styles.mAction}>
            <View style={[styles.mActionCircle, key === 'home.scan' && styles.highlight]}>
              <Ionicons name={icon} size={20} color={colors.text} />
            </View>
            <Text style={styles.mActionLabel} numberOfLines={1}>{t(key)}</Text>
          </View>
        ))}
      </View>
      <View style={styles.mCards}>
        <MiniWallet frame={colors.red} body={colors.redDeep} icon="sparkles" title={t('nav.coach')} />
        <MiniWallet frame={colors.blue} body={colors.blueDeep} icon="receipt" title={t('home.bills')} />
      </View>
      <Text style={styles.mSection}>{t('home.recent')}</Text>
      {rows.map((r) => (
        <View key={r.name} style={styles.mRow}>
          <View style={[styles.mRowIcon, r.amount > 0 && { backgroundColor: colors.successSurface }]}>
            <Ionicons name={r.icon} size={13} color={r.amount > 0 ? colors.success : colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mRowTitle}>{t(r.name)}</Text>
            <Text style={styles.mRowMeta}>{t(r.when)}</Text>
          </View>
          <Text style={[styles.mRowAmount, r.amount > 0 && { color: colors.success }]}>
            {r.amount > 0 ? '+' : '−'}{money(Math.abs(r.amount))}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MiniWallet({ frame, body, icon, title }: { frame: string; body: string; icon: IconName; title: string }) {
  return (
    <View style={[styles.mWallet, { backgroundColor: frame }]}>
      <View style={styles.mWalletSlot} />
      <View style={[styles.mWalletBody, { backgroundColor: body }]}>
        <Ionicons name={icon} size={14} color="#FFFFFF" />
        <Text style={styles.mWalletTitle} numberOfLines={1}>{title}</Text>
      </View>
    </View>
  );
}

function PayScreen() {
  const { t, money } = useI18n();
  return (
    <View style={styles.screen} testID="demo-screen-pay">
      <View style={styles.viewfinder}>
        <View style={[styles.corner, styles.cTL]} />
        <View style={[styles.corner, styles.cTR]} />
        <View style={[styles.corner, styles.cBL]} />
        <View style={[styles.corner, styles.cBR]} />
        <Ionicons name="qr-code" size={64} color="#FFFFFF" />
        <View style={styles.scanLine} />
      </View>
      <View style={styles.scannedPill}>
        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
        <Text style={styles.scannedText}>{t('demo.pay.scanned')}</Text>
      </View>
      <View style={styles.mField}>
        <Text style={styles.mFieldLabel}>{t('demo.pay.to')}</Text>
        <View style={styles.mInputRow}>
          <View style={styles.mRowIcon}><Ionicons name="storefront" size={13} color={colors.text} /></View>
          <Text style={styles.mInputText}>{t('demo.m.grocer')}</Text>
        </View>
      </View>
      <View style={styles.mField}>
        <Text style={styles.mFieldLabel}>{t('demo.pay.amount')}</Text>
        <View style={styles.mInput}><Text style={styles.mInputBig}>{money(450)}</Text></View>
      </View>
      <View style={styles.mField}>
        <Text style={styles.mFieldLabel}>{t('demo.pay.pin')}</Text>
        <View style={styles.pinRow}>
          {[0, 1, 2, 3].map((i) => <View key={i} style={styles.pinDot} />)}
        </View>
      </View>
      <View style={[styles.mButton, styles.highlight]}>
        <Text style={styles.mButtonText}>{t('demo.pay.button', { amount: money(450) })}</Text>
      </View>
    </View>
  );
}

function CheckScreen() {
  const { t, money, digits } = useI18n();
  return (
    <View style={[styles.screen, { justifyContent: 'center' }]} testID="demo-screen-check">
      <View style={styles.checkCard}>
        <View style={styles.checkHead}>
          <Ionicons name="pulse" size={14} color={colors.text} />
          <Text style={styles.checkTitle}>{t('demo.check.title')}</Text>
          <View style={styles.lowPill}><Text style={styles.lowPillText}>{t('demo.check.low')}</Text></View>
        </View>
        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: '6%' }]} />
          <View style={[styles.meterTick, { left: '45%' }]} />
          <View style={[styles.meterTick, { left: '80%' }]} />
        </View>
        <Text style={styles.checkScore}>{t('demo.check.score', { score: digits('6') })}</Text>
      </View>
      <View style={styles.doneIcon}>
        <Ionicons name="checkmark" size={36} color={colors.primaryText} />
      </View>
      <Text style={styles.doneTitle}>{t('demo.check.done')}</Text>
      <Text style={styles.doneAmount}>{money(450)}</Text>
      <Text style={styles.doneTo}>{t('demo.check.to', { name: t('demo.m.grocer') })}</Text>
    </View>
  );
}

function CashoutScreen() {
  const { t, money } = useI18n();
  return (
    <View style={[styles.screen, { justifyContent: 'center' }]} testID="demo-screen-cashout">
      <View style={styles.warnIcon}><Ionicons name="hand-left" size={26} color={colors.danger} /></View>
      <Text style={styles.warnTitle}>{t('stepUp.cashoutTitle')}</Text>
      <View style={styles.warnMerchant}>
        <View style={styles.mRowIcon}><Ionicons name="storefront" size={13} color={colors.text} /></View>
        <Text style={[styles.mRowTitle, { flex: 1 }]}>{t('demo.m.cashpoint')}</Text>
        <Text style={styles.mRowAmount}>{money(5000)}</Text>
      </View>
      <Text style={styles.warnBody}>{t('stepUp.cashoutBody', { name: t('demo.m.cashpoint') })}</Text>
      <Text style={styles.warnBody}>{t('stepUp.cashoutAdvice', { name: t('demo.m.cashpoint') })}</Text>
      <View style={[styles.mButton, styles.highlight, { marginTop: 'auto' }]}>
        <Text style={styles.mButtonText}>{t('stepUp.cashoutCancel')}</Text>
      </View>
      <View style={[styles.mButton, styles.mButtonSecondary]}>
        <Text style={[styles.mButtonText, { color: colors.text }]}>{t('stepUp.cashoutConfirm')}</Text>
      </View>
    </View>
  );
}

function CoachScreen() {
  const { t, money, percent } = useI18n();
  const cats: { key: TranslationKey; share: number; color: string }[] = [
    { key: 'demo.coach.food', share: 0.46, color: colors.red },
    { key: 'demo.coach.bills', share: 0.34, color: colors.blue },
    { key: 'demo.coach.transport', share: 0.2, color: colors.muted },
  ];
  return (
    <View style={styles.screen} testID="demo-screen-coach">
      <Text style={styles.mLabel}>{t('demo.coach.title')}</Text>
      <Text style={styles.mBalance}>{money(9850)}</Text>
      <Text style={styles.mRowMeta}>{t('demo.coach.spent')}</Text>
      <View style={styles.bar}>
        {cats.map((c) => <View key={c.key} style={{ flex: c.share, backgroundColor: c.color }} />)}
      </View>
      <View style={{ gap: 4 }}>
        {cats.map((c) => (
          <View key={c.key} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: c.color }]} />
            <Text style={[styles.mRowMeta, { flex: 1, color: colors.text }]}>{t(c.key)}</Text>
            <Text style={styles.mRowMeta}>{percent(c.share)}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.insight, styles.highlight]}>
        <Ionicons name="sparkles" size={14} color={colors.red} />
        <Text style={styles.insightText}>{t('demo.coach.insight1', { pct: percent(0.18), amount: money(600) })}</Text>
      </View>
      <View style={styles.insight}>
        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
        <Text style={styles.insightText}>{t('demo.coach.insight2')}</Text>
      </View>
      <View style={[styles.mInputRow, { marginTop: 'auto' }]}>
        <Text style={[styles.mRowMeta, { flex: 1 }]}>{t('demo.coach.ask')}</Text>
        <View style={styles.sendCircle}><Ionicons name="arrow-up" size={12} color={colors.primaryText} /></View>
      </View>
    </View>
  );
}

function PlanScreen() {
  const { t, money, digits } = useI18n();
  const weeks = [0.7, 0.45, 0.85, 0.2];
  return (
    <View style={styles.screen} testID="demo-screen-plan">
      <Text style={styles.mSection}>{t('demo.plan.goals')}</Text>
      <View style={styles.goalCard}>
        <View style={styles.legendRow}>
          <Ionicons name="gift" size={14} color={colors.red} />
          <Text style={[styles.mRowTitle, { flex: 1 }]}>{t('demo.plan.goal')}</Text>
        </View>
        <View style={styles.progress}><View style={[styles.progressFill, { width: '60%' }]} /></View>
        <Text style={styles.mRowMeta}>{t('demo.plan.progress', { saved: money(6000), target: money(10000) })}</Text>
      </View>
      <Text style={styles.mSection}>{t('demo.plan.forecast')}</Text>
      <View style={styles.chart}>
        {weeks.map((h, i) => (
          <View key={i} style={styles.chartCol}>
            <View style={styles.chartTrack}>
              <View style={[styles.chartBar, { height: `${h * 100}%` }, i === 3 && { backgroundColor: colors.warning }]} />
            </View>
            <Text style={styles.chartLabel}>{t('demo.plan.week', { n: digits(String(i + 1)) })}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.insight, styles.warnInsight, styles.highlight]}>
        <Ionicons name="alert-circle" size={14} color={colors.warning} />
        <Text style={styles.insightText}>{t('demo.plan.warn', { amount: money(820) })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#E4E4E2' },
  scroll: { flexGrow: 1, padding: 8 },
  scrollWide: { padding: 24 },
  frame: { flexGrow: 1, width: '100%', maxWidth: 1120, alignSelf: 'center', borderRadius: 40, backgroundColor: colors.surface, padding: 16, gap: 24 },
  frameWide: { padding: 32, borderRadius: 48 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  backPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#FFFFFF' },
  backText: { fontSize: 13, fontWeight: '600', color: colors.text },
  langSwitch: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 999, padding: 3 },
  langOption: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  langOptionOn: { backgroundColor: colors.primary },
  langText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  langTextOn: { color: colors.primaryText },

  stage: { alignItems: 'center', gap: 28, paddingBottom: 16 },
  stageWide: { flexDirection: 'row', justifyContent: 'center', gap: 72, paddingVertical: 24 },
  phoneCol: { alignItems: 'center', gap: 14 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: '#FFFFFF', transform: [{ rotate: '-3deg' }] },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red },
  badgeText: { fontSize: 11, fontWeight: '600', color: colors.text },

  caption: { width: '100%', maxWidth: 420, gap: 14 },
  captionWide: { flex: 1, maxWidth: 440 },
  stepTag: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#FFFFFF' },
  stepTagText: { fontSize: 12, fontWeight: '600', color: colors.text },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, color: colors.text },
  titleWide: { fontSize: 40, lineHeight: 46, letterSpacing: -1.1 },
  body: { fontSize: 15, lineHeight: 23, color: colors.muted },
  controls: { gap: 14 },
  bottomBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dots: { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D4D4D4' },
  dotOn: { width: 24, backgroundColor: colors.primary },
  nav: { flexDirection: 'row', gap: 10, marginTop: 4 },
  navButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, minHeight: 48, borderRadius: 999 },
  navPrimary: { flex: 1, backgroundColor: colors.primary },
  navPrimaryText: { color: colors.primaryText, fontSize: 15, fontWeight: '600' },
  navSecondary: { backgroundColor: '#FFFFFF' },
  navSecondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },

  phone: { borderRadius: 46, backgroundColor: colors.primary, padding: 9, boxShadow: '0 30px 60px rgba(0, 0, 0, 0.18)' },
  notch: { position: 'absolute', top: 18, alignSelf: 'center', width: 84, height: 22, borderRadius: 11, backgroundColor: colors.primary, zIndex: 2 },
  phoneScreen: { flex: 1, borderRadius: 37, backgroundColor: colors.background, overflow: 'hidden' },
  screen: { flex: 1, paddingHorizontal: 16, paddingTop: 52, paddingBottom: 18, gap: 10 },
  highlight: { boxShadow: '0 0 0 3px rgba(192, 0, 0, 0.25)' },

  mTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  mAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  mBell: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  mLabel: { fontSize: 11, fontWeight: '600', color: colors.muted },
  mBalance: { fontSize: 28, fontWeight: '800', letterSpacing: -1, color: colors.text, marginTop: -6 },
  mActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  mAction: { flex: 1, alignItems: 'center', gap: 4 },
  mActionCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  mActionLabel: { fontSize: 10, fontWeight: '600', color: colors.text },
  mCards: { flexDirection: 'row', gap: 8, marginTop: 2 },
  mWallet: { flex: 1, height: 74, borderRadius: 16, paddingTop: 16, overflow: 'hidden' },
  mWalletSlot: { position: 'absolute', top: 6, left: 8, right: 8, height: 22, borderRadius: 8, backgroundColor: colors.background },
  mWalletBody: { flex: 1, borderRadius: 14, padding: 8, justifyContent: 'space-between' },
  mWalletTitle: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  mSection: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 4 },
  mRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  mRowIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  mRowTitle: { fontSize: 12, fontWeight: '600', color: colors.text },
  mRowMeta: { fontSize: 10, color: colors.muted },
  mRowAmount: { fontSize: 12, fontWeight: '700', color: colors.text },

  viewfinder: { height: 150, borderRadius: 20, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: '#FFFFFF' },
  cTL: { top: 18, left: 58, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  cTR: { top: 18, right: 58, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  cBL: { bottom: 18, left: 58, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  cBR: { bottom: 18, right: 58, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  scanLine: { position: 'absolute', left: 58, right: 58, top: 74, height: 2, backgroundColor: colors.red },
  scannedPill: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.successSurface },
  scannedText: { fontSize: 11, fontWeight: '600', color: colors.success },
  mField: { gap: 4 },
  mFieldLabel: { fontSize: 10, fontWeight: '600', color: colors.muted },
  mInput: { minHeight: 40, borderRadius: 999, backgroundColor: colors.surface, paddingHorizontal: 14, justifyContent: 'center' },
  mInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, borderRadius: 999, backgroundColor: colors.surface, paddingHorizontal: 6, paddingRight: 8 },
  mInputText: { fontSize: 13, fontWeight: '600', color: colors.text },
  mInputBig: { fontSize: 18, fontWeight: '800', color: colors.text },
  pinRow: { flexDirection: 'row', gap: 8 },
  pinDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.text },
  mButton: { minHeight: 42, borderRadius: 999, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  mButtonSecondary: { backgroundColor: colors.surface, marginTop: 0 },
  mButtonText: { color: colors.primaryText, fontSize: 13, fontWeight: '600' },

  checkCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkTitle: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.text },
  lowPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.successSurface },
  lowPillText: { fontSize: 10, fontWeight: '700', color: colors.success },
  meter: { height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  meterFill: { height: '100%', backgroundColor: colors.success, borderRadius: 4 },
  meterTick: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#FFFFFF' },
  checkScore: { fontSize: 10, color: colors.muted },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 28 },
  doneTitle: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: 6 },
  doneAmount: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: colors.text, textAlign: 'center' },
  doneTo: { fontSize: 12, color: colors.muted, textAlign: 'center' },

  warnIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.dangerSurface, alignItems: 'center', justifyContent: 'center' },
  warnTitle: { fontSize: 19, lineHeight: 24, fontWeight: '800', color: colors.text },
  warnMerchant: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, paddingRight: 12, borderRadius: 999, backgroundColor: colors.surface },
  warnBody: { fontSize: 11, lineHeight: 16, color: colors.muted },

  bar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  insight: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border },
  insightText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.text },
  sendCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },

  goalCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, gap: 8, borderWidth: 1, borderColor: colors.border },
  progress: { height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.text },
  chart: { flexDirection: 'row', gap: 10, height: 130, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: colors.border },
  chartCol: { flex: 1, alignItems: 'center', gap: 4 },
  chartTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderRadius: 6, backgroundColor: colors.text },
  chartLabel: { fontSize: 10, color: colors.muted },
  warnInsight: { backgroundColor: colors.warningSurface, borderColor: colors.warningSurface },
});
