// Floating AI Copilot Chatbot: persistent on-screen assistant providing
// personalized financial coaching, cash flow guidance, and wallet help.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { colors, Text } from '@/components/ui';
import type { TranslationKey } from '@/i18n/en';
import { useI18n } from '@/i18n/LocaleProvider';
import { ApiError, askCoach, type AskResponse } from '@/lib/api';

export interface FloatingCopilotProps {
  ask?: (question: string, lang: 'en' | 'bn') => Promise<AskResponse>;
  initialOpen?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'copilot';
  text: string;
  timestamp: string;
  topic?: string;
  declined?: boolean;
}

const QUICK_PROMPTS: { key: string; translationKey: TranslationKey }[] = [
  { key: 'p1', translationKey: 'copilot.prompt1' },
  { key: 'p2', translationKey: 'copilot.prompt2' },
  { key: 'p3', translationKey: 'copilot.prompt3' },
  { key: 'p4', translationKey: 'copilot.prompt4' },
];

export function FloatingCopilot({ ask, initialOpen = false }: FloatingCopilotProps) {
  const { t, msg, locale, dateTime } = useI18n();
  const { width, height } = useWindowDimensions();
  const isMobile = width < 640;

  const [isOpen, setIsOpen] = useState(initialOpen);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, busy]);

  const sendQuestion = useCallback(
    async (rawQuestion: string) => {
      const q = rawQuestion.trim();
      if (!q || busy) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: q,
        timestamp: dateTime(new Date().toISOString()),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setBusy(true);
      setError(null);

      try {
        const res = await (ask ?? askCoach)(q, locale);
        const botMsg: ChatMessage = {
          id: `bot-${Date.now()}`,
          sender: 'copilot',
          text: res.answer,
          timestamp: dateTime(new Date().toISOString()),
          topic: res.topic,
          declined: res.declined,
        };
        setMessages((prev) => [...prev, botMsg]);
      } catch (e) {
        const errCode = e instanceof ApiError ? e.code : null;
        setError(errCode ? msg(errCode) : t('copilot.errorGeneric'));
      } finally {
        setBusy(false);
      }
    },
    [ask, busy, dateTime, locale, msg, t],
  );

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setInput('');
  };

  return (
    <>
      {/* Floating Action Button (FAB) */}
      {!isOpen && (
        <Pressable
          testID="copilot-fab"
          accessibilityRole="button"
          accessibilityLabel={t('copilot.fab')}
          onPress={() => setIsOpen(true)}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
          <View style={styles.fabIconWrap}>
            <Ionicons name="sparkles" size={24} color="#FFFFFF" />
          </View>
          <View style={styles.fabBadge}>
            <Text style={styles.fabBadgeText}>{t('copilot.badge')}</Text>
          </View>
        </Pressable>
      )}

      {/* Floating Copilot Modal / Window */}
      {isOpen && (
        <View style={isMobile ? styles.mobileBackdrop : styles.desktopOverlay}>
          {isMobile && (
            <Pressable
              style={styles.backdropTouchArea}
              onPress={() => setIsOpen(false)}
              accessibilityLabel={t('copilot.close')}
            />
          )}

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[
              styles.chatContainer,
              isMobile ? styles.mobileChatContainer : [styles.desktopChatContainer, { maxHeight: height - 60 }],
            ]}
            testID="copilot-window">
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.avatarWrap}>
                  <Ionicons name="sparkles" size={16} color="#FFFFFF" />
                </View>
                <View style={styles.headerTitles}>
                  <Text style={styles.headerTitle}>{t('copilot.title')}</Text>
                  <View style={styles.statusRow}>
                    <View style={styles.statusDot} />
                    <Text style={styles.headerSubtitle}>{t('copilot.status')}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.headerActions}>
                {messages.length > 0 && (
                  <Pressable
                    testID="copilot-clear"
                    accessibilityRole="button"
                    accessibilityLabel={t('copilot.clear')}
                    onPress={clearChat}
                    style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}>
                    <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
                  </Pressable>
                )}
                <Pressable
                  testID="copilot-close"
                  accessibilityRole="button"
                  accessibilityLabel={t('copilot.close')}
                  onPress={() => setIsOpen(false)}
                  style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.6 }]}>
                  <Ionicons name="close" size={20} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>

            {/* Messages Body */}
            <ScrollView
              ref={scrollRef}
              style={styles.messagesList}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
              testID="copilot-messages">
              {/* Initial Welcome Greeting Card */}
              {messages.length === 0 && (
                <View style={styles.welcomeCard} testID="copilot-welcome">
                  <View style={styles.welcomeBadge}>
                    <Ionicons name="sparkles-outline" size={16} color="#111111" />
                    <Text style={styles.welcomeBadgeText}>{t('copilot.subtitle')}</Text>
                  </View>
                  <Text style={styles.welcomeText}>{t('copilot.welcome')}</Text>

                  <View style={styles.quickPromptsWrap}>
                    <Text style={styles.quickPromptsTitle}>{t('copilot.suggestionsTitle')}</Text>
                    <View style={styles.promptsGrid}>
                      {QUICK_PROMPTS.map((p, idx) => (
                        <Pressable
                          key={p.key}
                          testID={`copilot-prompt-${idx}`}
                          accessibilityRole="button"
                          onPress={() => sendQuestion(t(p.translationKey))}
                          style={({ pressed }) => [styles.promptPill, pressed && styles.promptPillPressed]}>
                          <Ionicons name="chatbubble-ellipses-outline" size={13} color="#111111" />
                          <Text style={styles.promptPillText}>{t(p.translationKey)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              )}

              {/* Message Bubbles */}
              {messages.map((m) => {
                const isUser = m.sender === 'user';
                return (
                  <View
                    key={m.id}
                    style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowBot]}
                    testID={`copilot-message-${m.id}`}>
                    {!isUser && (
                      <View style={styles.botMiniAvatar}>
                        <Ionicons name="sparkles" size={12} color="#FFFFFF" />
                      </View>
                    )}
                    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>
                      {!isUser && m.topic && (
                        <View style={styles.topicBadge}>
                          <Text style={styles.topicBadgeText}>{m.topic}</Text>
                        </View>
                      )}
                      <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextBot]}>
                        {m.text}
                      </Text>
                      {m.timestamp ? (
                        <Text style={[styles.timestamp, isUser ? styles.timestampUser : styles.timestampBot]}>
                          {m.timestamp}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}

              {/* Typing / Thinking Indicator */}
              {busy && (
                <View style={styles.thinkingRow} testID="copilot-loading">
                  <View style={styles.botMiniAvatar}>
                    <Ionicons name="sparkles" size={12} color="#FFFFFF" />
                  </View>
                  <View style={styles.thinkingBubble}>
                    <ActivityIndicator size="small" color="#111111" />
                    <Text style={styles.thinkingText}>{t('copilot.thinking')}</Text>
                  </View>
                </View>
              )}

              {/* Error Banner */}
              {error && (
                <View style={styles.errorBox} testID="copilot-error">
                  <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </ScrollView>

            {/* Input Bar */}
            <View style={styles.inputArea}>
              <View style={styles.inputRow}>
                <TextInput
                  testID="copilot-input"
                  style={styles.inputField}
                  placeholder={t('copilot.placeholder')}
                  placeholderTextColor="#888888"
                  value={input}
                  onChangeText={setInput}
                  onSubmitEditing={() => sendQuestion(input)}
                  returnKeyType="send"
                  multiline
                  maxLength={300}
                />
                <Pressable
                  testID="copilot-send"
                  accessibilityRole="button"
                  accessibilityLabel={t('copilot.send')}
                  disabled={!input.trim() || busy}
                  onPress={() => sendQuestion(input)}
                  style={({ pressed }) => [
                    styles.sendButton,
                    (!input.trim() || busy) && styles.sendButtonDisabled,
                    pressed && { opacity: 0.8 },
                  ]}>
                  <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
                </Pressable>
              </View>
              <Text style={styles.disclaimerText}>{t('copilot.disclaimer')}</Text>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 84,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
  },
  fabPressed: {
    transform: [{ scale: 0.95 }],
    backgroundColor: '#222222',
  },
  fabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#333333',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#444444',
  },
  fabBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  mobileBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 10000,
    justifyContent: 'flex-end',
  },
  backdropTouchArea: {
    flex: 1,
  },
  desktopOverlay: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    zIndex: 10000,
  },
  chatContainer: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  mobileChatContainer: {
    width: '100%',
    height: '82%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.15)',
  },
  desktopChatContainer: {
    width: 390,
    height: 600,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111111',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333333',
  },
  headerTitles: {
    gap: 2,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#A3A3A3',
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#222222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesList: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  messagesContent: {
    padding: 16,
    gap: 12,
  },
  welcomeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginBottom: 4,
  },
  welcomeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  welcomeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#111111',
  },
  welcomeText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#444444',
  },
  quickPromptsWrap: {
    gap: 8,
    marginTop: 4,
  },
  quickPromptsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  promptsGrid: {
    gap: 6,
  },
  promptPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  promptPillPressed: {
    backgroundColor: '#EBEBEB',
  },
  promptPillText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#111111',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowBot: {
    justifyContent: 'flex-start',
  },
  botMiniAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '82%',
  },
  bubbleUser: {
    backgroundColor: '#111111',
    borderBottomRightRadius: 4,
  },
  bubbleBot: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleTextUser: {
    color: '#FFFFFF',
  },
  bubbleTextBot: {
    color: '#111111',
  },
  topicBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F2F2F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 6,
  },
  topicBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#666666',
    letterSpacing: 0.5,
  },
  timestamp: {
    fontSize: 10,
    marginTop: 4,
  },
  timestampUser: {
    color: '#A3A3A3',
    alignSelf: 'flex-end',
  },
  timestampBot: {
    color: '#888888',
    alignSelf: 'flex-start',
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thinkingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  thinkingText: {
    fontSize: 13,
    color: '#666666',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDECEA',
    padding: 12,
    borderRadius: 10,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    flex: 1,
  },
  inputArea: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputField: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111111',
    maxHeight: 80,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#E5E5E5',
  },
  disclaimerText: {
    fontSize: 10,
    color: '#888888',
    textAlign: 'center',
  },
});
