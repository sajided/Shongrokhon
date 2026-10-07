import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import type { TranslationKey } from '@/i18n/en';
import { useI18n } from '@/i18n/LocaleProvider';

export interface AboutSectionProps {
  variant?: 'landing' | 'app';
}

type IconName = ComponentProps<typeof Ionicons>['name'];

interface Pillar {
  key: string;
  icon: IconName;
  title: TranslationKey;
  problem: TranslationKey;
  solution: TranslationKey;
}

const PILLARS: Pillar[] = [
  {
    key: 'p1',
    icon: 'shield-checkmark-outline',
    title: 'about.pillar1.title',
    problem: 'about.pillar1.problem',
    solution: 'about.pillar1.solution',
  },
  {
    key: 'p2',
    icon: 'trending-up-outline',
    title: 'about.pillar2.title',
    problem: 'about.pillar2.problem',
    solution: 'about.pillar2.solution',
  },
  {
    key: 'p3',
    icon: 'qr-code-outline',
    title: 'about.pillar3.title',
    problem: 'about.pillar3.problem',
    solution: 'about.pillar3.solution',
  },
  {
    key: 'p4',
    icon: 'text-outline',
    title: 'about.pillar4.title',
    problem: 'about.pillar4.problem',
    solution: 'about.pillar4.solution',
  },
];

export function AboutSection({ variant = 'app' }: AboutSectionProps) {
  const { t } = useI18n();
  const isLanding = variant === 'landing';

  return (
    <View style={[styles.container, isLanding && styles.containerLanding]} testID="about-section">
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.pill}>
          <Ionicons name="information-circle-outline" size={14} color="#111111" />
          <Text style={styles.pillText}>{t('about.title')}</Text>
        </View>
        <Text style={[styles.title, isLanding && styles.titleLanding]} accessibilityRole="header">
          {t('about.title')}
        </Text>
        <Text style={styles.subtitle}>{t('about.subtitle')}</Text>
      </View>

      {/* Mission Keynote Block */}
      <View style={styles.missionCard} testID="about-mission">
        <View style={styles.missionTopRow}>
          <View style={styles.missionBadge}>
            <Text style={styles.missionBadgeText}>{t('about.missionBadge')}</Text>
          </View>
          <Ionicons name="shield-checkmark-outline" size={18} color="#FFFFFF" />
        </View>
        <Text style={styles.missionText}>{t('about.mission')}</Text>
      </View>

      {/* Core Problem & Solution Pillars */}
      <View style={styles.pillarsList} testID="about-pillars">
        {PILLARS.map((p) => (
          <View
            key={p.key}
            style={[styles.pillarCard, isLanding && styles.pillarCardLanding]}
            testID={`about-pillar-${p.key}`}>
            <View style={styles.pillarHead}>
              <View style={styles.iconCircle}>
                <Ionicons name={p.icon} size={18} color="#FFFFFF" />
              </View>
              <Text style={styles.pillarTitle}>{t(p.title)}</Text>
            </View>

            <View style={styles.pillarBody}>
              <View style={styles.rowItem}>
                <View style={styles.tagMuted}>
                  <Text style={styles.tagMutedText}>{t('about.problemLabel')}</Text>
                </View>
                <Text style={styles.rowProblemText}>{t(p.problem)}</Text>
              </View>

              <View style={styles.rowItem}>
                <View style={styles.tagDark}>
                  <Text style={styles.tagDarkText}>{t('about.solutionLabel')}</Text>
                </View>
                <Text style={styles.rowSolutionText}>{t(p.solution)}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Trust & Security Badge */}
      <View style={styles.trustBadge} testID="about-trust">
        <View style={styles.badgeItem}>
          <Ionicons name="lock-closed-outline" size={13} color="#111111" />
          <Text style={styles.badgeTextDark}>{t('about.securityBadge')}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.badgeItem}>
          <Ionicons name="layers-outline" size={13} color="#666666" />
          <Text style={styles.badgeTextMuted}>{t('about.version')}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 12,
    gap: 16,
  },
  containerLanding: {
    paddingVertical: 20,
    paddingHorizontal: 4,
  },
  header: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#111111',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111111',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  titleLanding: {
    fontSize: 28,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    maxWidth: 520,
    lineHeight: 21,
    paddingHorizontal: 12,
  },
  missionCard: {
    backgroundColor: '#111111',
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  missionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  missionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#262626',
  },
  missionBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#E5E5E5',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  missionText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  pillarsList: {
    gap: 12,
  },
  pillarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  pillarCardLanding: {
    borderRadius: 18,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  },
  pillarHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillarTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
    letterSpacing: -0.2,
  },
  pillarBody: {
    gap: 8,
    paddingTop: 2,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  tagMuted: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginTop: 1,
  },
  tagMutedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#666666',
    letterSpacing: 0.4,
  },
  tagDark: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: '#111111',
    marginTop: 1,
  },
  tagDarkText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  rowProblemText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#666666',
  },
  rowSolutionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    color: '#111111',
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    alignSelf: 'center',
    marginTop: 4,
  },
  badgeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeTextDark: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111111',
  },
  badgeTextMuted: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666666',
  },
  divider: {
    width: 1,
    height: 12,
    backgroundColor: '#D4D4D4',
  },
});
