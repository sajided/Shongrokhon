// Settings (Phase 4): language (TC-P4-L10N-01), Bangla digits (L10N-04),
// coaching nudges (TC-P4-SSC-09), a font check for conjuncts (L10N-03), and
// account deletion (TC-P4-SEC-05).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Body, Button, colors, ErrorBanner, Field, Screen, Text, Title } from '@/components/ui';
import { useSession } from '@/hooks/session';
import { useI18n } from '@/i18n/LocaleProvider';
import { useScreenView } from '@/lib/analytics';
import { ApiError, deleteMyAccount, setMyPreferences } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { isValidPin } from '@/lib/validation';

// Common Bangla conjuncts and vowel signs that clip when the font or line height is wrong.
const FONT_SAMPLE = 'ক্ষ ঞ্জ ন্ত্র স্ক্র ষ্ণ দ্ধ — কৃষ্ণ, সংরক্ষণ, ঋণ, স্বাস্থ্য, দুর্ঘটনা';

function Toggle({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Button title={value ? t('settings.on') : t('settings.off')} variant={value ? 'primary' : 'secondary'}
        onPress={() => onChange(!value)} testID={testID} />
    </View>
  );
}

export default function Settings() {
  const { profile, refreshProfile } = useSession();
  const { t, msg, locale, banglaDigits, setLanguage, setBanglaDigits } = useI18n();
  useScreenView('settings');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const setNudges = async (on: boolean) => {
    setError(null);
    try {
      await setMyPreferences({ nudgesEnabled: on });
      await refreshProfile();
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    }
  };

  const deleteAccount = async () => {
    if (!isValidPin(pin)) return setError(msg('INVALID_PIN_FORMAT'));
    setBusy(true);
    setError(null);
    try {
      const result = await deleteMyAccount(pin);
      if (result.status === 'DELETED') return signOut();
      setError(msg(result.code, { attempts_left: result.attempts_left }));
    } catch (e) {
      setError(msg(e instanceof ApiError ? e.code : null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('settings.language')}</Title>
      <View style={styles.choice}>
        <View style={{ flex: 1 }}>
          <Button title={t('settings.english')} variant={locale === 'en' ? 'primary' : 'secondary'}
            onPress={() => setLanguage('en')} testID="lang-en" />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t('settings.bangla')} variant={locale === 'bn' ? 'primary' : 'secondary'}
            onPress={() => setLanguage('bn')} testID="lang-bn" />
        </View>
      </View>
      {locale === 'bn' && (
        <Toggle label={t('settings.digits')} value={banglaDigits} onChange={setBanglaDigits} testID="toggle-digits" />
      )}
      <View style={styles.sample} testID="font-sample">
        <Text style={styles.sampleLabel}>{t('settings.fontSample')}</Text>
        <Text style={styles.sampleText}>{FONT_SAMPLE}</Text>
      </View>

      <Toggle label={t('settings.nudges')} value={profile?.nudges_enabled ?? true} onChange={setNudges} testID="toggle-nudges" />
      <Body muted>{t('settings.nudgesHelp')}</Body>

      <Title>{t('settings.delete')}</Title>
      <Body muted>{t('settings.deleteHelp')}</Body>
      {deleting ? (
        <View style={styles.danger} testID="delete-confirm">
          <Text>{t('settings.deleteConfirm')}</Text>
          <Field label={t('common.pin')} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ''))} keyboardType="number-pad"
            secureTextEntry maxLength={5} testID="delete-pin" />
          <Button title={t('settings.deleteYes')} onPress={deleteAccount} busy={busy} testID="delete-yes" />
          <Button title={t('common.cancel')} variant="secondary" onPress={() => setDeleting(false)} testID="delete-no" />
        </View>
      ) : (
        <Button title={t('settings.delete')} variant="secondary" onPress={() => setDeleting(true)} testID="delete-account" />
      )}
      <ErrorBanner message={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text },
  sample: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 4 },
  sampleLabel: { fontSize: 13, color: colors.muted },
  sampleText: { fontSize: 18, color: colors.text },
  danger: { backgroundColor: colors.dangerSurface, borderRadius: 12, padding: 12, gap: 12 },
});
