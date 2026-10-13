import { useEffect, useRef, useState } from 'react';
import type { ArchitectureDocument } from '@swiftbuild/architecture-schema';
import {
  AnalysisDefinitionSchema,
  AnalysisBundleSchema,
  MAX_COMPUTATION_BYTES,
  type AnalysisAdapter,
  type AnalysisJob,
  type AnalysisJobSummary,
  type AnalysisDefinition,
} from '@swiftbuild/computation-contracts';
import { Button } from '@swiftbuild/ui';

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const numbers = (text: string) =>
  text.split(',').map((v) => {
    if (!v.trim()) throw new Error('Enter comma-separated values.');
    return Number(v.trim());
  });
export function AnalysisPanel({
  adapter,
  document,
  dirty,
}: {
  adapter?: AnalysisAdapter;
  document: ArchitectureDocument;
  dirty?: boolean;
}) {
  const [jobs, setJobs] = useState<AnalysisJobSummary[]>([]);
  const [detail, setDetail] = useState<AnalysisJob | null>(null);
  const selectedJob = useRef('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'reliability' | 'capacity-sensitivity'>(
    'reliability',
  );
  const [selected, setSelected] = useState<
    Record<string, { up: string; repair: string }>
  >({});
  const [gate, setGate] = useState<'and' | 'or' | 'k-of-n'>('and');
  const [threshold, setThreshold] = useState('1');
  const [source, setSource] = useState('');
  const [context, setContext] = useState('');
  const [advanced, setAdvanced] = useState(() => {
    const pending = adapter?.pendingDefinition?.();
    return pending ? JSON.stringify(pending, null, 2) : '';
  });
  const [recordedAt] = useState(() => new Date().toISOString());
  const [scenario, setScenario] = useState(document.scenarios[0]?.id ?? '');
  const [engine, setEngine] = useState<'analytical' | 'simulation'>(
    'analytical',
  );
  const [parameter, setParameter] = useState<
    | 'requestsPerSecond'
    | 'peakMultiplier'
    | 'meanMs'
    | 'concurrency'
    | 'replicas'
  >('requestsPerSecond');
  const [target, setTarget] = useState('');
  const [values, setValues] = useState('');
  const [metric, setMetric] = useState('throughput');
  const [metricNode, setMetricNode] = useState('');
  const [rangeTarget, setRangeTarget] = useState('');
  const [rangeParameter, setRangeParameter] = useState<
    'meanUpSeconds' | 'meanRepairSeconds'
  >('meanUpSeconds');
  const operation = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!adapter) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await adapter.list();
        if (!disposed) {
          setJobs(result);
          const id = selectedJob.current || result[0]?.id;
          if (id) {
            const next = await adapter.read(id);
            if (!disposed) setDetail(next);
          }
        }
      } catch (failure) {
        if (!disposed)
          setError(
            failure instanceof Error ? failure.message : 'Cannot load jobs.',
          );
      }
      if (!disposed) timer = setTimeout(() => void refresh(), 5000);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [adapter]);
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await run();
      if (adapter) {
        const next = await adapter.list();
        setJobs(next);
        const id = selectedJob.current || next[0]?.id;
        if (id) setDetail(await adapter.read(id));
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Analysis request failed.',
      );
    } finally {
      setBusy(false);
    }
  }
  function definition(): AnalysisDefinition {
    if (advanced.trim())
      return AnalysisDefinitionSchema.parse(JSON.parse(advanced));
    if (kind === 'capacity-sensitivity')
      return AnalysisDefinitionSchema.parse({
        kind,
        scenarioId: scenario,
        engine,
        targetId: target,
        parameter,
        values: numbers(values),
        metricId: metric,
        ...(metricNode ? { nodeId: metricNode } : {}),
      });
    const provenance = {
      kind: 'assumed',
      source,
      recordedAt,
      context,
      limitations:
        'User-declared stationary model; calibration has not been independently verified.',
    };
    const components = Object.entries(selected).map(([nodeId, v]) => ({
      nodeId,
      meanUpSeconds: v.up.trim() ? Number(v.up) : NaN,
      meanRepairSeconds: v.repair.trim() ? Number(v.repair) : NaN,
      provenance,
    }));
    let root = 'analysis-success';
    while (components.some((c) => c.nodeId === root)) root += '-';
    return AnalysisDefinitionSchema.parse({
      kind,
      reliability: {
        components,
        groups: [],
        gates: [
          {
            id: root,
            kind: gate,
            inputs: components.map((c) => c.nodeId),
            ...(gate === 'k-of-n' ? { k: Number(threshold) } : {}),
          },
        ],
        root,
      },
      ranges: rangeTarget
        ? [
            {
              targetId: rangeTarget,
              parameter: rangeParameter,
              values: numbers(values),
            },
          ]
        : [],
    });
  }
  if (!adapter)
    return (
      <section className="engineering-card">
        <h2>Engineering analysis</h2>
        <p>
          Reliability and sensitivity jobs require an explicitly saved server
          project. Your existing local capacity simulations remain available in
          Capacity.
        </p>
      </section>
    );
  const traffic =
    document.scenarios.find((s) => s.id === scenario)?.trafficClasses ?? [];
  return (
    <>
      <section className="engineering-card">
        <h2>Engineering analysis</h2>
        <p>
          Runs use saved revision {adapter.revision()}.{' '}
          {dirty
            ? 'Current edits differ from that revision. Save them before submitting.'
            : 'Results remain tied to this immutable revision.'}
        </p>
        {!adapter.canSubmit && (
          <p>Viewer access allows inspecting and exporting results.</p>
        )}
        {error && <p role="alert">{error}</p>}
        <form
          className="engineering-form analysis-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await adapter.submit(definition(), operation.current);
              operation.current = crypto.randomUUID();
            });
          }}
        >
          <fieldset disabled={!adapter.canSubmit || busy}>
            <legend>Manual analysis setup</legend>
            <label>
              Analysis type
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  setAdvanced('');
                }}
              >
                <option value="reliability">
                  Availability and failure impact
                </option>
                <option value="capacity-sensitivity">
                  Capacity and latency sensitivity
                </option>
              </select>
            </label>
            {kind === 'reliability' ? (
              <>
                <p>
                  Declare operating and repair times in seconds. No component
                  measurements are inferred. Quick setup treats selected
                  components as independent. Use the advanced definition to
                  declare shared failures.
                </p>
                {document.nodes.map((node) => (
                  <div className="engineering-card" key={node.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Object.hasOwn(selected, node.id)}
                        onChange={(e) =>
                          setSelected((previous) => {
                            const next = { ...previous };
                            if (e.target.checked)
                              return {
                                ...previous,
                                [node.id]: { up: '', repair: '' },
                              };
                            else delete next[node.id];
                            return next;
                          })
                        }
                      />
                      {node.name} · {node.id}
                    </label>
                    {Object.hasOwn(selected, node.id) && (
                      <>
                        <label>
                          Mean operating time (seconds)
                          <input
                            type="number"
                            min="0"
                            step="any"
                            required={!advanced.trim()}
                            value={selected[node.id]!.up}
                            onChange={(e) =>
                              setSelected((previous) => ({
                                ...previous,
                                [node.id]: {
                                  ...previous[node.id]!,
                                  up: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label>
                          Mean repair time (seconds)
                          <input
                            type="number"
                            min="0"
                            step="any"
                            required={!advanced.trim()}
                            value={selected[node.id]!.repair}
                            onChange={(e) =>
                              setSelected((previous) => ({
                                ...previous,
                                [node.id]: {
                                  ...previous[node.id]!,
                                  repair: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                ))}
                <label>
                  Success condition
                  <select
                    value={gate}
                    onChange={(e) => setGate(e.target.value as typeof gate)}
                  >
                    <option value="and">All selected components work</option>
                    <option value="or">Any selected component works</option>
                    <option value="k-of-n">
                      At least k selected components work
                    </option>
                  </select>
                </label>
                {gate === 'k-of-n' && (
                  <label>
                    Required working components
                    <input
                      type="number"
                      min="1"
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  Evidence source
                  <input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </label>
                <label>
                  Model context and assumptions
                  <textarea
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                  />
                </label>
                <p>
                  These quick-setup values are classified as assumed. The
                  advanced definition supports measured provenance, shared
                  failure groups and nested gates.
                </p>
                <label>
                  Optional sensitivity target
                  <select
                    value={rangeTarget}
                    onChange={(e) => setRangeTarget(e.target.value)}
                  >
                    <option value="">No range</option>
                    {Object.keys(selected).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
                {rangeTarget && (
                  <>
                    <label>
                      Reliability parameter
                      <select
                        value={rangeParameter}
                        onChange={(e) =>
                          setRangeParameter(
                            e.target.value as typeof rangeParameter,
                          )
                        }
                      >
                        <option value="meanUpSeconds">
                          Mean operating time
                        </option>
                        <option value="meanRepairSeconds">
                          Mean repair time
                        </option>
                      </select>
                    </label>
                    <label>
                      Parameter values, comma separated
                      <input
                        value={values}
                        onChange={(e) => setValues(e.target.value)}
                      />
                    </label>
                  </>
                )}
              </>
            ) : (
              <>
                <label>
                  Scenario
                  <select
                    value={scenario}
                    onChange={(e) => {
                      setScenario(e.target.value);
                      setTarget('');
                    }}
                  >
                    {document.scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Existing TypeScript engine
                  <select
                    value={engine}
                    onChange={(e) => setEngine(e.target.value as typeof engine)}
                  >
                    <option value="analytical">Analytical</option>
                    <option value="simulation">Seeded simulation</option>
                  </select>
                </label>
                <label>
                  Parameter
                  <select
                    value={parameter}
                    onChange={(e) => {
                      setParameter(e.target.value as typeof parameter);
                      setTarget('');
                    }}
                  >
                    {[
                      'requestsPerSecond',
                      'peakMultiplier',
                      'meanMs',
                      'concurrency',
                      'replicas',
                    ].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Target
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">Select a target</option>
                    {(['requestsPerSecond', 'peakMultiplier'].includes(
                      parameter,
                    )
                      ? traffic.map((t) => ({ id: t.id, name: t.name }))
                      : document.performanceProfiles.map((p) => ({
                          id: p.id,
                          name: p.nodeId,
                        }))
                    ).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Parameter values, comma separated
                  <input
                    value={values}
                    onChange={(e) => setValues(e.target.value)}
                  />
                </label>
                <label>
                  Metric
                  <select
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                  >
                    {[
                      'throughput',
                      'mean-latency',
                      'p95-latency',
                      'p99-latency',
                      'utilization',
                      'queue-depth',
                    ].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Metric scope
                  <select
                    value={metricNode}
                    onChange={(e) => setMetricNode(e.target.value)}
                  >
                    <option value="">System metric</option>
                    {document.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <details>
              <summary>Advanced typed definition</summary>
              <p>
                A full definition overrides quick setup. Use it for shared
                failure groups, nested success gates, or replaying a saved
                definition.
              </p>
              <Button
                type="button"
                onClick={() => {
                  try {
                    setAdvanced(JSON.stringify(definition(), null, 2));
                  } catch {
                    setError(
                      'Complete quick setup before opening its definition.',
                    );
                  }
                }}
              >
                Copy setup into definition
              </Button>
              <label>
                Analysis definition JSON
                <textarea
                  rows={16}
                  value={advanced}
                  onChange={(e) => setAdvanced(e.target.value)}
                />
              </label>
              <Button type="button" onClick={() => setAdvanced('')}>
                Use quick setup
              </Button>
            </details>
            <Button type="submit" disabled={!!dirty}>
              Submit saved revision {adapter.revision()}
            </Button>
          </fieldset>
        </form>
        <label>
          Import historical analysis bundle
          <input
            type="file"
            accept="application/json,.json"
            disabled={!adapter.canSubmit || busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                void action(async () => {
                  if (file.size > MAX_COMPUTATION_BYTES)
                    throw new Error('Bundle exceeds 8 MiB.');
                  await adapter.import(
                    AnalysisBundleSchema.parse(JSON.parse(await file.text())),
                    crypto.randomUUID(),
                  );
                });
            }}
          />
        </label>
      </section>
      <section className="engineering-card">
        <h3>Job history</h3>
        <p>
          Latest 1,000 jobs. Reloading does not restart a computation. Imported
          results remain historical.
        </p>
        {jobs.length === 0 && <p>No engineering jobs yet.</p>}
        {jobs.map((j) => {
          const report = j.id === detail?.id ? detail.report : null;
          return (
            <article className="engineering-card" key={j.id}>
              <h4>
                {j.kind} · revision {j.revision}
              </h4>
              <p role="status">
                {j.state} ·{' '}
                {j.origin === 'imported'
                  ? 'Historical import'
                  : j.revision !== adapter.revision() || dirty
                    ? 'Historical relative to current work'
                    : 'Saved revision result'}
              </p>
              {j.error && <p>{j.error}</p>}
              {adapter.canSubmit &&
                ['queued', 'running', 'cancelling'].includes(j.state) && (
                  <Button
                    disabled={busy || j.state === 'cancelling'}
                    onClick={() => void action(() => adapter.cancel(j.id))}
                  >
                    Cancel job
                  </Button>
                )}
              <Button
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    download(
                      await adapter.export(j.id),
                      `swiftbuild-analysis-${j.id}.json`,
                    ),
                  )
                }
              >
                Export analysis bundle
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    selectedJob.current = j.id;
                    setDetail(await adapter.read(j.id));
                  })
                }
              >
                Inspect report
              </Button>
              <Button
                disabled={!adapter.canSubmit || busy}
                onClick={() => {
                  void action(async () => {
                    const full = await adapter.read(j.id);
                    setAdvanced(JSON.stringify(full.input.definition, null, 2));
                    setKind(full.input.definition.kind);
                  });
                }}
              >
                Use definition for a new run
              </Button>
              {report && (
                <>
                  <p>
                    {report.method}
                    {report.availability !== undefined
                      ? ` · availability ${report.availability}`
                      : ''}
                    {report.interval
                      ? ` · sampling interval ${report.interval.join(' to ')}`
                      : ''}
                  </p>
                  {report.coverage.map((c, i) => (
                    <p key={i}>{c}</p>
                  ))}
                  <ul>
                    {report.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                  <div className="engineering-table-wrap">
                    <table>
                      <caption>Forced-outage impact</caption>
                      <thead>
                        <tr>
                          <th>Target</th>
                          <th>Availability under outage</th>
                          <th>Availability loss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.impacts.map((i) => (
                          <tr key={i.targetId}>
                            <td>{i.targetId}</td>
                            <td>{i.availability}</td>
                            <td>{i.loss}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="engineering-table-wrap">
                    <table>
                      <caption>Sensitivity within declared ranges</caption>
                      <thead>
                        <tr>
                          <th>Target / parameter</th>
                          <th>Input</th>
                          <th>Result</th>
                          <th>Slope</th>
                          <th>Unit</th>
                          <th>Slope unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.sensitivity.map((s, i) => (
                          <tr key={i}>
                            <td>
                              {s.targetId} / {s.parameter}
                            </td>
                            <td>{s.x}</td>
                            <td>{s.value ?? 'Unknown'}</td>
                            <td>{s.slope ?? 'Unknown'}</td>
                            <td>{s.unit}</td>
                            <td>{s.slopeUnit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details>
                    <summary>Reproducibility evidence</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          digest: report.digest,
                          seed: detail!.input.seed,
                          modelVersion: report.modelVersion,
                          runtime: report.runtime,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </>
              )}
            </article>
          );
        })}
      </section>
    </>
  );
}
