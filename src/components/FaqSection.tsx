import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, Text } from '@/components/ui';
import type { TranslationKey } from '@/i18n/en';
import { useI18n } from '@/i18n/LocaleProvider';

export interface FaqSectionProps {
  variant?: 'landing' | 'app';
}

interface FaqItem {
  id: string;
  q: TranslationKey;
  a: TranslationKey;
}

export const FAQ_ITEMS: FaqItem[] = [
  { id: '1', q: 'faq.q1', a: 'faq.a1' },
  { id: '2', q: 'faq.q2', a: 'faq.a2' },
  { id: '3', q: 'faq.q3', a: 'faq.a3' },
  { id: '4', q: 'faq.q4', a: 'faq.a4' },
  { id: '5', q: 'faq.q5', a: 'faq.a5' },
];

export function FaqSection({ variant = 'app' }: FaqSectionProps) {
  const { t } = useI18n();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(['1']));

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isLanding = variant === 'landing';

  return (
    <View style={[styles.container, isLanding && styles.containerLanding]} testID="faq-section">
      <View style={styles.header}>
        <View style={styles.pill}>
          <Ionicons name="help-circle-outline" size={15} color={colors.text} />
          <Text style={styles.pillText}>{t('faq.title')}</Text>
        </View>
        <Text style={[styles.title, isLanding && styles.titleLanding]} accessibilityRole="header">
          {t('faq.title')}
        </Text>
        <Text style={styles.subtitle}>{t('faq.subtitle')}</Text>
      </View>

      <View style={styles.list}>
        {FAQ_ITEMS.map((item) => {
          const isOpen = openIds.has(item.id);
          return (
            <View key={item.id} style={[styles.card, isLanding && styles.cardLanding]} testID={`faq-item-${item.id}`}>
              <Pressable
                style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
                onPress={() => toggle(item.id)}
                testID={`faq-toggle-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={t(item.q)}
                accessibilityState={{ expanded: isOpen }}>
                <View style={styles.questionRow}>
                  <View style={styles.qBadge}>
                    <Text style={styles.qBadgeText}>{item.id}</Text>
                  </View>
                  <Text style={styles.questionText}>{t(item.q)}</Text>
                </View>
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.muted}
                  style={styles.chevron}
                />
              </Pressable>
              {isOpen && (
                <View style={styles.answerWrap} testID={`faq-answer-${item.id}`}>
                  <Text style={styles.answerText}>{t(item.a)}</Text>
                </View>
              )}
            </View>
          );
        })}
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
    paddingVertical: 24,
    paddingHorizontal: 4,
  },
  header: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  titleLanding: {
    fontSize: 28,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 500,
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  list: {
    gap: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardLanding: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderColor: colors.border,
    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  triggerPressed: {
    backgroundColor: colors.surface,
  },
  questionRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  qBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  questionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 21,
  },
  chevron: {
    marginLeft: 4,
  },
  answerWrap: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  answerText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },
});
