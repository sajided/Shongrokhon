// Admin components: SHAP chart (INV-03), network graph (INV-06), queue filters (INV-09).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { AlertRow, Driver } from './api';
import { AlertQueue } from './AlertQueue';
import { NetworkGraph } from './NetworkGraph';
import { ShapChart } from './ShapChart';

const drivers: Driver[] = [
  { feature: 'merchant_cashout_ratio_7d', label: "share of merchant's receipts cashed out in 7 days", value: '93%', contribution: 3.1, direction: 'raises' },
  { feature: 'payer_txn_count_90d', label: "payer's payments in 90 days", value: '41', contribution: -0.4, direction: 'lowers' },
];

describe('TC-P4-INV-03: SHAP chart', () => {
  it('shows each driver with value, direction and magnitude, not colour alone', () => {
    render(<ShapChart drivers={drivers} />);
    const rows = screen.getAllByTestId('shap-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("share of merchant's receipts cashed out in 7 days93%▲ +3.10");
    expect(rows[1]).toHaveTextContent('▼ −0.40');
  });

  it('explains when there is no model explanation', () => {
    render(<ShapChart drivers={[]} />);
    expect(screen.getByText(/rule-based score/)).toBeInTheDocument();
  });
});

describe('TC-P4-INV-06: network graph', () => {
  it('draws every wallet and flow, with a flow table as text', () => {
    const w = (id: string, kind: 'customer' | 'merchant', label: string) => ({ wallet_id: id, kind, label, ref: null, risk_flagged: true });
    render(<NetworkGraph graph={{
      nodes: [w('p1', 'customer', '***0003'), w('p2', 'customer', '***0004'), w('m1', 'merchant', 'Star Telecom')],
      edges: [{ from: 'p1', to: 'm1', count: 3, total: 9000 }, { from: 'p2', to: 'm1', count: 1, total: 1500 }],
    }} />);
    expect(screen.getAllByTestId('graph-node')).toHaveLength(3);
    expect(screen.getAllByTestId('graph-edge')).toHaveLength(2);
    expect(screen.getByTestId('network-graph')).toHaveAttribute('aria-label', 'Ring of 2 payers and 1 merchants with 2 money flows');
    expect(screen.getByText('৳9,000')).toBeInTheDocument();
  });
});

describe('TC-P4-INV-02/09: alert queue', () => {
  const row: AlertRow = {
    id: '11111111-1111-1111-1111-111111111111', kind: 'TXN', status: 'OPEN', created_at: '2026-10-03T08:00:00Z',
    score: 0.97, amount: 10000, flow: 'PAYMENT',
    wallets: [{ wallet_id: 'a', kind: 'customer', label: '**********0001', ref: null, risk_flagged: true },
              { wallet_id: 'b', kind: 'merchant', label: 'Quick Mart', ref: 'MPSEUDO01', risk_flagged: true }],
  };

  it('lists alerts with score, amount, wallets and status, and opens one', async () => {
    const load = vi.fn(async () => [row]);
    const onOpen = vi.fn();
    render(<AlertQueue onOpen={onOpen} load={load} />);
    const tr = await screen.findByTestId('alert-row');
    expect(tr).toHaveTextContent('0.97');
    expect(tr).toHaveTextContent('৳10,000.00');
    expect(tr).toHaveTextContent('**********0001, Quick Mart');
    expect(tr).toHaveTextContent('OPEN');
    fireEvent.click(tr);
    expect(onOpen).toHaveBeenCalledWith(row.id);
  });

  it('sends the filters to the server', async () => {
    const load = vi.fn(async () => []);
    render(<AlertQueue onOpen={() => {}} load={load} />);
    await screen.findByTestId('queue-empty');
    fireEvent.change(screen.getByTestId('filter-min'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'OPEN' } });
    fireEvent.change(screen.getByTestId('filter-wallet'), { target: { value: 'MPSEUDO01' } });
    fireEvent.click(screen.getByTestId('filter-apply'));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ minScore: 0.5, status: 'OPEN', wallet: 'MPSEUDO01' }));
  });
});
