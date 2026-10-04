import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorBanner, Field, Text, colors } from '@/components/ui';
import type { TranslationKey } from '@/i18n/en';
import { useI18n } from '@/i18n/LocaleProvider';
import { ApiError } from '@/lib/api';
import { sendOtp, linkError } from '@/lib/auth';
import { readAuthMethod } from '@/lib/config';
import { normalizeBdPhone, normalizeEmail } from '@/lib/validation';

const AUTH_METHOD = readAuthMethod();
/** Four feature columns from this width, two from MEDIUM, one below. */
const WIDE = 900;
const MEDIUM = 600;
/** Each band tucks under the rounded bottom of the one above it. */
const RADIUS = 40;

/** Landing-page greys: a frame around alternating grey and white bands. */
const tone = {
  frame: '#E4E4E2',
  grey: colors.surface,
  white: '#FFFFFF',
  line: '#DCDCDC',
  ink: colors.primary,
  inkRaised: '#1E1E1E',
  inkLine: '#2E2E2E',
  inkSoft: '#9A9A9A',
};

type IconName = ComponentProps<typeof Ionicons>['name'];

const STRIP: { key: 'qr' | 'send' | 'cashout' | 'bills' | 'goals' | 'forecast'; icon: IconName }[] = [
  { key: 'qr', icon: 'qr-code' },
  { key: 'send', icon: 'paper-plane' },
  { key: 'cashout', icon: 'cash' },
  { key: 'bills', icon: 'receipt' },
  { key: 'goals', icon: 'flag' },
  { key: 'forecast', icon: 'trending-up' },
];

const FEATURES: { key: 'pay' | 'coach' | 'guard' | 'bangla'; icon: IconName }[] = [
  { key: 'pay', icon: 'qr-code-outline' },
  { key: 'coach', icon: 'sparkles-outline' },
  { key: 'guard', icon: 'shield-checkmark-outline' },
  { key: 'bangla', icon: 'language-outline' },
];

const GUARD_STEPS: { n: 1 | 2 | 3; icon: IconName }[] = [
  { n: 1, icon: 'scan-outline' },
  { n: 2, icon: 'pulse-outline' },
  { n: 3, icon: 'git-branch-outline' },
];

/** Plain-language versions of the strongest model features (ml/shongrokhon_ml/features.py) and the ring job. */
const SIGNALS: { key: 'cashout' | 'round' | 'amount' | 'burst' | 'night' | 'new' | 'ring'; icon: IconName }[] = [
  { key: 'cashout', icon: 'cash-outline' },
  { key: 'round', icon: 'ellipse-outline' },
  { key: 'amount', icon: 'trending-up-outline' },
  { key: 'burst', icon: 'flash-outline' },
  { key: 'night', icon: 'moon-outline' },
  { key: 'new', icon: 'storefront-outline' },
  { key: 'ring', icon: 'git-network-outline' },
];

export default function SignIn() {
  const { t, msg, locale, setLanguage } = useI18n();
  const width = useWindowDimensions().width;
  const wide = width >= WIDE;
  const medium = width >= MEDIUM;
  const scroll = useRef<ScrollView>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = AUTH_METHOD === 'email' ? linkError() : null;
    return code ? msg(code) : null;
  });
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const email = AUTH_METHOD === 'email';

  const submit = async () => {
    const to = email ? normalizeEmail(value) : normalizeBdPhone(value);
    if (!to) return setError(msg(email ? 'INVALID_EMAIL' : 'INVALID_PHONE'));
    setError(null);
    setBusy(true);
    try {
      await sendOtp(to);
      if (email) setLinkSentTo(to);
      else router.push({ pathname: '/verify', params: { to } });
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  const steps: TranslationKey[] = email
    ? ['signIn.stepsEmail1', 'signIn.stepsEmail2', 'signIn.step3']
    : ['signIn.step1', 'signIn.step2', 'signIn.step3'];

  const headlineSize = wide ? styles.headlineWide : medium ? styles.headlineMedium : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView ref={scroll} contentContainerStyle={[styles.scroll, medium && styles.scrollWide]}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.frame, medium && styles.frameWide]}>
          {/* Hero: brand, headline and the sign-in form. */}
          <Band color={tone.grey} first z={5} style={[styles.hero, medium && styles.heroWide]}>
            <View style={styles.topBar}>
              <View style={styles.brandPill}>
                <View style={styles.logoSmall}>
                  <Text style={styles.logoSmallText}>S</Text>
                </View>
                <Text style={styles.brandName} numberOfLines={1}>{t('signIn.brandBadge')}</Text>
              </View>
              <View style={styles.langSwitch} accessibilityRole="radiogroup" accessibilityLabel={t('signIn.language')}>
                {(['en', 'bn'] as const).map((l) => (
                  <Pressable
                    key={l}
                    testID={`signin-lang-${l}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: locale === l }}
                    onPress={() => setLanguage(l)}
                    style={[styles.langOption, locale === l && styles.langOptionOn]}>
                    <Text style={[styles.langText, locale === l && styles.langTextOn]}>
                      {t(l === 'en' ? 'settings.english' : 'settings.bangla')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.heroCenter}>
              <View style={styles.avatarWrap}>
                <View style={styles.avatarRing}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>S</Text>
                  </View>
                </View>
                <View style={styles.sticker}>
                  <View style={styles.stickerDot} />
                  <Text style={styles.stickerText} numberOfLines={1}>{t('signIn.sticker')}</Text>
                </View>
              </View>

              <Text style={[styles.headline, headlineSize]} accessibilityRole="header">
                {t('signIn.headlineA')} <Text style={[styles.headline, headlineSize, styles.soft]}>{t('signIn.headlineB')}</Text>
              </Text>
              <Text style={[styles.pitch, medium && styles.pitchWide]}>{t('signIn.pitch')}</Text>
              <DemoButton label={t('signIn.demo')} testID="demo-button" />

              <View style={styles.form}>
                <View style={styles.formHead}>
                  <Text style={styles.formTitle}>{t('signIn.title')}</Text>
                  <Text style={styles.formBody}>{t(email ? 'signIn.bodyEmail' : 'signIn.body')}</Text>
                </View>
                {email ? (
                  <Field
                    label={t('signIn.email')}
                    testID="email-input"
                    value={value}
                    onChangeText={(next) => {
                      setValue(next);
                      setLinkSentTo(null);
                    }}
                    onSubmitEditing={submit}
                    keyboardType="email-address"
                    autoComplete="email"
                    autoCapitalize="none"
                    maxLength={254}
                    style={styles.input}
                  />
                ) : (
                  <Field
                    label={t('signIn.phone')}
                    testID="phone-input"
                    value={value}
                    onChangeText={setValue}
                    onSubmitEditing={submit}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    placeholder="01XXXXXXXXX"
                    maxLength={16}
                    style={styles.input}
                  />
                )}

                {linkSentTo && (
                  <View style={styles.linkSentBox}>
                    <Ionicons name="mail-outline" size={18} color={colors.success} />
                    <Text testID="link-sent" style={styles.linkSent}>
                      {t('signIn.linkSent', { email: linkSentTo })}
                    </Text>
                  </View>
                )}

                <ErrorBanner message={error} />

                <Button
                  title={t(email ? (linkSentTo ? 'signIn.resendLink' : 'signIn.sendLink') : 'signIn.send')}
                  variant={linkSentTo ? 'secondary' : 'primary'}
                  onPress={submit}
                  busy={busy}
                  testID="send-otp"
                />

                <View style={styles.securityNote}>
                  <Ionicons name="lock-closed" size={12} color={colors.muted} />
                  <Text style={styles.securityText}>{t('signIn.security')}</Text>
                </View>
              </View>
            </View>
          </Band>

          {/* What the wallet does, as a strip like a row of logos. */}
          <Band color={tone.white} z={4} style={styles.stripBand}>
            <View style={[styles.strip, !medium && styles.stripNarrow]}>
              {STRIP.map((s) => (
                <View key={s.key} style={[styles.stripItem, !medium && styles.stripItemNarrow]}>
                  <Ionicons name={s.icon} size={22} color={colors.text} />
                  <Text style={styles.stripText}>{t(`signIn.strip.${s.key}`)}</Text>
                </View>
              ))}
            </View>
          </Band>

          {/* Features. */}
          <Band color={tone.grey} z={3} style={styles.section}>
            <Text style={[styles.sectionTitle, medium && styles.sectionTitleWide]}>
              {t('signIn.sectionA')} <Text style={[styles.sectionTitle, medium && styles.sectionTitleWide, styles.soft]}>
                {t('signIn.sectionB')}
              </Text>
            </Text>
            <View style={styles.rule}>
              <View style={styles.ruleLine} />
              <View style={styles.rulePill}>
                <Text style={styles.rulePillText}>{t('signIn.featuresTitle')}</Text>
              </View>
            </View>
            <View style={styles.features}>
              {FEATURES.map((f) => (
                <View key={f.key} testID={`feature-${f.key}`}
                  style={[styles.feature, { flexBasis: wide ? '22%' : medium ? '44%' : '100%' }]}>
                  <Ionicons name={f.icon} size={22} color={colors.text} />
                  <Text style={styles.featureTitle}>{t(`signIn.feature.${f.key}.title`)}</Text>
                  <Text style={styles.featureBody}>{t(`signIn.feature.${f.key}.body`)}</Text>
                </View>
              ))}
            </View>
          </Band>

          {/* How disguised cash-outs are caught (pay function + ML risk score). */}
          <Band color={tone.ink} z={2} style={styles.section}>
            <View style={styles.guardPill}>
              <Ionicons name="shield-checkmark" size={13} color={colors.text} />
              <Text style={styles.rulePillText}>{t('signIn.guard.label')}</Text>
            </View>
            <Text style={[styles.sectionTitle, styles.guardTitle, medium && styles.sectionTitleWide]}>
              {t('signIn.guard.titleA')} <Text style={[styles.sectionTitle, styles.guardTitle, medium && styles.sectionTitleWide, styles.guardSoft]}>
                {t('signIn.guard.titleB')}
              </Text>
            </Text>
            <Text style={[styles.pitch, styles.guardIntro, medium && styles.pitchWide]}>{t('signIn.guard.intro')}</Text>

            <View style={[styles.guardBody, wide && styles.guardBodyWide]}>
              <View style={styles.guardFlow}>
                {GUARD_STEPS.map((g, i) => (
                  <View key={g.n} style={styles.guardStep}>
                    <View style={styles.guardStepRail}>
                      <View style={styles.guardStepIcon}>
                        <Ionicons name={g.icon} size={18} color={colors.text} />
                      </View>
                      {i < GUARD_STEPS.length - 1 && <View style={styles.guardStepLine} />}
                    </View>
                    <View style={styles.guardStepCopy}>
                      <Text style={styles.guardStepTitle}>{t(`signIn.guard.step${g.n}.title`)}</Text>
                      <Text style={styles.guardStepBody}>{t(`signIn.guard.step${g.n}.body`)}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.preview} testID="cashout-preview">
                <Text style={styles.previewLabel}>{t('signIn.guard.previewLabel')}</Text>
                <View style={styles.previewCard}>
                  <View style={styles.previewIcon}>
                    <Ionicons name="hand-left" size={20} color={colors.danger} />
                  </View>
                  <Text style={styles.previewTitle}>{t('stepUp.cashoutTitle')}</Text>
                  <Text style={styles.previewBody}>{t('signIn.guard.previewBody')}</Text>
                  <View style={styles.previewPrimary}>
                    <Text style={styles.previewPrimaryText}>{t('stepUp.cashoutCancel')}</Text>
                  </View>
                  <View style={styles.previewSecondary}>
                    <Text style={styles.previewSecondaryText}>{t('stepUp.cashoutConfirm')}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.signals}>
              <Text style={styles.guardSignalsTitle}>{t('signIn.guard.signalsTitle')}</Text>
              <View style={styles.signalChips}>
                {SIGNALS.map((sg) => (
                  <View key={sg.key} style={styles.signalChip}>
                    <Ionicons name={sg.icon} size={14} color={tone.inkSoft} />
                    <Text style={styles.signalText}>{t(`signIn.guard.signal.${sg.key}`)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Band>

          {/* Closing call to action. */}
          <Band color={tone.white} z={1} style={styles.section}>
            <View style={styles.ctaIcon}>
              <Ionicons name="wallet-outline" size={26} color={colors.text} />
            </View>
            <Text style={[styles.sectionTitle, styles.ctaTitle, medium && styles.ctaTitleWide]}>
              {t('signIn.ctaA')} <Text style={[styles.sectionTitle, styles.ctaTitle, medium && styles.ctaTitleWide, styles.soft]}>
                {t('signIn.ctaB')}
              </Text>
            </Text>
            <View style={[styles.steps, medium && styles.stepsWide]}>
              {steps.map((key, i) => (
                <View key={key} style={styles.step}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{t(key)}</Text>
                </View>
              ))}
            </View>
            <Pressable
              testID="cta-sign-in"
              accessibilityRole="button"
              onPress={() => scroll.current?.scrollTo({ y: 0, animated: true })}
              style={({ pressed }) => [styles.ctaButton, pressed && { opacity: 0.8 }]}>
              <Text style={styles.ctaButtonText}>{t('signIn.ctaButton')}</Text>
              <Ionicons name="arrow-up" size={14} color={colors.primaryText} />
            </Pressable>
            <DemoButton label={t('signIn.demo')} testID="demo-button-cta" light />

            <View style={[styles.footer, !medium && styles.footerNarrow]}>
              <Text style={styles.footerText}>{t('signIn.copyright', { year: new Date().getFullYear() })}</Text>
              <View style={styles.footerRight}>
                <Ionicons name="lock-closed" size={11} color={colors.muted} />
                <Text style={styles.footerText}>{t('signIn.security')}</Text>
              </View>
            </View>
          </Band>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Opens the product tour (src/components/DemoTour.tsx). */
function DemoButton({ label, testID, light }: { label: string; testID: string; light?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      onPress={() => router.push('/demo')}
      style={({ pressed }) => [styles.demoButton, light && styles.demoButtonLight, pressed && { opacity: 0.8 }]}>
      <View style={styles.demoPlay}>
        <Ionicons name="play" size={10} color={colors.primaryText} />
      </View>
      <Text style={styles.demoText}>{label}</Text>
    </Pressable>
  );
}

/** A rounded section; every band after the first slides up under the previous one. */
function Band({ color, z, first, style, children }: {
  color: string;
  z: number;
  first?: boolean;
  style?: ViewStyle | (ViewStyle | false | null)[];
  children: ReactNode;
}) {
  return (
    <View style={[
      { backgroundColor: color, zIndex: z, borderRadius: RADIUS },
      !first && { marginTop: -RADIUS, paddingTop: RADIUS, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
      StyleSheet.flatten(style),
    ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tone.frame },
  scroll: { flexGrow: 1, padding: 8 },
  scrollWide: { padding: 24 },
  frame: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    borderRadius: RADIUS,
    backgroundColor: tone.white,
    borderWidth: 1,
    borderColor: tone.white,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.06)',
  },
  frameWide: { borderRadius: RADIUS + 8 },

  hero: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
  heroWide: { paddingHorizontal: 32, paddingTop: 24, paddingBottom: 72 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 4,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: tone.white,
    flexShrink: 1,
  },
  logoSmall: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoSmallText: { color: colors.primaryText, fontSize: 14, fontWeight: '900' },
  brandName: { marginRight: 8, fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.text, flexShrink: 1 },
  langSwitch: { flexDirection: 'row', backgroundColor: tone.white, borderRadius: 999, padding: 3 },
  langOption: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  langOptionOn: { backgroundColor: colors.primary },
  langText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  langTextOn: { color: colors.primaryText },

  heroCenter: { alignItems: 'center', marginTop: 40, gap: 16 },
  avatarWrap: { marginBottom: 8 },
  avatarRing: { width: 84, height: 84, borderRadius: 42, backgroundColor: tone.white, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryText, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  sticker: {
    position: 'absolute',
    left: 58,
    top: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: tone.white,
    transform: [{ rotate: '-8deg' }],
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
  },
  stickerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red },
  stickerText: { fontSize: 11, fontWeight: '600', color: colors.text },

  headline: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: colors.text, textAlign: 'center' },
  headlineMedium: { fontSize: 44, lineHeight: 50, letterSpacing: -1.2 },
  headlineWide: { fontSize: 56, lineHeight: 62, letterSpacing: -1.6 },
  soft: { color: '#8A8A8A' },
  pitch: { fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', maxWidth: 520 },
  pitchWide: { fontSize: 17, lineHeight: 26 },

  demoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: tone.white,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.06)',
  },
  demoButtonLight: { marginTop: 10, backgroundColor: tone.grey, boxShadow: 'none' },
  demoPlay: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  demoText: { fontSize: 14, fontWeight: '600', color: colors.text },
  form: {
    width: '100%',
    maxWidth: 400,
    marginTop: 12,
    gap: 14,
    padding: 20,
    borderRadius: 28,
    backgroundColor: tone.white,
  },
  formHead: { gap: 4 },
  formTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  formBody: { fontSize: 13, lineHeight: 19, color: colors.muted },
  input: { borderRadius: 999 },
  linkSentBox: { backgroundColor: colors.successSurface, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkSent: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.success },
  securityNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  securityText: { fontSize: 12, color: colors.muted, fontWeight: '500' },

  stripBand: { paddingHorizontal: 16, paddingBottom: 40 + RADIUS / 2 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-evenly', rowGap: 20, columnGap: 28, paddingTop: 36 },
  stripNarrow: { justifyContent: 'flex-start', columnGap: 0, paddingHorizontal: 12 },
  stripItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stripItemNarrow: { flexBasis: '50%' },
  stripText: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3, color: colors.text },

  section: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 56 + RADIUS / 2 },
  sectionTitle: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.5, color: colors.text, textAlign: 'center', marginTop: 48, maxWidth: 560 },
  sectionTitleWide: { fontSize: 30, lineHeight: 38, maxWidth: 680 },
  rule: { width: '100%', maxWidth: 880, alignItems: 'center', justifyContent: 'center', marginTop: 32, marginBottom: 36, height: 32 },
  ruleLine: { position: 'absolute', left: 0, right: 0, top: 16, height: 1, backgroundColor: tone.line },
  rulePill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: tone.white,
    transform: [{ rotate: '-4deg' }],
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.06)',
  },
  rulePillText: { fontSize: 12, fontWeight: '600', color: colors.text },
  features: { width: '100%', maxWidth: 880, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 32, columnGap: 24 },
  feature: { flexGrow: 1, gap: 8 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 6 },
  featureBody: { fontSize: 13, lineHeight: 19, color: colors.muted },

  guardPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 48,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: tone.white,
    transform: [{ rotate: '-4deg' }],
  },
  guardTitle: { color: colors.primaryText, marginTop: 24 },
  guardSoft: { color: tone.inkSoft },
  guardIntro: { color: tone.inkSoft, marginTop: 14, maxWidth: 640 },
  guardBody: { width: '100%', maxWidth: 880, marginTop: 40, gap: 32 },
  guardBodyWide: { flexDirection: 'row', alignItems: 'center', gap: 56 },
  guardFlow: { flex: 1 },
  guardStep: { flexDirection: 'row', gap: 16 },
  guardStepRail: { alignItems: 'center' },
  guardStepIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: tone.white, alignItems: 'center', justifyContent: 'center' },
  guardStepLine: { width: 1, flex: 1, minHeight: 16, backgroundColor: tone.inkLine, marginVertical: 6 },
  guardStepCopy: { flex: 1, gap: 4, paddingTop: 2, paddingBottom: 22 },
  guardStepTitle: { fontSize: 16, fontWeight: '700', color: colors.primaryText },
  guardStepBody: { fontSize: 14, lineHeight: 21, color: tone.inkSoft },
  preview: { flex: 1, maxWidth: 380, width: '100%', alignSelf: 'center', gap: 10 },
  previewLabel: { fontSize: 12, fontWeight: '600', color: tone.inkSoft, textAlign: 'center' },
  previewCard: { backgroundColor: tone.white, borderRadius: 28, padding: 20, gap: 10, transform: [{ rotate: '1.5deg' }] },
  previewIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.dangerSurface, alignItems: 'center', justifyContent: 'center' },
  previewTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: colors.text },
  previewBody: { fontSize: 13, lineHeight: 19, color: colors.muted },
  previewPrimary: { marginTop: 6, borderRadius: 999, backgroundColor: colors.primary, paddingVertical: 12, alignItems: 'center' },
  previewPrimaryText: { color: colors.primaryText, fontSize: 14, fontWeight: '600' },
  previewSecondary: { borderRadius: 999, backgroundColor: colors.surface, paddingVertical: 12, alignItems: 'center' },
  previewSecondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  signals: { width: '100%', maxWidth: 880, marginTop: 40, paddingTop: 28, borderTopWidth: 1, borderTopColor: tone.inkLine, gap: 16 },
  guardSignalsTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: tone.inkSoft, textTransform: 'uppercase', textAlign: 'center' },
  signalChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  signalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: tone.inkRaised,
    borderWidth: 1,
    borderColor: tone.inkLine,
    maxWidth: '100%',
  },
  signalText: { flexShrink: 1, fontSize: 13, color: colors.primaryText },

  ctaIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: tone.grey, alignItems: 'center', justifyContent: 'center', marginTop: 48 },
  ctaTitle: { marginTop: 20 },
  ctaTitleWide: { fontSize: 40, lineHeight: 46, letterSpacing: -1 },
  steps: { gap: 10, marginTop: 28, width: '100%', maxWidth: 360 },
  stepsWide: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 880 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 6,
    paddingRight: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: tone.grey,
  },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: tone.white, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 12, fontWeight: '700', color: colors.text },
  stepText: { flexShrink: 1, fontSize: 13, color: colors.text },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 28,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  ctaButtonText: { color: colors.primaryText, fontSize: 14, fontWeight: '600' },

  footer: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 64,
    marginBottom: -RADIUS / 2 - 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: tone.grey,
  },
  footerNarrow: { flexDirection: 'column' },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 12, color: colors.muted },
});
