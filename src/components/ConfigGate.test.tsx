import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ConfigGate } from './ConfigGate';

describe('TC-P1-SETUP-04: missing Supabase URL', () => {
  it('shows a clear configuration error instead of the app', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    await render(
      <ConfigGate env={{ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'secret-anon-value' }}>
        <Text>App content</Text>
      </ConfigGate>,
    );

    expect(screen.getByTestId('config-error')).toBeTruthy();
    expect(screen.getByText('Configuration error')).toBeTruthy();
    expect(screen.getByText('EXPO_PUBLIC_SUPABASE_URL')).toBeTruthy();
    expect(screen.queryByText('App content')).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('secret-anon-value');
    for (const spy of [log, error]) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain('secret-anon-value');
    }
  });

  it('renders the app when configured', async () => {
    await render(
      <ConfigGate env={{ EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k' }}>
        <Text>App content</Text>
      </ConfigGate>,
    );
    expect(screen.getByText('App content')).toBeTruthy();
  });
});
