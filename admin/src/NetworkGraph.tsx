// TC-P4-INV-06: a ring as a two-column graph: payers on the left, merchants on
// the right, one line per money flow, thicker for more money. The flow table
// below is the text alternative.
import type { AlertDetailData } from './api';

type Graph = NonNullable<AlertDetailData['graph']>;

const taka = (n: number) => `৳${Math.round(n).toLocaleString('en-IN')}`;

export function NetworkGraph({ graph }: { graph: Graph }) {
  const payers = graph.nodes.filter((n) => n.kind === 'customer');
  const others = graph.nodes.filter((n) => n.kind !== 'customer');
  const rowH = 44;
  const height = Math.max(payers.length, others.length) * rowH + 40;
  const pos = new Map<string, { x: number; y: number }>();
  payers.forEach((n, i) => pos.set(n.wallet_id, { x: 160, y: 30 + i * rowH }));
  others.forEach((n, i) => pos.set(n.wallet_id, { x: 520, y: 30 + i * rowH + (payers.length - others.length) * rowH / 2 }));
  const maxFlow = Math.max(...graph.edges.map((e) => Number(e.total)), 1);
  const label = (id: string) => graph.nodes.find((n) => n.wallet_id === id)?.label ?? id.slice(0, 8);

  return (
    <figure>
      <svg viewBox={`0 0 680 ${height}`} role="img" data-testid="network-graph"
        aria-label={`Ring of ${payers.length} payers and ${others.length} merchants with ${graph.edges.length} money flows`}>
        {graph.edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          return <line key={`${e.from}-${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge"
            strokeWidth={1.5 + (Number(e.total) / maxFlow) * 6} data-testid="graph-edge" />;
        })}
        {[...payers, ...others].map((n) => {
          const p = pos.get(n.wallet_id)!;
          const left = n.kind === 'customer';
          return (
            <g key={n.wallet_id} data-testid="graph-node">
              <circle cx={p.x} cy={p.y} r={9} className={`node ${n.kind}`} />
              <text x={left ? p.x - 16 : p.x + 16} y={p.y + 4} textAnchor={left ? 'end' : 'start'} className="node-label">
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <table>
          <thead><tr><th>From</th><th>To</th><th>Payments</th><th>Total</th></tr></thead>
          <tbody>
            {graph.edges.map((e) => (
              <tr key={`${e.from}-${e.to}`}>
                <td>{label(e.from)}</td><td>{label(e.to)}</td><td className="num">{e.count}</td><td className="num">{taka(Number(e.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
