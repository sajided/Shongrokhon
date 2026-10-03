// "Ask the coach" (TC-P3-LLM-05): a short question, answered by the `coach`
// Edge Function with grounded figures; regulated advice is declined.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useI18n } from '@/i18n/LocaleProvider';
import { ApiError, askCoach, type AskResponse } from '@/lib/api';

import { coachStyles } from './CoachCards';
import { Button, colors, ErrorBanner, Field, Text } from './ui';

export function AskCoach({ ask }: { ask?: (q: string, lang: 'en' | 'bn') => Promise<AskResponse> }) {
  const { t, msg, locale } = useI18n();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await (ask ?? askCoach)(question.trim(), locale));
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={coachStyles.card} testID="ask-coach">
      <Text style={coachStyles.cardTitle}>{t('ask.title')}</Text>
      <Field
        label={t('ask.label')}
        value={question}
        onChangeText={setQuestion}
        placeholder={t('ask.placeholder')}
        maxLength={300}
        testID="ask-input"
      />
      <Button title={t('ask.submit')} onPress={submit} busy={busy} disabled={!question.trim()} testID="ask-submit" />
      <ErrorBanner message={error} />
      {answer && (
        <View style={styles.answer} testID="ask-answer" accessibilityLiveRegion="polite">
          <Text style={coachStyles.body}>{answer.answer}</Text>
        </View>
      )}
      <Text style={coachStyles.muted}>{t('ask.disclaimer')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  answer: { backgroundColor: colors.background, borderRadius: 10, padding: 12 },
});
