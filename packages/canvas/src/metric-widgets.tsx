'use client';
import { ArrowUpRight } from 'lucide-react';
import { Modal, StatusBadge } from '@swiftbuild/ui';
import type { Metric } from '@swiftbuild/capacity-engine';
function formatValue(metric: Metric) {
  if (
    metric.value !== undefined &&
    (Math.abs(metric.value) >= 1e9 ||
      (Math.abs(metric.value) > 0 && Math.abs(metric.value) < 0.001))
  )
    return metric.value.toExponential(3);
  return metric.value === undefined
    ? metric.status === 'unstable'
      ? 'Unstable'
      : 'Unknown'
    : new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(
        metric.value,
      );
}
export function MetricExplanation({
  metric,
  onClose,
}: {
  metric: Metric | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!metric}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={metric?.name ?? 'Metric'}
      description="Trace this result to its formula, evidence, and limitations."
    >
      {metric && (
        <div className="metric-explanation">
          <p className="metric-large">
            {formatValue(metric)} <small>{metric.unit}</small>
          </p>
          <StatusBadge status={metric.status} />
          <h3>Formula or model</h3>
          <p className="mono">{metric.formula}</p>
          <dl>
            {Object.entries(metric.inputs).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {metric.interval && (
            <p>
              95% sampling interval: {metric.interval.lower.toFixed(3)}–
              {metric.interval.upper.toFixed(3)} across{' '}
              {metric.interval.replications} independent replications. This does
              not measure model accuracy.
            </p>
          )}
          {[
            { name: 'Assumptions', values: metric.assumptions },
            { name: 'Evidence', values: metric.sources },
            { name: 'Limitations', values: metric.limitations },
          ].map((group) => (
            <section key={group.name}>
              <h3>{group.name}</h3>
              {group.values.length ? (
                <ul>
                  {group.values.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  No additional {group.name.toLowerCase()} supplied.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
export function MetricGrid({
  metrics,
  onExplain,
  compact = false,
}: {
  metrics: Metric[];
  onExplain: (metric: Metric) => void;
  compact?: boolean;
}) {
  return (
    <div className={`metric-grid ${compact ? 'metric-grid-compact' : ''}`}>
      {metrics.map((m) => (
        <button
          key={m.id}
          className={`metric-card metric-${m.status}`}
          onClick={() => onExplain(m)}
        >
          <span>
            {m.name}
            <ArrowUpRight size={14} />
          </span>
          <strong>
            {formatValue(m)} <small>{m.unit}</small>
          </strong>
          <StatusBadge status={m.status} />
        </button>
      ))}
    </div>
  );
}
