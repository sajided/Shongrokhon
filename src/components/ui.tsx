import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = {
  primary: '#0B6E4F',
  primaryText: '#FFFFFF',
  text: '#1B1F23',
  muted: '#5F6B76',
  border: '#D5DBE1',
  surface: '#F4F6F8',
  background: '#FFFFFF',
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

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: colors.muted }]}>{children}</Text>;
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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, props.editable === false && styles.inputReadOnly, props.style]}
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
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, lineHeight: 22, color: colors.text },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    minHeight: 50,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 50,
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputReadOnly: { backgroundColor: colors.surface, color: colors.muted },
  error: { backgroundColor: colors.dangerSurface, borderRadius: 10, padding: 12 },
  errorText: { color: colors.danger, fontSize: 15 },
});
