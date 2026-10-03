// "Ask the coach" (TC-P3-LLM-05): a short question, answered by the `coach`
// Edge Function with grounded figures; regulated advice is declined.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, askCoach, type AskResponse } from '@/lib/api';
import { messageFor } from '@/lib/messages';

import { coachStyles } from './CoachCards';
import { Button, colors, ErrorBanner, Field } from './ui';

export function AskCoach({ ask = askCoach }: { ask?: (q: string) => Promise<AskResponse> }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await ask(question.trim()));
    } catch (e) {
      setError(messageFor(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={coachStyles.card} testID="ask-coach">
      <Text style={coachStyles.cardTitle}>Ask the coach</Text>
      <Field
        label="Your question"
        value={question}
        onChangeText={setQuestion}
        placeholder="How can I spend less on food?"
        maxLength={300}
        testID="ask-input"
      />
      <Button title="Ask" onPress={submit} busy={busy} disabled={!question.trim()} testID="ask-submit" />
      <ErrorBanner message={error} />
      {answer && (
        <View style={styles.answer} testID="ask-answer" accessibilityLiveRegion="polite">
          <Text style={coachStyles.body}>{answer.answer}</Text>
        </View>
      )}
      <Text style={coachStyles.muted}>General guidance only, not financial, investment or loan advice.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  answer: { backgroundColor: colors.background, borderRadius: 10, padding: 12 },
});
