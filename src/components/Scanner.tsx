import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Body, Button, colors, ErrorBanner, Title } from './ui';

interface ScannerProps {
  /** Called once per activation with the raw QR text. */
  onPayload: (data: string) => void;
  /** Set to false while a result is being handled; switching back to true re-arms the scanner. */
  active: boolean;
}

/**
 * Camera + image-upload QR scanner (browser) (TC-P1-QR-01/02/09/10/11).
 * A ref-based latch guarantees one payload per activation, however many frames
 * the camera reports while the code stays in view.
 */
export function Scanner({ onPayload, active }: ScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const handled = useRef(false);
  const askedOnce = useRef(false);

  // Ask on first open (TC-P1-QR-01).
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !askedOnce.current) {
      askedOnce.current = true;
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    if (active) handled.current = false;
  }, [active]);

  const emit = useCallback(
    (data: string) => {
      if (!active || handled.current) return;
      handled.current = true;
      onPayload(data);
    },
    [active, onPayload],
  );

  const pickFromGallery = useCallback(async () => {
    setGalleryError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    const codes = await scanFromURLAsync(picked.assets[0].uri, ['qr']);
    if (codes[0]?.data) emit(codes[0].data);
    else setGalleryError('No QR code found in that image.');
  }, [emit]);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    // TC-P1-QR-02: explain how to re-enable the camera, never crash. Gallery import still works.
    return (
      <View style={styles.permission} testID="camera-permission-denied">
        <Title>Camera access needed</Title>
        <Body>
          Shongrokhon uses the camera only to scan Bangla QR codes for payments. Allow camera access for this site in
          your browser (the camera or lock icon in the address bar), then try again. You can also upload a QR image.
        </Body>
        <Button title="Try again" onPress={requestPermission} testID="allow-camera" />
        <Button title="Upload QR image" variant="secondary" onPress={pickFromGallery} testID="gallery" />
        <ErrorBanner message={galleryError} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={active ? (result) => emit(result.data) : undefined}
        testID="camera"
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.frame} />
        <Text style={styles.hint}>Point the camera at a Bangla QR code</Text>
        <ErrorBanner message={galleryError} />
        <View style={styles.actions}>
          <Button
            title={torch ? 'Torch off' : 'Torch on'}
            variant="secondary"
            onPress={() => setTorch((t) => !t)}
            testID="torch"
          />
          <Button title="Upload image" variant="secondary" onPress={pickFromGallery} testID="gallery" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  permission: { flex: 1, padding: 20, gap: 16, justifyContent: 'center', backgroundColor: colors.background },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 20 },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 16 },
  hint: { color: '#FFFFFF', fontSize: 16, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, position: 'absolute', bottom: 32 },
});
