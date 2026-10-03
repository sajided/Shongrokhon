// TC-P4-INV-03: what moved this alert's risk score. Diverging bars around zero:
// right/red raises the risk, left/green lowers it. Every row also prints its
// value and impact, so the chart never relies on colour alone.
import type { Driver } from './api';

export function ShapChart({ drivers }: { drivers: Driver[] }) {
  if (drivers.length === 0) return <p className="muted">No model explanation for this alert (rule-based score).</p>;
  const max = Math.max(...drivers.map((d) => Math.abs(d.contribution)), 0.01);
  return (
    <table className="shap" aria-label="Top features behind the risk score">
      <thead>
        <tr><th>Feature</th><th>Value</th><th aria-hidden>Lowers ← · → Raises</th><th>Impact (log-odds)</th></tr>
      </thead>
      <tbody>
        {drivers.map((d) => {
          const width = `${(Math.abs(d.contribution) / max) * 50}%`;
          return (
            <tr key={d.feature} data-testid="shap-row">
              <td>{d.label}</td>
              <td className="num">{d.value}</td>
              <td className="bar-cell" aria-hidden>
                <div className="axis" />
                <div className={`bar ${d.direction}`} style={d.direction === 'raises' ? { left: '50%', width } : { right: '50%', width }} />
              </td>
              <td className="num" data-testid="shap-impact">
                {d.direction === 'raises' ? '▲ +' : '▼ −'}
                {Math.abs(d.contribution).toFixed(2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
