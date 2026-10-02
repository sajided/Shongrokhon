// TC-P1-AUTH-01..06, 09, 10 against the running local stack.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { admin, otp, rpc, signIn, TEST_OTP, withToken } from './helpers';

describe('TC-P1-AUTH-01: register with a valid phone number', () => {
  it('creates the user, a zero-balance wallet, and a session', async () => {
    const { client, userId } = await signIn('01711000003');
    const profile = await rpc(client, 'get_my_profile');
    assert.equal(profile.error, null);
    assert.equal(profile.data.user_id, userId);
    assert.equal(profile.data.phone, '+8801711000003');
    assert.equal(Number(profile.data.balance), 0);
    assert.equal(profile.data.has_pin, false, 'new users are routed to PIN setup');

    const { count } = await admin().from('wallets').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    assert.equal(count, 1, 'exactly one wallet');
  });
});

describe('TC-P1-AUTH-02: invalid phone format (server side)', () => {
  for (const phone of ['0123', '+15551234567', 'abcdefghijk']) {
    it(`rejects ${phone} without sending an OTP`, async () => {
      const res = await otp({ action: 'send', phone });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'INVALID_PHONE');
    });
  }
});

describe('TC-P1-AUTH-03: wrong OTP', () => {
  it('returns an error, counts the attempt, and creates no session', async () => {
    const phone = '01711000004';
    assert.equal((await otp({ action: 'send', phone })).status, 200);
    const res = await otp({ action: 'verify', phone, token: '000000' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'WRONG_OTP');
    assert.equal(res.body.attempts_left, 4);
    assert.equal(res.body.session, undefined);

    const { data } = await admin().from('otp_attempts').select('failed_count').eq('phone', '8801711000004').single();
    assert.equal(data?.failed_count, 1);

    const ok = await otp({ action: 'verify', phone, token: TEST_OTP });
    assert.equal(ok.status, 200, 'correct code still works afterwards');
  });
});

describe('TC-P1-AUTH-04: OTP expiry', () => {
  it('rejects an expired code with OTP_EXPIRED and lets the user resend', async () => {
    const phone = '01711000006';
    assert.equal((await otp({ action: 'send', phone })).status, 200);
    // Move the send time past the configured expiry window.
    await admin()
      .from('otp_attempts')
      .update({ last_sent_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
      .eq('phone', '8801711000006');

    const res = await otp({ action: 'verify', phone, token: TEST_OTP });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'OTP_EXPIRED');

    // GoTrue enforces a short resend interval per number.
    await new Promise((r) => setTimeout(r, 6000));
    assert.equal((await otp({ action: 'send', phone })).status, 200, 'resend offered and works');
    assert.equal((await otp({ action: 'verify', phone, token: TEST_OTP })).status, 200);
  });
});

describe('TC-P1-AUTH-05: OTP brute-force lockout', () => {
  it('locks the number after 5 wrong codes, server-side', async () => {
    const phone = '01711000005';
    assert.equal((await otp({ action: 'send', phone })).status, 200);
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) codes.push((await otp({ action: 'verify', phone, token: '000000' })).body.code);
    assert.deepEqual(codes, ['WRONG_OTP', 'WRONG_OTP', 'WRONG_OTP', 'WRONG_OTP', 'OTP_LOCKED']);

    const correct = await otp({ action: 'verify', phone, token: TEST_OTP });
    assert.equal(correct.status, 429);
    assert.equal(correct.body.code, 'OTP_LOCKED', 'even the right code is refused while locked');

    const resend = await otp({ action: 'send', phone });
    assert.equal(resend.status, 429);
    assert.equal(resend.body.code, 'OTP_LOCKED', 'no new OTP is sent while locked');
  });
});

describe('TC-P1-AUTH-06: duplicate registration', () => {
  it('logs the existing user in instead of creating a second account', async () => {
    const { userId } = await signIn('01711000001');
    assert.equal(userId, '11111111-1111-1111-1111-000000000001');
    const { count } = await admin().from('users').select('*', { count: 'exact', head: true }).eq('phone', '+8801711000001');
    assert.equal(count, 1);
  });
});

describe('TC-P1-AUTH-09: logout', () => {
  it('revokes the session so the old tokens stop working', async () => {
    const { client, accessToken } = await signIn('01711000007');
    const refreshToken = (await client.auth.getSession()).data.session!.refresh_token;
    assert.equal((await client.auth.signOut()).error, null);
    assert.equal((await client.auth.getSession()).data.session, null, 'local session cleared');

    const old = await rpc(withToken(accessToken), 'get_my_profile');
    assert.equal(old.status, 401, 'old access token rejected');

    const { error } = await withToken(accessToken).auth.refreshSession({ refresh_token: refreshToken });
    assert.ok(error, 'old refresh token rejected');
  });
});

describe('TC-P1-AUTH-10: expired/revoked token', () => {
  it('returns 401 after the session is revoked server-side', async () => {
    const { accessToken, client } = await signIn('01711000008');
    assert.equal((await rpc(client, 'get_my_profile')).status, 200);

    const { error } = await admin().auth.admin.signOut(accessToken, 'global');
    assert.equal(error, null);

    const res = await rpc(withToken(accessToken), 'get_my_profile');
    assert.equal(res.status, 401);
    assert.equal(res.error?.code, 'PT401');
    assert.equal(res.error?.message, 'SESSION_REVOKED');
  });
});
