import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useI18n } from '@/i18n/LocaleProvider';
import { ConfigError, readConfig } from '@/lib/config';

import { colors, Text } from './ui';

type Env = Parameters<typeof readConfig>[0];

/** TC-P1-SETUP-04: render a clear configuration error instead of crashing. */
export function ConfigGate({ children, env }: { children: ReactNode; env?: Env }) {
  const { t } = useI18n();
  const error = useMemo(() => {
    try {
      readConfig(env);
      return null;
    } catch (e) {
      if (e instanceof ConfigError) return e;
      throw e;
    }
  }, [env]);

  if (!error) return <>{children}</>;
  return (
    <View style={styles.container} accessibilityRole="alert" testID="config-error">
      <Text style={styles.title}>{t('config.title')}</Text>
      <Text style={styles.body}>{t('config.body')}</Text>
      {error.missing.map((name) => (
        <Text key={name} style={styles.code}>
          {name}
        </Text>
      ))}
      <Text style={styles.body}>{t('config.fix')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.danger },
  body: { fontSize: 16, color: colors.text },
  code: { fontFamily: 'monospace', fontSize: 14, color: colors.text, backgroundColor: colors.surface, padding: 8 },
});
