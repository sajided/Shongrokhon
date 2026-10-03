// TC-P4-INV-02/09: the alert queue with filters (dates, score range, status)
// and a wallet search (wallet id, merchant id, agent code, last digits of a number).
import { useCallback, useEffect, useState } from 'react';

import { listAlerts, type AlertRow, type AlertStatus, type Filters } from './api';

const STATUSES: AlertStatus[] = ['OPEN', 'ESCALATED', 'CONFIRMED', 'FALSE_POSITIVE'];
const taka = (n: number | null) => (n === null ? '—' : `৳${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);

export function AlertQueue({ onOpen, load = listAlerts }: { onOpen: (id: string) => void; load?: typeof listAlerts }) {
  const [filters, setFilters] = useState<Filters>({});
  const [draft, setDraft] = useState<Filters>({});
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((f: Filters) => {
    load(f).then((r) => { setRows(r); setError(null); }, (e: Error) => setError(e.message));
  }, [load]);

  useEffect(() => { refresh(filters); }, [filters, refresh]);

  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));
  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <section>
      <h1>Alerts</h1>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setFilters(draft); }} aria-label="Filter alerts">
        <label>From <input type="date" data-testid="filter-from" onChange={(e) => set({ from: e.target.value })} /></label>
        <label>To <input type="date" data-testid="filter-to" onChange={(e) => set({ to: e.target.value })} /></label>
        <label>Min score <input type="number" step="0.01" min="0" max="1" data-testid="filter-min"
          onChange={(e) => set({ minScore: num(e.target.value) })} /></label>
        <label>Max score <input type="number" step="0.01" min="0" max="1" data-testid="filter-max"
          onChange={(e) => set({ maxScore: num(e.target.value) })} /></label>
        <label>Status
          <select data-testid="filter-status" onChange={(e) => set({ status: (e.target.value || undefined) as AlertStatus })}>
            <option value="">Any</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label>Wallet <input placeholder="Wallet id, merchant id, agent or last digits" data-testid="filter-wallet"
          onChange={(e) => set({ wallet: e.target.value })} /></label>
        <button type="submit" data-testid="filter-apply">Apply</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {rows === null ? <p>Loading…</p> : rows.length === 0 ? <p data-testid="queue-empty">No alerts match.</p> : (
        <table className="queue">
          <thead><tr><th>Time</th><th>Type</th><th>Score</th><th>Amount</th><th>Wallets involved</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="alert-row" tabIndex={0} onClick={() => onOpen(r.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}>
                <td>{new Date(r.created_at).toLocaleString('en-GB')}</td>
                <td>{r.kind === 'RING' ? 'Ring' : r.flow ?? 'Payment'}</td>
                <td className="num">{r.score === null ? '—' : r.score.toFixed(2)}</td>
                <td className="num">{taka(r.amount)}</td>
                <td>{r.wallets.map((w) => w.label).join(', ')}</td>
                <td><span className={`status ${r.status}`}>{r.status.replace('_', ' ')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
