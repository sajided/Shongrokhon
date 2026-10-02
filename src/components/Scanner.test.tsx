import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Scanner } from './Scanner';

type Permission = { granted: boolean; canAskAgain: boolean; status: string; expires: string };

const mockState: {
  permission: Permission | null;
  requestPermission: jest.Mock;
  cameraProps: { onBarcodeScanned?: (r: { data: string; type: string }) => void; enableTorch?: boolean; testID?: string } | null;
} = { permission: null, requestPermission: jest.fn(), cameraProps: null };

jest.mock('expo-camera', () => {
  const { View } = jest.requireActual('react-native');
  return {
    CameraView: (props: { testID?: string }) => {
      mockState.cameraProps = props;
      return <View testID={props.testID} />;
    },
    useCameraPermissions: () => [mockState.permission, mockState.requestPermission],
    scanFromURLAsync: jest.fn(),
  };
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const granted: Permission = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' };

beforeEach(() => {
  mockState.permission = granted;
  mockState.requestPermission = jest.fn();
  mockState.cameraProps = null;
});

async function scan(data: string) {
  await act(async () => mockState.cameraProps?.onBarcodeScanned?.({ data, type: 'qr' }));
}

describe('TC-P1-QR-01: camera permission', () => {
  it('asks for permission on first open', async () => {
    mockState.permission = { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never' };
    await render(<Scanner onPayload={jest.fn()} active />);
    expect(mockState.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('shows the camera preview once granted', async () => {
    await render(<Scanner onPayload={jest.fn()} active />);
    expect(screen.getByTestId('camera')).toBeTruthy();
  });
});

describe('TC-P1-QR-02: camera permission denied', () => {
  it('explains how to re-enable the camera instead of crashing', async () => {
    mockState.permission = { granted: false, canAskAgain: false, status: 'denied', expires: 'never' };
    await render(<Scanner onPayload={jest.fn()} active />);

    expect(screen.getByTestId('camera-permission-denied')).toBeTruthy();
    expect(screen.getByText(/Allow camera access for this site in\s+your browser/)).toBeTruthy();
    expect(screen.queryByTestId('camera')).toBeNull();
    await fireEvent.press(screen.getByTestId('allow-camera'));
    expect(mockState.requestPermission).toHaveBeenCalled();
    // Image upload stays available.
    expect(screen.getByTestId('gallery')).toBeTruthy();
  });
});

describe('TC-P1-QR-11: duplicate scan debounce', () => {
  it('emits once while the camera keeps reporting the same code', async () => {
    const onPayload = jest.fn();
    await render(<Scanner onPayload={onPayload} active />);
    for (let i = 0; i < 30; i++) await scan('PAYLOAD');
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onPayload).toHaveBeenCalledWith('PAYLOAD');
  });

  it('ignores scans while inactive and re-arms when reactivated', async () => {
    const onPayload = jest.fn();
    const { rerender } = await render(<Scanner onPayload={onPayload} active />);
    await scan('FIRST');
    await rerender(<Scanner onPayload={onPayload} active={false} />);
    await scan('IGNORED');
    await rerender(<Scanner onPayload={onPayload} active />);
    await scan('SECOND');
    expect(onPayload.mock.calls).toEqual([['FIRST'], ['SECOND']]);
  });
});

describe('TC-P1-QR-09: torch toggle', () => {
  it('switches the torch on and off', async () => {
    await render(<Scanner onPayload={jest.fn()} active />);
    expect(mockState.cameraProps?.enableTorch).toBe(false);
    await fireEvent.press(screen.getByTestId('torch'));
    expect(mockState.cameraProps?.enableTorch).toBe(true);
  });
});

describe('TC-P1-QR-10: gallery import', () => {
  it('decodes a QR from a picked image the same way as a camera scan', async () => {
    const picker = jest.requireMock('expo-image-picker');
    const camera = jest.requireMock('expo-camera');
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///qr.png' }] });
    camera.scanFromURLAsync.mockResolvedValue([{ data: 'FROM_GALLERY', type: 'qr' }]);
    const onPayload = jest.fn();

    await render(<Scanner onPayload={onPayload} active />);
    await fireEvent.press(screen.getByTestId('gallery'));

    expect(camera.scanFromURLAsync).toHaveBeenCalledWith('file:///qr.png', ['qr']);
    expect(onPayload).toHaveBeenCalledWith('FROM_GALLERY');
  });

  it('tells the user when the image has no QR code', async () => {
    const picker = jest.requireMock('expo-image-picker');
    const camera = jest.requireMock('expo-camera');
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cat.png' }] });
    camera.scanFromURLAsync.mockResolvedValue([]);
    const onPayload = jest.fn();

    await render(<Scanner onPayload={onPayload} active />);
    await fireEvent.press(screen.getByTestId('gallery'));

    expect(onPayload).not.toHaveBeenCalled();
    expect(screen.getByText('No QR code found in that image.')).toBeTruthy();
  });
});
