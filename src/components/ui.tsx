import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n/LocaleProvider';

/** Loaded in src/app/_layout.tsx (useFonts). */
export const BANGLA_FONT = { regular: 'NotoSansBengali_400Regular', bold: 'NotoSansBengali_700Bold' };

/**
 * Bangla mode: Noto Sans Bengali and a taller line height, so conjuncts
 * (যুক্তাক্ষর) and vowel signs are never clipped (TC-P4-L10N-03).
 */
export function banglaStyle(style: TextProps['style']): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const weight = flat.fontWeight === 'bold' ? 700 : Number(flat.fontWeight ?? 400);
  const size = flat.fontSize ?? 14;
  return {
    fontFamily: weight >= 600 ? BANGLA_FONT.bold : BANGLA_FONT.regular,
    fontWeight: 'normal',
    lineHeight: Math.max(flat.lineHeight ?? 0, Math.round(size * 1.5)),
  };
}

/** Use instead of react-native's Text so Bangla gets the right font. */
export function Text(props: TextProps) {
  const { locale } = useI18n();
  if (locale !== 'bn') return <RNText {...props} />;
  return <RNText {...props} style={[props.style, banglaStyle(props.style)]} />;
}

export const colors = {
  primary: '#111111',
  primaryText: '#FFFFFF',
  text: '#111111',
  muted: '#6B6B6B',
  border: '#E8E8E8',
  surface: '#F2F2F2',
  background: '#FFFFFF',
  // Wallet cards on the home screen: a bright frame around a deeper body.
  red: '#C00000',
  redDeep: '#7A0000',
  blue: '#0A22B0',
  blueDeep: '#062A86',
  successSurface: '#E6F6EA',
  danger: '#B42318',
  dangerSurface: '#FDECEA',
  success: '#067647',
  warning: '#93370D',
  warningSurface: '#FEF0C7',
};

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted, testID }: { children: ReactNode; muted?: boolean; testID?: string }) {
  return <Text style={[styles.body, muted && { color: colors.muted }]} testID={testID}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  disabled,
  busy,
  variant = 'primary',
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
  testID?: string;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        inactive && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}>
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? colors.primaryText : colors.primary} />
      ) : (
        <Text style={[styles.buttonText, variant === 'secondary' && { color: colors.primary }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { locale } = useI18n();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, props.editable === false && styles.inputReadOnly, locale === 'bn' && { fontFamily: BANGLA_FONT.regular },
                props.style]}
      />
    </View>
  );
}

export function ErrorBanner({ message, testID = 'error-banner' }: { message: string | null; testID?: string }) {
  if (!message) return null;
  return (
    <View style={styles.error} accessibilityRole="alert" testID={testID}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  // Phone-width column centred in the browser window.
  content: { padding: 20, gap: 16, width: '100%', maxWidth: 480, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, color: colors.text },
  body: { fontSize: 16, lineHeight: 22, color: colors.text },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    minHeight: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: { backgroundColor: colors.surface },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: 16,
    minHeight: 54,
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputReadOnly: { color: colors.muted },
  error: { backgroundColor: colors.dangerSurface, borderRadius: 16, padding: 14 },
  errorText: { color: colors.danger, fontSize: 15 },
});
