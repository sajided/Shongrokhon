// TC-P4-INV-03/05/06/07: one alert: scores and facts, SHAP drivers, the LLM
// evidence summary, the ring graph, and the analyst's decision (audit-logged).
import { useCallback, useEffect, useState } from 'react';

import { act, getAlert, investigate, type AlertAction, type AlertDetailData, type Investigation } from './api';
import { NetworkGraph } from './NetworkGraph';
import { ShapChart } from './ShapChart';

const taka = (n: number) => `৳${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const ACTIONS: { action: AlertAction; label: string }[] = [
  { action: 'CONFIRMED', label: 'Confirmed abuse' },
  { action: 'FALSE_POSITIVE', label: 'False positive' },
  { action: 'ESCALATED', label: 'Escalate' },
  { action: 'NOTE', label: 'Add note' },
];

export function AlertDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<AlertDetailData | null>(null);
  const [inv, setInv] = useState<Investigation | null>(null);
  const [invError, setInvError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getAlert(id).then(setData, (e: Error) => setError(e.message)), [id]);
  useEffect(() => {
    load();
    investigate(id).then(setInv, () => setInvError('Explanation unavailable right now.'));
  }, [id, load]);

  const decide = async (action: AlertAction) => {
    setBusy(true);
    setError(null);
    try {
      await act(id, action, note);
      setNote('');
      await load();
    } catch (e) {
      setError((e as Error).message === 'NOTE_REQUIRED' ? 'Write a note first.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p role="alert" className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  const { alert, score, transaction } = data;

  return (
    <article>
      <button className="link" onClick={onBack}>← All alerts</button>
      <h1>{alert.kind === 'RING' ? 'Ring alert' : `${transaction?.type ?? 'Payment'} alert`}{' '}
        <span className={`status ${alert.status}`} data-testid="detail-status">{alert.status.replace('_', ' ')}</span></h1>

      <dl className="facts">
        <dt>Raised</dt><dd>{new Date(alert.created_at).toLocaleString('en-GB')}</dd>
        {alert.score !== null && <><dt>Score</dt><dd data-testid="detail-score">{alert.score.toFixed(3)}</dd></>}
        {score && <><dt>Decision</dt><dd>{score.decision} ({score.source}, model {score.model_version})</dd></>}
        {score?.anomaly_score != null && <><dt>Anomaly</dt><dd>{score.anomaly_score.toFixed(3)}</dd></>}
        {score && <><dt>Network risk</dt><dd>{score.network_risk.toFixed(2)}</dd></>}
        {transaction && <>
          <dt>Amount</dt><dd data-testid="detail-amount">{taka(transaction.amount)}</dd>
          <dt>From</dt><dd>{transaction.payer.label}</dd>
          <dt>To</dt><dd>{transaction.payee.label}{transaction.payee.ref ? ` (${transaction.payee.ref})` : ''}</dd>
        </>}
        <dt>Wallets</dt><dd>{data.wallets.map((w) => `${w.label}${w.risk_flagged ? ' ⚑' : ''}`).join(', ')}</dd>
      </dl>

      <section aria-labelledby="summary-h">
        <h2 id="summary-h">Evidence summary</h2>
        {invError && <p className="muted">{invError}</p>}
        {!inv && !invError && <p className="muted">Preparing explanation…</p>}
        {inv && (
          <div className="summary" data-testid="evidence-summary">
            <p><strong data-testid="summary-headline">{inv.summary.headline}</strong></p>
            <ul>{inv.summary.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
            <p><em>Next step:</em> {inv.summary.next_step}</p>
            <p className="muted small">Source: {inv.summary_source === 'TEMPLATE' ? 'rule template' : inv.summary_source === 'MOCK' ? 'test model' : 'AI'}
              {' '}· figures come from the database and the model, never from the AI.</p>
          </div>
        )}
      </section>

      {alert.kind === 'TXN' && (
        <section aria-labelledby="shap-h">
          <h2 id="shap-h">Why the model scored it this way (SHAP)</h2>
          {inv ? <ShapChart drivers={inv.drivers} /> : <p className="muted">…</p>}
          {inv?.shap && <p className="muted small">Base value {inv.shap.base_value.toFixed(2)} + contributions = {inv.shap.margin.toFixed(2)} log-odds = score {inv.shap.risk_score.toFixed(3)}.</p>}
        </section>
      )}

      {data.graph && (
        <section aria-labelledby="graph-h">
          <h2 id="graph-h">Network</h2>
          <NetworkGraph graph={data.graph} />
        </section>
      )}

      <section aria-labelledby="act-h">
        <h2 id="act-h">Decision</h2>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required for 'Add note')"
          maxLength={1000} data-testid="action-note" />
        <div className="actions">
          {ACTIONS.map((a) => (
            <button key={a.action} disabled={busy} onClick={() => decide(a.action)} data-testid={`action-${a.action}`}>{a.label}</button>
          ))}
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <h3>Audit log</h3>
        {data.actions.length === 0 ? <p className="muted">No actions yet.</p> : (
          <ol className="audit" data-testid="audit-log">
            {data.actions.map((a, i) => (
              <li key={i}>{new Date(a.created_at).toLocaleString('en-GB')} · {a.analyst} · <strong>{a.action.replace('_', ' ')}</strong>
                {a.note ? ` — ${a.note}` : ''}</li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
