// TC-P4-INV-03/05: SHAP drivers, the grounded evidence summary, and the
// investigate request flow with fake ML, LLM and database.
import { LlmError, type LlmProvider } from '../_shared/llm/provider';
import {
  evidenceInput, formatFeature, templateSummary, topDrivers, validateSummary, type AlertDetail, type Shap,
} from './evidence';
import { runInvestigate, type InvestigateDeps } from './orchestrator';

const SHAP: Shap = {
  model_version: 'p2-test',
  risk_score: 0.97,
  margin: 3.5,
  base_value: -4.0,
  contributions: {
    merchant_cashout_ratio_7d: 3.1, is_round_1000: 1.9, merchant_distinct_payers_30d: 1.2, amount: 0.9,
    payer_txn_count_90d: -0.4, hour_sin: 0.05, merchant_age_days: 0.75,
  },
  features: {
    merchant_cashout_ratio_7d: 0.93, is_round_1000: 1, merchant_distinct_payers_30d: 3, amount: 10000,
    payer_txn_count_90d: 41, hour_sin: 0.5, merchant_age_days: 60,
  },
};

const TXN: AlertDetail = {
  alert: { id: 'a1', kind: 'TXN', status: 'OPEN', score: 0.97, summary: { amount: 10000 } },
  score: { risk_score: 0.97, anomaly_score: 0.12, network_risk: 0, decision: 'FLAG', source: 'MODEL', model_version: 'p2-test',
           features: SHAP.features },
  transaction: { type: 'PAYMENT', amount: 10000 },
  graph: null,
};

const RING: AlertDetail = {
  alert: { id: 'r1', kind: 'RING', status: 'OPEN', score: 0.9, summary: { score: 0.9 } },
  score: null,
  transaction: null,
  graph: {
    nodes: [{ kind: 'customer' }, { kind: 'customer' }, { kind: 'customer' }, { kind: 'customer' }, { kind: 'customer' },
            { kind: 'merchant' }, { kind: 'merchant' }],
    edges: [{ count: 6, total: 18000 }, { count: 4, total: 12000 }],
  },
};

describe('TC-P4-INV-03: top SHAP drivers', () => {
  it('ranks by magnitude with direction and a readable value', () => {
    const drivers = topDrivers(SHAP, 4);
    expect(drivers.map((d) => [d.feature, d.direction, d.value])).toEqual([
      ['merchant_cashout_ratio_7d', 'raises', '93%'],
      ['is_round_1000', 'raises', 'yes'],
      ['merchant_distinct_payers_30d', 'raises', '3'],
      ['amount', 'raises', '৳10,000'],
    ]);
    expect(drivers[0].label).toBe("share of merchant's receipts cashed out in 7 days");
    expect(topDrivers(SHAP).find((d) => d.feature === 'payer_txn_count_90d')?.direction).toBe('lowers');
  });

  it('formats every kind of feature', () => {
    expect(formatFeature('amount_to_median', 22.04)).toBe('22.0x');
    expect(formatFeature('merchant_new_for_payer', 0)).toBe('no');
    expect(formatFeature('merchant_cashout_lag_min', 8.27)).toBe('8.3');
  });
});

describe('TC-P4-INV-05: grounded evidence summary', () => {
  const input = evidenceInput(TXN, SHAP);

  it('facts carry the alert figures and SHAP drivers; the input has no names or ids', () => {
    expect(input.facts).toMatchObject({ score: '97%', amount: '৳10,000', 'f1.value': '93%', 'f1.impact': '3.10' });
    expect(JSON.stringify(input)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('accepts a summary that uses placeholders and fills them', () => {
    const ok = validateSummary(JSON.stringify({
      headline: 'Payment of {{amount}} flagged at {{score}}',
      points: ['The {{f1.label}} is {{f1.value}}, which raised the risk.'],
      next_step: 'Check the merchant.',
    }), input.facts);
    expect(ok).toEqual({
      headline: 'Payment of ৳10,000 flagged at 97%',
      points: ["The share of merchant's receipts cashed out in 7 days is 93%, which raised the risk."],
      next_step: 'Check the merchant.',
    });
  });

  it.each([
    ['an invented amount', { headline: 'Payment of ৳9,000 flagged', points: ['x'], next_step: 'y' }],
    ['an unknown placeholder', { headline: '{{payer.name}} flagged', points: ['x'], next_step: 'y' }],
    ['no points', { headline: 'h', points: [], next_step: 'y' }],
    ['a wrong shape', { summary: 'h' }],
  ])('rejects %s', (_, value) => {
    expect(validateSummary(JSON.stringify(value), input.facts)).toBeNull();
  });

  it('the template always passes the grounding check (payments, rule alerts, rings)', () => {
    for (const [detail, shap] of [[TXN, SHAP], [TXN, null], [RING, null]] as const) {
      const inp = evidenceInput(detail, shap);
      expect(validateSummary(JSON.stringify(templateSummary(inp)), inp.facts)).not.toBeNull();
    }
    const ring = evidenceInput(RING, null);
    expect(validateSummary(JSON.stringify(templateSummary(ring)), ring.facts)!.headline)
      .toBe('Possible cash-out ring: 5 payers cycling money through 2 merchants');
  });
});

function deps(over: Partial<InvestigateDeps> & { detail?: AlertDetail; cached?: object | null } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const d: InvestigateDeps = {
    getAlert: async () => ({ ...(over.detail ?? TXN), explanation: (over.cached ?? null) as never }),
    explain: jest.fn(async () => SHAP),
    rpc: async <T,>(fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return null as T;
    },
    config: async () => ({ llm_mode: 'live', llm_timeout_ms: 500, mock_delay_ms: 0 }),
    liveProvider: null,
    now: () => Date.now(),
    ...over,
  };
  return { d, calls };
}

const llm = (...answers: (string | LlmError)[]): LlmProvider & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    source: 'LLM', model: 'claude-test', prompts,
    async complete(req) {
      prompts.push(req.user);
      const a = answers.shift() ?? new LlmError('UNAVAILABLE');
      if (a instanceof LlmError) throw a;
      return a;
    },
  };
};

describe('runInvestigate', () => {
  const summary = JSON.stringify({ headline: 'Flagged at {{score}}', points: ['The {{f1.label}} raised it.'], next_step: 'Review.' });

  it('SHAP from ML + grounded LLM summary, stored for the alert', async () => {
    const provider = llm(summary);
    const { d, calls } = deps({ liveProvider: provider });
    const res = await runInvestigate(d, 'a1');
    expect(d.explain).toHaveBeenCalledWith(SHAP.features, 'p2-test');
    expect(res).toMatchObject({ summary_source: 'LLM', cached: false, summary: { headline: 'Flagged at 97%' } });
    expect(res.drivers[0].feature).toBe('merchant_cashout_ratio_7d');
    expect(provider.prompts[0]).not.toContain('Fast Cash Shop');
    expect(calls.find((c) => c.fn === 'store_alert_explanation')?.args).toMatchObject({ p_alert_id: 'a1', p_summary_source: 'LLM' });
    expect(calls.find((c) => c.fn === 'log_coach_request')?.args).toMatchObject({ p_action: 'INVESTIGATE', p_user_id: null, p_outcome: 'OK' });
  });

  it('INV-05: an invented figure is rejected, retried, then the template is used', async () => {
    const bad = JSON.stringify({ headline: 'Flagged at 97%', points: ['x'], next_step: 'y' });
    const { d } = deps({ liveProvider: llm(bad, bad) });
    const res = await runInvestigate(d, 'a1');
    expect(res.summary_source).toBe('TEMPLATE');
    expect(res.summary.headline).toBe('Payment of ৳10,000 flagged with a risk score of 97%');
  });

  it('a slow LLM times out to the template', async () => {
    const hang: LlmProvider = { source: 'LLM', model: 'slow', complete: () => new Promise(() => {}) };
    const { d } = deps({ liveProvider: hang, config: async () => ({ llm_mode: 'live', llm_timeout_ms: 30, mock_delay_ms: 0 }) });
    expect((await runInvestigate(d, 'a1')).summary_source).toBe('TEMPLATE');
  });

  it('rule-scored alerts and rings get no SHAP call', async () => {
    const rules = { ...TXN, score: { ...TXN.score!, source: 'RULES', risk_score: null } };
    for (const detail of [rules, RING]) {
      const { d } = deps({ detail, config: async () => ({ llm_mode: 'mock', llm_timeout_ms: 500, mock_delay_ms: 0 }) });
      const res = await runInvestigate(d, 'x');
      expect(d.explain).not.toHaveBeenCalled();
      expect(res.shap).toBeNull();
      expect(res.summary_source).toBe('MOCK');
    }
  });

  it('cached explanations are returned without calling ML or the LLM', async () => {
    const provider = llm(summary);
    const cached = { model_version: 'p2-test', shap: SHAP, summary: { headline: 'h', points: ['p'], next_step: 'n' }, summary_source: 'LLM' };
    const { d } = deps({ liveProvider: provider, cached });
    const res = await runInvestigate(d, 'a1');
    expect(res).toMatchObject({ cached: true, summary: cached.summary });
    expect(d.explain).not.toHaveBeenCalled();
    expect(provider.prompts).toHaveLength(0);
  });

  it('INV-01: a non-analyst never gets past the alert lookup', async () => {
    const { d, calls } = deps({ getAlert: async () => { throw Object.assign(new Error('NOT_ANALYST'), { status: 403 }); } });
    await expect(runInvestigate(d, 'a1')).rejects.toThrow('NOT_ANALYST');
    expect(calls).toHaveLength(0);
  });
});
