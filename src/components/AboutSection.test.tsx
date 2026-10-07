import { render, screen } from '@testing-library/react-native';

import { AboutSection } from './AboutSection';

describe('AboutSection component', () => {
  it('renders mission keynote, 4 precise problem & solution pillars, and trust badge in monochrome style', async () => {
    await render(<AboutSection />);

    expect(screen.getByTestId('about-section')).toBeTruthy();
    expect(screen.getByTestId('about-mission')).toHaveTextContent(/eliminate mobile financial scams/i);
    expect(screen.getByTestId('about-mission')).toHaveTextContent(/Mission/i);

    // 4 Unified Problem & Solution Pillars
    expect(screen.getByTestId('about-pillars')).toBeTruthy();

    const p1 = screen.getByTestId('about-pillar-p1');
    expect(p1).toHaveTextContent(/Scam Interception/i);
    expect(p1).toHaveTextContent(/cash-out scams/i);
    expect(p1).toHaveTextContent(/machine learning/i);

    const p2 = screen.getByTestId('about-pillar-p2');
    expect(p2).toHaveTextContent(/Financial Coach/i);
    expect(p2).toHaveTextContent(/Financial blindspots/i);
    expect(p2).toHaveTextContent(/cash-flow forecasting/i);

    const p3 = screen.getByTestId('about-pillar-p3');
    expect(p3).toHaveTextContent(/Bangla QR/i);
    expect(p3).toHaveTextContent(/closed payment systems/i);
    expect(p3).toHaveTextContent(/national Bangla QR/i);

    const p4 = screen.getByTestId('about-pillar-p4');
    expect(p4).toHaveTextContent(/Built for Bangladesh/i);
    expect(p4).toHaveTextContent(/Bengali font rendering/i);
    expect(p4).toHaveTextContent(/Authentic Bengali conjunct/i);

    // Monochrome trust badges
    expect(screen.getByTestId('about-trust')).toHaveTextContent(/256-bit encryption/i);
    expect(screen.getByTestId('about-trust')).toHaveTextContent(/Version 1\.0\.0/i);
  });

  it('renders properly in landing variant mode', async () => {
    await render(<AboutSection variant="landing" />);
    expect(screen.getByTestId('about-section')).toBeTruthy();
  });
});
