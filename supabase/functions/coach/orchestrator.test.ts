// The coach request flow with a fake database and fake LLMs:
// TC-P3-MW-05/07/08/09, TC-P3-LLM-02/04/05/07, TC-P3-MW-03 (audit payload).
import { runAsk, runInsights, validateInsights, type CoachDeps } from './orchestrator';
import { buildFacts } from './grounding';
import { LlmError, type LlmProvider, type LlmRequest } from './provider';
import { REGULATED_DISCLAIMER, UNAVAILABLE_ANSWER } from './template';
import type { CoachContext, Summary } from './types';

const summary = (over: Partial<Summary> = {}): Summary => ({
  txn_count: 30,
  income: 18000,
  spending: 17200,
  saved: 0,
  net: 800,
  cashout: { total: 14000, count: 11, share: 0.814, level: 'HIGH' },
  categories: [
    { category: 'CASH_OUT', total: 14000, count: 11, share: 0.814 },
    { category: 'FOOD', total: 3200, count: 18, share: 0.186 },
  ],
  merchants: [{ label: 'Merchant A', category: 'FOOD', total: 3200, count: 18 }],
  monthly: [],
  data_hash: 'hash-1',
  ...over,
});

function makeDeps(opts: {
  ctx?: Partial<CoachContext>;
  mode?: 'live' | 'mock' | 'off';
  live?: LlmProvider | null;
  allowed?: boolean;
  delayMs?: number;
  timeoutMs?: number;
}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let ctx: CoachContext = {
    summary: summary(),
    uncategorized: [],
    cached: null,
    config: { min_txns: 5, llm_mode: opts.mode ?? 'live', llm_timeout_ms: opts.timeoutMs ?? 1000,
              mock_delay_ms: opts.delayMs ?? 0 },
    ...opts.ctx,
  };
  const deps: CoachDeps = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      switch (fn) {
        case 'coach_rate_hit': return { allowed: opts.allowed ?? true, retry_after: 42 } as T;
        case 'coach_context': return ctx as T;
        case 'record_merchant_categories':
          ctx = { ...ctx, uncategorized: [] };
          return 1 as T;
        default: return null as T;
      }
    },
    liveProvider: opts.live === undefined ? null : opts.live,
    now: () => Date.now(),
    log: () => {},
  };
  return { deps, calls, audits: () => calls.filter((c) => c.fn === 'log_coach_request').map((c) => c.args) };
}

/** A fake live LLM that returns canned answers in order. */
function fakeLlm(...answers: (string | LlmError)[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    source: 'LLM',
    model: 'claude-test',
    requests,
    async complete(req) {
      requests.push(req);
      const a = answers.shift() ?? new LlmError('UNAVAILABLE');
      if (a instanceof LlmError) throw a;
      return a;
    },
  };
}

const cards = (body: string) => JSON.stringify({ insights: [{ kind: 'CASH', title: 'Cash-outs', body }] });

describe('runInsights', () => {
  it('TC-P3-LLM-04: returns LLM cards with SQL values filled in, and caches them', async () => {
    const llm = fakeLlm(cards('You cashed out {{cashout.count}} times ({{cashout.total}}), {{cashout.share}} of spending.'));
    const { deps, calls } = makeDeps({ live: llm });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'OK', source: 'LLM', cached: false });
    expect(res.body.insights).toEqual([{ kind: 'CASH', title: 'Cash-outs', body: 'You cashed out 11 times (৳14,000), 81% of spending.' }]);
    expect(calls.find((c) => c.fn === 'coach_cache_put')?.args).toMatchObject({ p_hash: 'hash-1', p_source: 'LLM' });
  });

  it('TC-P3-MW-03: the LLM payload has only anonymised aggregates', async () => {
    const llm = fakeLlm(cards('ok'));
    const { deps, audits } = makeDeps({ live: llm });
    await runInsights(deps, 'u1', 'MONTH');
    const sent = llm.requests[0].user;
    expect(sent).toContain('Merchant A');
    expect(sent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no ids
    expect(audits()[0]).toMatchObject({ p_action: 'INSIGHTS', p_outcome: 'OK', p_payload: { user: sent } });
  });

  it('TC-P3-LLM-04: an invented number is rejected, retried once, then the template is used', async () => {
    const llm = fakeLlm(cards('You spent ৳9,999 on food.'), cards('That is 50% of it.'));
    const { deps, calls, audits } = makeDeps({ live: llm });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(llm.requests).toHaveLength(2);
    expect(audits().map((a) => a.p_outcome)).toEqual(['INVALID', 'INVALID']);
    expect(res.body).toMatchObject({ status: 'OK', source: 'TEMPLATE' });
    expect(JSON.stringify(res.body.insights)).toContain('৳14,000');
    expect(calls.some((c) => c.fn === 'coach_cache_put')).toBe(false);
  });

  it('TC-P3-LLM-02: output that does not match the schema is rejected', async () => {
    const facts = buildFacts(summary(), 'MONTH');
    expect(validateInsights('not json', facts)).toBeNull();
    expect(validateInsights(JSON.stringify({ insights: [] }), facts)).toBeNull();
    expect(validateInsights(JSON.stringify({ insights: [{ kind: 'STOCK_TIP', title: 'x', body: 'y' }] }), facts)).toBeNull();
    expect(validateInsights(JSON.stringify({ insights: Array(5).fill({ kind: 'TIP', title: 'x', body: 'y' }) }), facts)).toBeNull();
  });

  it('TC-P3-LLM-07: provider outage falls back to the template without retrying', async () => {
    const llm = fakeLlm(new LlmError('UNAVAILABLE'));
    const { deps, audits } = makeDeps({ live: llm });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(llm.requests).toHaveLength(1);
    expect(audits()[0].p_outcome).toBe('UNAVAILABLE');
    expect(res.body).toMatchObject({ status: 'OK', source: 'TEMPLATE' });
    expect((res.body.insights as unknown[]).length).toBeGreaterThan(0);
  });

  it('TC-P3-LLM-07: no API key or mode "off" uses the template and never calls a model', async () => {
    for (const opts of [{ live: null }, { live: fakeLlm(), mode: 'off' as const }]) {
      const { deps, audits } = makeDeps(opts);
      const res = await runInsights(deps, 'u1', 'MONTH');
      expect(res.body.source).toBe('TEMPLATE');
      expect(audits()).toHaveLength(0);
    }
  });

  it('TC-P3-MW-09: a slow LLM is cut off at the timeout (no hung request)', async () => {
    const hang: LlmProvider = { source: 'LLM', model: 'slow', complete: () => new Promise(() => {}) };
    const { deps, audits } = makeDeps({ live: hang, timeoutMs: 50 });
    const t0 = Date.now();
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(audits()[0].p_outcome).toBe('TIMEOUT');
    expect(res.body.source).toBe('TEMPLATE');
  });

  it('TC-P3-MW-09: the mock delay is cut off the same way', async () => {
    const { deps, audits } = makeDeps({ mode: 'mock', delayMs: 5000, timeoutMs: 50 });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(audits()[0].p_outcome).toBe('TIMEOUT');
    expect(res.body.source).toBe('TEMPLATE');
  });

  it('TC-P3-MW-05: not enough data: no LLM call', async () => {
    const llm = fakeLlm(cards('x'));
    const { deps } = makeDeps({ live: llm, ctx: { summary: summary({ txn_count: 0 }) } });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(res.body).toMatchObject({ status: 'INSUFFICIENT_DATA', insights: [] });
    expect(llm.requests).toHaveLength(0);
  });

  it('TC-P3-MW-08: cached insights are returned without calling the LLM', async () => {
    const llm = fakeLlm(cards('x'));
    const cached = { payload: { insights: [{ kind: 'TIP' as const, title: 'c', body: 'd' }] }, source: 'LLM', created_at: 't' };
    const { deps } = makeDeps({ live: llm, ctx: { cached } });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(res.body).toMatchObject({ cached: true, insights: cached.payload.insights });
    expect(llm.requests).toHaveLength(0);
  });

  it('TC-P3-MW-07: over the rate limit -> 429 before any work', async () => {
    const { deps, calls } = makeDeps({ live: fakeLlm(), allowed: false });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(res).toEqual({ status: 429, body: { code: 'RATE_LIMITED', retry_after: 42 } });
    expect(calls.map((c) => c.fn)).toEqual(['coach_rate_hit']);
  });

  it('categorises new merchants first (refs only), then reloads the summary', async () => {
    const llm = fakeLlm(JSON.stringify({ items: [{ ref: 'm1', category: 'HEALTH' }] }), cards('ok'));
    const { deps, calls } = makeDeps({
      live: llm,
      ctx: { uncategorized: [{ wallet_id: 'w-1', name: 'Karim Pharmacy' }, { wallet_id: 'w-2', name: 'Shohoz Rides' }] },
    });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(llm.requests[0].action).toBe('CATEGORIZE');
    expect(llm.requests[0].user).not.toContain('w-1');
    expect(calls.find((c) => c.fn === 'record_merchant_categories')?.args.p_items).toEqual([
      { wallet_id: 'w-1', category: 'HEALTH', source: 'LLM', model: 'claude-test' },
      { wallet_id: 'w-2', category: 'TRANSPORT', source: 'RULE', model: null },
    ]);
    expect(calls.filter((c) => c.fn === 'coach_context')).toHaveLength(2);
    expect(res.body.categories_updated).toBe(true);
  });

  it('mock mode exercises the full pipeline deterministically', async () => {
    const { deps, calls } = makeDeps({ mode: 'mock', ctx: { uncategorized: [{ wallet_id: 'w-1', name: 'Dhaka Diner' }] } });
    const res = await runInsights(deps, 'u1', 'MONTH');
    expect(res.body).toMatchObject({ status: 'OK', source: 'MOCK' });
    expect((res.body.insights as { kind: string }[])[0].kind).toBe('CASH'); // HIGH cash dependency first
    expect(calls.find((c) => c.fn === 'record_merchant_categories')?.args.p_items).toEqual([
      { wallet_id: 'w-1', category: 'FOOD', source: 'MOCK', model: 'mock' },
    ]);
  });
});

describe('runAsk', () => {
  it('TC-P3-LLM-05: regulated advice is declined with the fixed disclaimer', async () => {
    const llm = fakeLlm(JSON.stringify({ topic: 'REGULATED_ADVICE', answer: 'Build an emergency fund first.' }));
    const { deps } = makeDeps({ live: llm });
    const res = await runAsk(deps, 'u1', 'Which stock should I buy?');
    expect(res.body).toMatchObject({ status: 'OK', topic: 'REGULATED_ADVICE', declined: true });
    expect(res.body.answer).toBe(`${REGULATED_DISCLAIMER.en} Build an emergency fund first.`);
  });

  it.each(['Which stock should I buy?', 'Should I take a loan for a phone?', 'bitcoin kinbo?', 'শেয়ার কিনব?'])(
    'TC-P3-LLM-05 (mock): "%s" is declined', async (q) => {
      const { deps } = makeDeps({ mode: 'mock' });
      const res = await runAsk(deps, 'u1', q);
      expect(res.body).toMatchObject({ declined: true });
    });

  it('TC-P3-MW-03: phone numbers in the question never reach the LLM', async () => {
    const llm = fakeLlm(JSON.stringify({ topic: 'GENERAL', answer: 'Sure.' }));
    const { deps } = makeDeps({ live: llm });
    await runAsk(deps, 'u1', 'My number is 01711000001, how do I spend less?');
    expect(llm.requests[0].user).toContain('My number is [phone], how do I spend less?');
    expect(llm.requests[0].user).not.toContain('01711000001');
  });

  it('TC-P3-LLM-04: answers may only repeat numbers from the question', async () => {
    const ok = fakeLlm(JSON.stringify({ topic: 'GENERAL', answer: 'Saving 5000 a month is possible: you kept {{net}}.' }));
    expect((await runAsk(makeDeps({ live: ok }).deps, 'u1', 'Can I save 5000 a month?')).body.answer)
      .toBe('Saving 5000 a month is possible: you kept ৳800.');
    const bad = fakeLlm(JSON.stringify({ topic: 'GENERAL', answer: 'Save 3000.' }), JSON.stringify({ topic: 'GENERAL', answer: 'Save 3000.' }));
    expect((await runAsk(makeDeps({ live: bad }).deps, 'u1', 'Can I save 5000 a month?')).body)
      .toEqual({ status: 'UNAVAILABLE', answer: UNAVAILABLE_ANSWER.en });
  });

  it('rejects empty or very long questions', async () => {
    const { deps } = makeDeps({ mode: 'mock' });
    for (const q of ['', '   ', 'x'.repeat(301), 42]) {
      expect((await runAsk(deps, 'u1', q)).status).toBe(400);
    }
  });

  it('no provider: a friendly unavailable answer', async () => {
    const { deps } = makeDeps({ mode: 'off' });
    expect((await runAsk(deps, 'u1', 'how do I save?')).body).toEqual({ status: 'UNAVAILABLE', answer: UNAVAILABLE_ANSWER.en });
  });
});

describe('TC-P4-L10N-06/07/08: the coach in Bangla', () => {
  it('Bangla insights: Bangla text, Bangla digits, same figures as English, cached per language', async () => {
    const en = makeDeps({ mode: 'mock' });
    const bn = makeDeps({ mode: 'mock' });
    const english = await runInsights(en.deps, 'u1', 'MONTH', 'en');
    const bangla = await runInsights(bn.deps, 'u1', 'MONTH', 'bn');
    const cash = (r: typeof english) => (r.body.insights as { kind: string; title: string; body: string }[]).find((i) => i.kind === 'CASH')!;
    expect(cash(bangla).body).toContain('গত ৩০ দিনে আপনি ১১ বার ক্যাশ আউট করেছেন, মোট ৳১৪,০০০');
    expect(cash(english).body).toContain('You cashed out 11 times (৳14,000)');
    const figures = (text: string) => (text.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).match(/\d[\d,]*/g) ?? []);
    expect(figures(cash(bangla).body).sort()).toEqual(figures(cash(english).body).sort()); // word order differs
    expect(bn.calls.find((c) => c.fn === 'coach_cache_put')?.args.p_period).toBe('MONTH:bn');
    expect(en.calls.find((c) => c.fn === 'coach_cache_put')?.args.p_period).toBe('MONTH');
    expect(bn.calls.find((c) => c.fn === 'coach_context')?.args.p_lang).toBe('bn');
  });

  it('Bangla prompt asks for conversational Bangla; English prompt does not', async () => {
    const llm = fakeLlm(cards('ok'));
    await runInsights(makeDeps({ live: llm }).deps, 'u1', 'MONTH', 'bn');
    expect(llm.requests[0].system).toContain('conversational Bangla');
    expect(llm.requests[0].user).toContain('"lang":"bn"');
    expect(llm.requests[0].user).toContain('৳১৪,০০০');
  });

  it('a Banglish question is answered in the selected language (mock), regulated advice declined in Bangla', async () => {
    const { deps } = makeDeps({ mode: 'mock' });
    const general = await runAsk(deps, 'u1', 'amar khoroch komabo kivabe?', 'bn');
    expect(general.body).toMatchObject({ status: 'OK', topic: 'GENERAL' });
    expect(general.body.answer).toMatch(/^গত ৩০ দিনে আপনার খরচ হয়েছে ৳১৭,২০০/);
    const loan = await runAsk(deps, 'u1', 'loan nibo?', 'bn');
    expect(loan.body.answer).toMatch(new RegExp(`^${REGULATED_DISCLAIMER.bn}`));
  });

  it('numbers the user typed are echoed in Bangla digits in Bangla mode', async () => {
    const llm = fakeLlm(JSON.stringify({ topic: 'GENERAL', answer: 'মাসে 5000 টাকা জমাতে হলে {{period}} খরচ ছিল {{spending}}।' }));
    const res = await runAsk(makeDeps({ live: llm }).deps, 'u1', 'mashe 5000 taka jomate parbo?', 'bn');
    expect(res.body.answer).toBe('মাসে ৫০০০ টাকা জমাতে হলে গত ৩০ দিনে খরচ ছিল ৳১৭,২০০।');
  });

  it('a Bangla answer may not invent numbers either (Bangla digits are rejected)', async () => {
    const llm = fakeLlm(JSON.stringify({ topic: 'GENERAL', answer: '৫০০০ টাকা জমান।' }), JSON.stringify({ topic: 'GENERAL', answer: '৫০০০ টাকা জমান।' }));
    const res = await runAsk(makeDeps({ live: llm }).deps, 'u1', 'kivabe jomabo?', 'bn');
    expect(res.body).toEqual({ status: 'UNAVAILABLE', answer: UNAVAILABLE_ANSWER.bn });
  });
});
