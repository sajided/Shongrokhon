import { parseLinkFragment } from './auth';

describe('parseLinkFragment (email sign-in link)', () => {
  it('reads the session from a successful link', () => {
    expect(parseLinkFragment('#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=magiclink')).toEqual({
      access_token: 'a.b.c',
      refresh_token: 'r1',
    });
  });

  it('maps an expired or used link to LINK_EXPIRED', () => {
    expect(parseLinkFragment('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toEqual({
      error: 'LINK_EXPIRED',
    });
  });

  it('maps any other link error to LINK_INVALID', () => {
    expect(parseLinkFragment('#error=server_error&error_description=x')).toEqual({ error: 'LINK_INVALID' });
  });

  it('ignores fragments that are not from a link', () => {
    expect(parseLinkFragment('')).toBeNull();
    expect(parseLinkFragment('#section-2')).toBeNull();
    expect(parseLinkFragment('#access_token=only-half')).toBeNull();
  });
});
