import { useState } from 'react';
import { View } from 'react-native';

import { useI18n } from '@/i18n/LocaleProvider';
import { isValidPin } from '@/lib/validation';

import { Button, ErrorBanner, Field } from './ui';

/** TC-P1-AUTH-07: PIN entry + confirmation. The server re-validates and hashes. */
export function PinSetupForm({
  onSubmit,
  busy,
  serverError,
}: {
  onSubmit: (pin: string) => void;
  busy: boolean;
  serverError: string | null;
}) {
  const { t, msg } = useI18n();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!isValidPin(pin)) return setError(msg('INVALID_PIN_FORMAT'));
    if (pin !== confirm) return setError(msg('PIN_MISMATCH'));
    setError(null);
    onSubmit(pin);
  };

  const digitsOnly = (set: (v: string) => void) => (t: string) => set(t.replace(/\D/g, ''));

  return (
    <View style={{ gap: 16 }}>
      <Field
        label={t('pin.new')}
        testID="pin-new"
        value={pin}
        onChangeText={digitsOnly(setPin)}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={5}
      />
      <Field
        label={t('pin.confirm')}
        testID="pin-confirm"
        value={confirm}
        onChangeText={digitsOnly(setConfirm)}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={5}
      />
      <ErrorBanner message={error ?? serverError} />
      <Button title={t('pin.save')} onPress={submit} busy={busy} testID="pin-save" />
    </View>
  );
}
