'use client';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Play,
  Plus,
  Save,
  Square,
  AlertTriangle,
  GitCompareArrows,
  History,
  FileCheck2,
  Gauge,
  ListChecks,
  NotebookPen,
} from 'lucide-react';
import { Button, Modal, StatusBadge } from '@swiftbuild/ui';
import {
  createCheckpoint,
  compareCheckpoints,
  inputFingerprint,
  removeRequirement,
} from '@swiftbuild/architecture-model';
import {
  estimateScenario,
  analyzeTopology,
  ENGINE_VERSION,
  type CapacityReport,
  type Metric,
} from '@swiftbuild/capacity-engine';
import { evaluateArchitecture } from '@swiftbuild/rule-engine';
import { useEditor } from './editor-context';
import { MetricGrid, MetricExplanation } from './metric-widgets';
import {
  ProfileEditor,
  FlowEditor,
  ScenarioEditor,
  NumberField,
  errorText,
} from './engineering-forms';
import type { ProjectArchive } from './workspace';

export type EngineeringSection =
  'requirements' | 'capacity' | 'decisions' | 'validation' | 'history';
export const engineeringSections = [
  { id: 'requirements', label: 'Requirements', icon: ListChecks },
  { id: 'capacity', label: 'Capacity', icon: Gauge },
  { id: 'decisions', label: 'Decisions', icon: NotebookPen },
  { id: 'validation', label: 'Validation', icon: FileCheck2 },
  { id: 'history', label: 'History', icon: History },
] as const;
function RunChart({ report }: { report: CapacityReport }) {
  const rows = report.series ?? [];
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.queueDepth));
  const width = 800,
    height = 130;
  const points = rows
    .map(
      (r, i) =>
        `${(i / Math.max(1, rows.length - 1)) * width},${height - (r.queueDepth / max) * (height - 12)}`,
    )
    .join(' ');
  return (
    <section className="engineering-card">
      <h3>Queue depth over time</h3>
      <p className="field-hint">
        First seeded replication · maximum observed{' '}
        {max === 1 && rows.every((r) => !r.queueDepth) ? 0 : max} waiting
        messages
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Queue depth over time. Exact values are available in the data table below."
        className="run-chart"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <details>
        <summary>Time-series data</summary>
        <div className="engineering-table-wrap">
          <table>
            <caption className="sr-only">
              Queue depth, foreground completions and outstanding requests
            </caption>
            <thead>
              <tr>
                <th>Seconds</th>
                <th>Completed</th>
                <th>Outstanding</th>
                <th>Queue depth</th>
                <th>Dropped</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.seconds.toFixed(1)}</td>
                  <td>{r.completed}</td>
                  <td>{r.outstanding}</td>
                  <td>{r.queueDepth}</td>
                  <td>{r.dropped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
export function EngineeringWorkbench({
  section,
  onClose,
  workspace,
  setWorkspace,
  onFocus,
  onReport,
  saveStatus,
}: {
  section: EngineeringSection;
  onClose: () => void;
  workspace: ProjectArchive;
  setWorkspace: Dispatch<SetStateAction<ProjectArchive>>;
  onFocus: (ids: string[]) => void;
  onReport: (report: CapacityReport) => void;
  saveStatus: string;
}) {
  const document = useEditor((s) => s.history.present),
    apply = useEditor((s) => s.apply),
    notify = useEditor((s) => s.notify);
  const undo = useEditor((s) => s.undo),
    redo = useEditor((s) => s.redo),
    past = useEditor((s) => s.history.past.length),
    future = useEditor((s) => s.history.future.length);
  const selected = useEditor((s) => s.selected);
  const [scenarioId, setScenarioId] = useState(
    document.scenarios.find((s) => s.id === workspace.runs.at(-1)?.scenarioId)
      ?.id ??
      document.scenarios[0]?.id ??
      '',
  );
  const scenario = document.scenarios.find((s) => s.id === scenarioId);
  const [scenarioEdit, setScenarioEdit] = useState(false),
    [newScenario, setNewScenario] = useState(false);
  const [report, setReport] = useState<CapacityReport | null>(
    workspace.runs.at(-1) ?? null,
  );
  const [setupOpen, setSetupOpen] = useState(!report);
  const [explain, setExplain] = useState<Metric | null>(null);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState('');
  const [profileNode, setProfileNode] = useState(
    selected.find((id) => document.nodes.some((n) => n.id === id)) ??
      document.nodes[0]?.id ??
      '',
  );
  const [policyEdge, setPolicyEdge] = useState(document.edges[0]?.id ?? '');
  const [compare, setCompare] = useState(false);
  const [checkpointName, setCheckpointName] = useState('');
  const [compareId, setCompareId] = useState(
    workspace.checkpoints[0]?.id ?? '',
  );
  const [requirementEdit, setRequirementEdit] = useState<string | null>(null);
  const [decisionEdit, setDecisionEdit] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null),
    activeRun = useRef('');
  const fingerprint = inputFingerprint(document);
  const stale =
    !!report &&
    (report.fingerprint !== fingerprint ||
      report.origin === 'imported' ||
      report.engineVersion !== ENGINE_VERSION);
  const validation = evaluateArchitecture(document, {
    capacity: report ?? undefined,
    scenarioId,
  });
  useEffect(
    () => () => {
      worker.current?.terminate();
    },
    [],
  );
  const acceptReport = (next: CapacityReport) => {
    setSetupOpen(false);
    setReport(next);
    onReport(next);
    setWorkspace((w) => ({ ...w, runs: [...w.runs, next] }));
  };
  const run = (kind: 'estimate' | 'analytical' | 'simulation') => {
    if (!scenarioId) return;
    try {
      if (kind !== 'simulation') {
        acceptReport(
          kind === 'estimate'
            ? estimateScenario(document, scenarioId)
            : analyzeTopology(document, scenarioId),
        );
        return;
      }
      worker.current?.terminate();
      const current = new Worker(
        new URL('./simulation.worker.ts', import.meta.url),
      );
      worker.current = current;
      const runId = crypto.randomUUID();
      activeRun.current = runId;
      setBusy(true);
      setProgress('Preparing topology…');
      current.onmessage = (event) => {
        if (event.data.runId !== activeRun.current) return;
        if (event.data.type === 'progress') {
          const p = event.data.progress;
          setProgress(
            `Replication ${p.replication}/${p.replications} · ${p.events.toLocaleString()} events · ${p.seconds.toFixed(1)} simulated seconds`,
          );
        } else if (event.data.type === 'result') {
          acceptReport(event.data.result);
          setBusy(false);
          current.terminate();
          worker.current = null;
        } else if (event.data.type === 'error') {
          notify(event.data.message);
          setBusy(false);
          current.terminate();
          worker.current = null;
        }
      };
      current.onerror = (e) => {
        notify(`Simulation worker failed: ${e.message}`);
        setBusy(false);
        current.terminate();
        worker.current = null;
      };
      current.postMessage({ type: 'run', runId, document, scenarioId });
    } catch (error) {
      notify(errorText(error));
    }
  };
  const selectedCheckpoint = workspace.checkpoints.find(
    (c) => c.id === compareId,
  );
  const diff = selectedCheckpoint
    ? compareCheckpoints(selectedCheckpoint.document, document)
    : null;
  return (
    <section
      className="engineering-page"
      aria-label={`${engineeringSections.find((s) => s.id === section)!.label} workbench`}
    >
      <header className="engineering-header">
        <div>
          <Button variant="ghost" onClick={onClose}>
            <ArrowLeft size={16} />
            Canvas
          </Button>
          <span className="eyebrow">ARCHITECTURE ENGINEERING</span>
          <h1>{engineeringSections.find((s) => s.id === section)!.label}</h1>
        </div>
        <div className="card-actions">
          <Button disabled={!past} onClick={undo}>
            Undo
          </Button>
          <Button disabled={!future} onClick={redo}>
            Redo
          </Button>
          <span className="local-label" aria-live="polite">
            {saveStatus}
          </span>
        </div>
      </header>
      <div className="engineering-content">
        {section === 'requirements' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Define what the system must achieve</h2>
                <p>
                  Connect functional requirements and measurable targets to the
                  architecture.
                </p>
              </div>
              <Button
                variant="primary"
                onClick={() => setRequirementEdit('new')}
              >
                <Plus size={16} />
                Add requirement
              </Button>
            </div>
            {[...document.requirements, ...document.nonFunctionalRequirements]
              .length ? (
              <div className="engineering-list">
                {[
                  ...document.requirements,
                  ...document.nonFunctionalRequirements,
                ].map((r) => {
                  const assessment = validation.assessments.find(
                    (a) => a.requirementId === r.id,
                  );
                  return (
                    <article
                      className="engineering-card"
                      key={r.id}
                      id={`requirement-${r.id}`}
                      tabIndex={-1}
                    >
                      <div className="card-heading">
                        <h3>{r.title}</h3>
                        <StatusBadge status={assessment?.status ?? 'unknown'} />
                      </div>
                      <p>{r.description}</p>
                      {'metric' in r && (
                        <p className="mono">
                          {String(r.metric)} ·{' '}
                          {'target' in r ? String(r.target) : ''}{' '}
                          {'unit' in r ? String(r.unit) : ''}
                        </p>
                      )}
                      <p className="field-hint">{assessment?.evidence}</p>
                      <div className="card-actions">
                        <Button onClick={() => setRequirementEdit(r.id)}>
                          Edit requirement
                        </Button>
                        {r.nodeIds.length > 0 && (
                          <Button onClick={() => onFocus(r.nodeIds)}>
                            Show linked objects
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<ListChecks size={28} />}
                title="Start with a requirement"
                text="Capture a functional goal or a measurable nonfunctional target. Assessments remain unknown until evidence is recorded."
              />
            )}
          </>
        )}
        {section === 'decisions' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Keep the reasoning with the architecture</h2>
                <p>
                  Record alternatives, tradeoffs, and the requirements behind
                  each decision.
                </p>
              </div>
              <Button variant="primary" onClick={() => setDecisionEdit('new')}>
                <Plus size={16} />
                Add decision
              </Button>
            </div>
            {document.decisions.length ? (
              <div className="engineering-list">
                {document.decisions.map((d) => (
                  <article
                    className="engineering-card"
                    key={d.id}
                    id={`decision-${d.id}`}
                    tabIndex={-1}
                  >
                    <div className="card-heading">
                      <h3>{d.title}</h3>
                      <StatusBadge status={d.status} />
                    </div>
                    <p>{d.context}</p>
                    <p>
                      <strong>Rationale:</strong> {d.reason}
                    </p>
                    <p>
                      <strong>Consequences:</strong> {d.consequences}
                    </p>
                    <div className="card-actions">
                      <Button onClick={() => setDecisionEdit(d.id)}>
                        Edit decision
                      </Button>
                      {d.nodeIds.length > 0 && (
                        <Button onClick={() => onFocus(d.nodeIds)}>
                          Show linked objects
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<NotebookPen size={28} />}
                title="Make tradeoffs explicit"
                text="An architectural choice is stronger when its alternatives, rationale, and consequences can be reviewed."
              />
            )}
          </>
        )}
        {section === 'capacity' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Understand demand, contention, and headroom</h2>
                <p>
                  Scenario estimates and topology simulation share the same
                  declared workload.
                </p>
              </div>
              <Button
                onClick={() => {
                  setNewScenario(true);
                  setScenarioEdit(true);
                }}
              >
                <Plus size={16} />
                New scenario
              </Button>
            </div>
            <section className="engineering-card scenario-toolbar">
              <label>
                Active scenario
                <select
                  aria-label="Active scenario"
                  value={scenarioId}
                  disabled={busy}
                  onChange={(e) => {
                    setScenarioId(e.target.value);
                    setReport(null);
                  }}
                >
                  <option value="">Choose scenario</option>
                  {document.scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              {scenario && (
                <Button
                  onClick={() => {
                    setNewScenario(false);
                    setScenarioEdit(true);
                  }}
                >
                  Edit scenario
                </Button>
              )}
              <Button
                disabled={!scenario || busy}
                onClick={() => run('estimate')}
              >
                Estimate workload
              </Button>
              <Button
                disabled={!scenario || busy}
                onClick={() => run('analytical')}
              >
                Analyze topology
              </Button>
              <Button
                variant="primary"
                disabled={!scenario || busy}
                onClick={() => run('simulation')}
              >
                <Play size={15} />
                Run simulation
              </Button>
              {busy && (
                <Button
                  onClick={() =>
                    worker.current?.postMessage({ type: 'cancel' })
                  }
                >
                  <Square size={14} />
                  Cancel run
                </Button>
              )}
            </section>
            {scenario && (
              <div className="scenario-evidence">
                <StatusBadge
                  status={
                    document.performanceProfiles.some(
                      (p) => p.provenance.kind === 'illustrative',
                    )
                      ? 'illustrative'
                      : document.performanceProfiles.some(
                            (p) => p.provenance.kind === 'assumed',
                          )
                        ? 'assumed'
                        : 'evidence'
                  }
                />
                <p>
                  {document.performanceProfiles.some(
                    (p) => p.provenance.kind === 'illustrative',
                  )
                    ? 'Contains illustrative performance inputs. Replace them with representative measurements before production decisions.'
                    : scenario.assumptions}
                </p>
                <details>
                  <summary>Scenario assumptions</summary>
                  <p>{scenario.assumptions}</p>
                </details>
              </div>
            )}
            {busy && (
              <p role="status" className="run-progress">
                {progress}
              </p>
            )}
            <details
              className="engineering-card model-setup"
              open={setupOpen}
              onToggle={(event) => setSetupOpen(event.currentTarget.open)}
            >
              <summary>
                Model setup · {document.performanceProfiles.length} profiles ·{' '}
                {document.flowPolicies.length} flow policies
              </summary>
              <div className="capacity-setup-grid">
                <section className="engineering-card">
                  <h3>Component behavior</h3>
                  <label className="engineering-field">
                    Architecture object
                    <select
                      value={profileNode}
                      onChange={(e) => setProfileNode(e.target.value)}
                    >
                      <option value="">Choose object</option>
                      {document.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {document.nodes.find((n) => n.id === profileNode) ? (
                    <details>
                      <summary>Configure capacity profile</summary>
                      <ProfileEditor
                        key={`${profileNode}:${document.performanceProfiles.find((p) => p.nodeId === profileNode)?.provenance.recordedAt ?? 'new'}`}
                        node={document.nodes.find((n) => n.id === profileNode)!}
                      />
                    </details>
                  ) : (
                    <p className="field-hint">
                      Add an architecture object to configure its behavior.
                    </p>
                  )}
                </section>
                <section className="engineering-card">
                  <h3>Semantic flow policies</h3>
                  <label className="engineering-field">
                    Connection
                    <select
                      value={policyEdge}
                      onChange={(e) => setPolicyEdge(e.target.value)}
                    >
                      <option value="">Choose connection</option>
                      {document.edges.map((e) => (
                        <option key={e.id} value={e.id}>
                          {
                            document.nodes.find((n) => n.id === e.source.nodeId)
                              ?.name
                          }{' '}
                          →{' '}
                          {
                            document.nodes.find((n) => n.id === e.target.nodeId)
                              ?.name
                          }
                        </option>
                      ))}
                    </select>
                  </label>
                  {document.edges.some((e) => e.id === policyEdge) ? (
                    <details>
                      <summary>Configure routing and dependencies</summary>
                      <FlowEditor key={policyEdge} edgeId={policyEdge} />
                    </details>
                  ) : (
                    <p className="field-hint">
                      Connect compatible ports before declaring traffic
                      behavior.
                    </p>
                  )}
                </section>
              </div>
              <SimulationSettings />
            </details>
            {report && (
              <>
                <div className="section-intro">
                  <div>
                    <h2>
                      {report.kind === 'simulation'
                        ? 'Simulation results'
                        : report.kind === 'analytical'
                          ? 'Topology analysis'
                          : 'Workload estimates'}
                    </h2>
                    <p>
                      {report.scenarioName ??
                        document.scenarios.find(
                          (s) => s.id === report.scenarioId,
                        )?.name ??
                        report.scenarioId}{' '}
                      · Engine {report.engineVersion} ·{' '}
                      {report.replications ?? 0} simulation replications ·{' '}
                      {report.processedEvents?.toLocaleString() ?? 0} events
                    </p>
                  </div>
                  <StatusBadge status={stale ? 'stale' : report.status} />
                </div>
                {stale && (
                  <p role="status" className="engineering-warning">
                    These historical or imported results do not assess current
                    work until rerun.
                  </p>
                )}
                {report.runSettings && (
                  <details className="engineering-disclosure">
                    <summary>Execution settings and reproducibility</summary>
                    <p>
                      Seed {report.runSettings.seed};{' '}
                      {report.runSettings.replications} requested replications;{' '}
                      {report.runSettings.warmupSeconds} seconds warm-up;{' '}
                      {report.runSettings.durationSeconds} seconds observation.
                      Budget: {report.runSettings.maxEvents.toLocaleString()}{' '}
                      events and {report.runSettings.maxWallTimeMs / 1000}{' '}
                      seconds execution. The fingerprint includes these actual
                      settings.
                    </p>
                  </details>
                )}
                <MetricGrid
                  metrics={
                    report.kind === 'simulation'
                      ? report.metrics.filter((m) =>
                          [
                            'throughput',
                            'mean-latency',
                            'p95-latency',
                            'p99-latency',
                          ].includes(m.id),
                        )
                      : report.metrics
                  }
                  onExplain={setExplain}
                />
                {report.kind === 'simulation' && (
                  <details className="engineering-card">
                    <summary>Maximum latency and deadline evidence</summary>
                    <MetricGrid
                      metrics={report.metrics.filter(
                        (m) =>
                          ![
                            'throughput',
                            'mean-latency',
                            'p95-latency',
                            'p99-latency',
                          ].includes(m.id),
                      )}
                      onExplain={setExplain}
                    />
                  </details>
                )}
                {report.accounting && (
                  <section className="engineering-card">
                    <h3>Foreground work accounting · first replication</h3>
                    <dl className="accounting-grid">
                      {Object.entries(report.accounting).map(([key, count]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{count.toLocaleString()}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="field-hint">
                      Offered = completed + failed + dropped + outstanding.
                      Asynchronous background work is represented in component
                      queues, separately from foreground completion.
                    </p>
                  </section>
                )}
                <RunChart report={report} />
                {!!report.traffic?.length && (
                  <details className="engineering-card">
                    <summary>
                      Traffic-class results ({report.traffic.length})
                    </summary>
                    {report.traffic.map((result) => (
                      <section key={result.trafficClassId}>
                        <h3>
                          {document.scenarios
                            .flatMap((s) => s.trafficClasses)
                            .find((t) => t.id === result.trafficClassId)
                            ?.name ?? result.trafficClassId}
                        </h3>
                        <MetricGrid
                          metrics={result.metrics}
                          onExplain={setExplain}
                        />
                      </section>
                    ))}
                  </details>
                )}
                {report.coverage.length > 0 && (
                  <section className="engineering-card">
                    <h3>Model coverage and limitations</h3>
                    <ul>
                      {report.coverage.map((c, i) => (
                        <li key={i}>
                          {c.message}{' '}
                          {c.nodeId && (
                            <Button
                              variant="ghost"
                              onClick={() => onFocus([c.nodeId!])}
                            >
                              Inspect object
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {report.nodes.map((n) => (
                  <section className="engineering-card" key={n.nodeId}>
                    <div className="card-heading">
                      <h3>
                        {document.nodes.find((v) => v.id === n.nodeId)?.name ??
                          n.nodeId}
                      </h3>
                      {n.bottleneck && <StatusBadge status="bottleneck" />}
                      <Button
                        variant="ghost"
                        onClick={() => onFocus([n.nodeId])}
                      >
                        View on canvas
                      </Button>
                    </div>
                    <MetricGrid metrics={n.metrics} onExplain={setExplain} />
                  </section>
                ))}
              </>
            )}
            <section className="engineering-card">
              <div className="card-heading">
                <h3>Saved run comparison</h3>
                <Button onClick={() => setCompare((v) => !v)}>
                  <GitCompareArrows size={16} />
                  {compare ? 'Hide comparison' : 'Compare runs'}
                </Button>
              </div>
              <p className="field-hint">
                Historical results retain their engine version and exact input
                fingerprint.
              </p>
              {compare && (
                <div className="engineering-table-wrap">
                  <table>
                    <caption className="sr-only">Saved capacity runs</caption>
                    <thead>
                      <tr>
                        <th>Scenario</th>
                        <th>Method</th>
                        <th>State</th>
                        <th>Throughput</th>
                        <th>Mean latency</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.runs.map((r, i) => (
                        <tr key={i}>
                          <td>
                            {r.scenarioName ??
                              document.scenarios.find(
                                (s) => s.id === r.scenarioId,
                              )?.name ??
                              r.scenarioId}
                          </td>
                          <td>{r.kind}</td>
                          <td>
                            <StatusBadge
                              status={
                                r.fingerprint === fingerprint &&
                                r.engineVersion === ENGINE_VERSION &&
                                r.origin !== 'imported'
                                  ? r.status
                                  : 'stale'
                              }
                            />
                          </td>
                          <td>
                            {r.metrics
                              .find((m) => m.id === 'throughput')
                              ?.value?.toFixed(2) ?? 'Unknown'}{' '}
                            ops/s
                          </td>
                          <td>
                            {r.metrics
                              .find((m) => m.id === 'mean-latency')
                              ?.value?.toFixed(2) ?? 'Unknown'}{' '}
                            ms
                          </td>
                          <td>
                            <Button
                              onClick={() => {
                                setReport(r);
                                onReport(r);
                              }}
                            >
                              Inspect run
                            </Button>
                            <Button
                              onClick={() =>
                                setWorkspace((w) => ({
                                  ...w,
                                  runs: w.runs.filter(
                                    (_, index) => index !== i,
                                  ),
                                }))
                              }
                            >
                              Remove run
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
        {section === 'validation' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Review evidence before accepting the design</h2>
                <p>
                  Model integrity, engineering policy, and performance evidence
                  are assessed separately.
                </p>
              </div>
              <label className="engineering-toggle">
                <input
                  type="checkbox"
                  checked={document.engineering.production}
                  onChange={(e) =>
                    apply((d) => {
                      d.engineering.production = e.target.checked;
                    })
                  }
                />
                Production architecture
              </label>
            </div>
            <div className="validation-summary">
              <div>
                <CheckCircle2 size={20} />
                <strong>
                  {validation.structuralIssues.length === 0
                    ? 'Model integrity verified'
                    : `${validation.structuralIssues.length} structural errors`}
                </strong>
              </div>
              <div>
                <AlertTriangle size={20} />
                <strong>
                  {validation.findings.length} engineering findings
                </strong>
              </div>
              <StatusBadge
                status={stale ? 'stale' : (report?.status ?? 'unknown')}
              />
            </div>
            {validation.structuralIssues.map((issue, i) => (
              <p key={i} role="alert" className="field-error">
                {issue.path}: {issue.message}
              </p>
            ))}
            {validation.findings.map((finding) => (
              <article
                className="engineering-card"
                key={finding.id}
                id={`finding-${finding.id}`}
                tabIndex={-1}
              >
                <div className="card-heading">
                  <h3>{finding.title}</h3>
                  <StatusBadge status={finding.severity} />
                </div>
                <p>{finding.reason}</p>
                <p>
                  <strong>Recommendation:</strong> {finding.recommendation}
                </p>
                <div className="card-actions">
                  {finding.nodeIds.length > 0 && (
                    <Button onClick={() => onFocus(finding.nodeIds)}>
                      Focus affected objects
                    </Button>
                  )}
                  <a
                    className="guide-link"
                    href={finding.documentationReference}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Rule documentation <ArrowUpRight size={14} />
                  </a>
                  {finding.fix && (
                    <Button
                      onClick={() =>
                        apply((d) => {
                          d.nodes.find(
                            (n) => n.id === finding.fix!.nodeId,
                          )!.configuration[finding.fix!.key] =
                            finding.fix!.value;
                        })
                      }
                    >
                      Apply configured correction
                    </Button>
                  )}
                </div>
              </article>
            ))}
            <details className="engineering-card">
              <summary>
                All rule evaluations ({validation.outcomes.length})
              </summary>
              <div className="engineering-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>State</th>
                      <th>Explanation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.outcomes.map((o, i) => (
                      <tr key={i}>
                        <td>{o.ruleId}</td>
                        <td>
                          <StatusBadge status={o.status} />
                        </td>
                        <td>{o.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        {section === 'history' && (
          <>
            <div className="section-intro">
              <div>
                <h2>Preserve a reviewable architecture</h2>
                <p>
                  Named checkpoints store immutable documents. Restoring one
                  first creates a recovery checkpoint.
                </p>
              </div>
            </div>
            <form
              className="engineering-card checkpoint-create"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const checkpoint = createCheckpoint(
                    document,
                    checkpointName,
                    crypto.randomUUID(),
                    new Date().toISOString(),
                  );
                  setWorkspace((w) => ({
                    ...w,
                    checkpoints: [...w.checkpoints, checkpoint],
                  }));
                  apply((d) => {
                    d.versions.push({
                      id: checkpoint.id,
                      name: checkpoint.name,
                      createdAt: checkpoint.createdAt,
                    });
                  });
                  setCheckpointName('');
                } catch (e) {
                  notify(errorText(e));
                }
              }}
            >
              <label className="engineering-field">
                Checkpoint name
                <input
                  required
                  value={checkpointName}
                  onChange={(e) => setCheckpointName(e.target.value)}
                  placeholder="Before scaling review"
                />
              </label>
              <Button type="submit" variant="primary">
                <Save size={15} />
                Save checkpoint
              </Button>
            </form>
            {workspace.checkpoints.map((checkpoint) => (
              <article className="engineering-card" key={checkpoint.id}>
                <div className="card-heading">
                  <h3>{checkpoint.name}</h3>
                  <time>{new Date(checkpoint.createdAt).toLocaleString()}</time>
                </div>
                <p className="field-hint">
                  {checkpoint.document.nodes.length} components ·{' '}
                  {checkpoint.document.edges.length} connections · schema{' '}
                  {checkpoint.document.schemaVersion}
                </p>
                <div className="card-actions">
                  <Button onClick={() => setCompareId(checkpoint.id)}>
                    Compare with current
                  </Button>
                  <Button
                    onClick={() => {
                      const recovery = createCheckpoint(
                        document,
                        `Before restoring ${checkpoint.name}`,
                        crypto.randomUUID(),
                        new Date().toISOString(),
                      );
                      setWorkspace((w) => ({
                        ...w,
                        checkpoints: [...w.checkpoints, recovery],
                      }));
                      apply((d) => {
                        Object.assign(d, structuredClone(checkpoint.document));
                      });
                    }}
                  >
                    Restore checkpoint
                  </Button>
                </div>
              </article>
            ))}
            {diff && (
              <section className="engineering-card">
                <h3>Compared with {selectedCheckpoint!.name}</h3>
                <p>
                  Semantic changes: {diff.semanticChanged ? 'yes' : 'none'} ·
                  Layout changes: {diff.layoutChanged ? 'yes' : 'none'}
                </p>
                {diff.changes.length ? (
                  <ul>
                    {diff.changes.map((c) => (
                      <li key={`${c.collection}:${c.id}`}>
                        {c.kind} · {c.collection} · {c.id}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">
                    No changed architecture entities. Layout and project-level
                    changes are reported separately.
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
      <MetricExplanation metric={explain} onClose={() => setExplain(null)} />
      <Modal
        open={scenarioEdit}
        onOpenChange={setScenarioEdit}
        title={newScenario ? 'New workload scenario' : 'Edit workload scenario'}
        description="Declare workload assumptions, entry points, bursts, and performance targets."
      >
        <ScenarioEditor
          key={newScenario ? 'new' : scenario?.id}
          scenario={newScenario ? undefined : scenario}
          onSaved={(id) => {
            setScenarioId(id);
            setScenarioEdit(false);
          }}
        />
      </Modal>
      <Modal
        open={requirementEdit !== null}
        onOpenChange={(open) => {
          if (!open) setRequirementEdit(null);
        }}
        title="Requirement"
        description="Connect the system goal to objects and assessment evidence."
      >
        {requirementEdit !== null && (
          <RequirementEditor
            key={requirementEdit}
            id={requirementEdit}
            onClose={() => setRequirementEdit(null)}
          />
        )}
      </Modal>
      <Modal
        open={decisionEdit !== null}
        onOpenChange={(open) => {
          if (!open) setDecisionEdit(null);
        }}
        title="Architecture decision"
        description="Record context, alternatives, rationale, and consequences."
      >
        {decisionEdit !== null && (
          <DecisionEditor
            key={decisionEdit}
            id={decisionEdit}
            onClose={() => setDecisionEdit(null)}
          />
        )}
      </Modal>
    </section>
  );
}
function EmptyState({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="engineering-empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function ObjectLinks({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const nodes = useEditor((s) => s.history.present.nodes);
  return (
    <fieldset>
      <legend>Linked architecture objects</legend>
      <div className="link-options">
        {nodes.map((n) => (
          <label key={n.id}>
            <input
              type="checkbox"
              checked={value.includes(n.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, n.id]
                    : value.filter((id) => id !== n.id),
                )
              }
            />
            {n.name}
          </label>
        ))}
        {!nodes.length && (
          <p className="field-hint">
            Create canvas objects to link this record.
          </p>
        )}
      </div>
    </fieldset>
  );
}
function RequirementEditor({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const document = useEditor((s) => s.history.present),
    apply = useEditor((s) => s.apply);
  const previous = [
    ...document.requirements,
    ...document.nonFunctionalRequirements,
  ].find((r) => r.id === id);
  const assessment = document.assessments.find((a) => a.requirementId === id);
  const [title, setTitle] = useState(previous?.title ?? ''),
    [description, setDescription] = useState(previous?.description ?? ''),
    [nodeIds, setNodeIds] = useState(previous?.nodeIds ?? []);
  const [nonfunctional, setNonfunctional] = useState(
      !!previous && 'metric' in previous,
    ),
    [metric, setMetric] = useState(
      previous && 'metric' in previous ? String(previous.metric) : 'latency',
    ),
    [target, setTarget] = useState(
      previous && 'target' in previous ? String(previous.target) : '',
    ),
    [unit, setUnit] = useState(
      previous && 'unit' in previous ? String(previous.unit) : 'ms',
    );
  const [reviewed, setReviewed] = useState(
      assessment?.status === 'manually-reviewed',
    ),
    [evidence, setEvidence] = useState(assessment?.evidence ?? ''),
    [targetId, setTargetId] = useState(assessment?.targetId ?? '');
  return (
    <form
      className="engineering-form"
      onSubmit={(e) => {
        e.preventDefault();
        const requirementId = previous?.id ?? crypto.randomUUID();
        const saved = apply((d) => {
          d.requirements = d.requirements.filter((r) => r.id !== requirementId);
          d.nonFunctionalRequirements = d.nonFunctionalRequirements.filter(
            (r) => r.id !== requirementId,
          );
          const r = {
            id: requirementId,
            title: title.trim(),
            description,
            nodeIds,
          };
          if (nonfunctional)
            d.nonFunctionalRequirements.push({
              ...r,
              metric,
              target: Number(target),
              unit,
            });
          else d.requirements.push(r);
          d.assessments = d.assessments.filter(
            (a) => a.requirementId !== requirementId,
          );
          const s = d.scenarios.find((s) =>
            s.targets.some((t) => t.id === targetId),
          );
          if (reviewed || targetId)
            d.assessments.push({
              id: assessment?.id ?? crypto.randomUUID(),
              requirementId,
              status: reviewed ? 'manually-reviewed' : 'unknown',
              evidence: evidence || 'Awaiting complete scenario evidence.',
              fingerprint: reviewed ? inputFingerprint(d) : undefined,
              targetId: targetId || undefined,
              scenarioId: s?.id,
            });
        });
        if (saved) onClose();
      }}
    >
      <label className="engineering-field">
        Title
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="engineering-field">
        Description
        <textarea
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="engineering-toggle">
        <input
          type="checkbox"
          checked={nonfunctional}
          onChange={(e) => setNonfunctional(e.target.checked)}
        />
        Measurable nonfunctional requirement
      </label>
      {nonfunctional && (
        <>
          <label className="engineering-field">
            Metric
            <input
              required
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
            />
          </label>
          <NumberField
            label="Target"
            value={target}
            onChange={setTarget}
            unit={unit}
          />
          <label className="engineering-field">
            Unit
            <input
              required
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </label>
        </>
      )}
      <ObjectLinks value={nodeIds} onChange={setNodeIds} />
      <label className="engineering-field">
        Scenario target
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">No linked calculation</option>
          {document.scenarios.flatMap((s) =>
            s.targets.map((t) => (
              <option key={t.id} value={t.id}>
                {s.name}: {t.metric} {t.comparator} {t.value} {t.unit}
              </option>
            )),
          )}
        </select>
      </label>
      <label className="engineering-toggle">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        Record a manual review
      </label>
      <label className="engineering-field">
        Assessment evidence
        <textarea
          required={reviewed}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Test results, review rationale, and limitations"
        />
      </label>
      <div className="card-actions">
        <Button type="submit" variant="primary">
          Save requirement
        </Button>
        {previous && (
          <Button
            type="button"
            onClick={() => {
              const next = removeRequirement(document, id);
              apply((d) => Object.assign(d, next));
              onClose();
            }}
          >
            Delete requirement
          </Button>
        )}
      </div>
    </form>
  );
}
function DecisionEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const document = useEditor((s) => s.history.present),
    apply = useEditor((s) => s.apply);
  const previous = document.decisions.find((d) => d.id === id);
  const [title, setTitle] = useState(previous?.title ?? ''),
    [context, setContext] = useState(previous?.context ?? ''),
    [alternatives, setAlternatives] = useState(
      previous?.alternatives.join('\n') ?? '',
    ),
    [reason, setReason] = useState(previous?.reason ?? ''),
    [consequences, setConsequences] = useState(previous?.consequences ?? ''),
    [status, setStatus] = useState(previous?.status ?? 'proposed'),
    [nodeIds, setNodeIds] = useState(previous?.nodeIds ?? []),
    [requirementIds, setRequirementIds] = useState(
      previous?.requirementIds ?? [],
    ),
    [edgeIds, setEdgeIds] = useState(previous?.edgeIds ?? []),
    [versionIds, setVersionIds] = useState(previous?.versionIds ?? []);
  return (
    <form
      className="engineering-form"
      onSubmit={(e) => {
        e.preventDefault();
        const saved = apply((d) => {
          d.decisions = [
            ...d.decisions.filter((v) => v.id !== id),
            {
              id: previous?.id ?? crypto.randomUUID(),
              title,
              context,
              alternatives: alternatives.split('\n').filter((v) => v.trim()),
              reason,
              consequences,
              status,
              nodeIds,
              requirementIds,
              edgeIds,
              versionIds,
            },
          ];
        });
        if (saved) onClose();
      }}
    >
      <label className="engineering-field">
        Title
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="engineering-field">
        Decision status
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="proposed">Proposed</option>
          <option value="accepted">Accepted</option>
          <option value="superseded">Superseded</option>
        </select>
      </label>
      {[
        { label: 'Context', value: context, setter: setContext },
        {
          label: 'Alternatives (one per line)',
          value: alternatives,
          setter: setAlternatives,
        },
        { label: 'Rationale', value: reason, setter: setReason },
        { label: 'Consequences', value: consequences, setter: setConsequences },
      ].map((f) => (
        <label className="engineering-field" key={f.label}>
          {f.label}
          <textarea
            required
            value={f.value}
            onChange={(e) => f.setter(e.target.value)}
          />
        </label>
      ))}
      <ObjectLinks value={nodeIds} onChange={setNodeIds} />
      <fieldset>
        <legend>Linked requirements</legend>
        {[...document.requirements, ...document.nonFunctionalRequirements].map(
          (r) => (
            <label className="engineering-toggle" key={r.id}>
              <input
                type="checkbox"
                checked={requirementIds.includes(r.id)}
                onChange={(e) =>
                  setRequirementIds((ids) =>
                    e.target.checked
                      ? [...ids, r.id]
                      : ids.filter((id) => id !== r.id),
                  )
                }
              />
              {r.title}
            </label>
          ),
        )}
      </fieldset>
      <details>
        <summary>Connections and checkpoints</summary>
        {document.edges.map((edge) => (
          <label className="engineering-toggle" key={edge.id}>
            <input
              type="checkbox"
              checked={edgeIds.includes(edge.id)}
              onChange={(e) =>
                setEdgeIds((ids) =>
                  e.target.checked
                    ? [...ids, edge.id]
                    : ids.filter((id) => id !== edge.id),
                )
              }
            />
            {edge.label || edge.relationship}
          </label>
        ))}
        {document.versions.map((v) => (
          <label className="engineering-toggle" key={v.id}>
            <input
              type="checkbox"
              checked={versionIds.includes(v.id)}
              onChange={(e) =>
                setVersionIds((ids) =>
                  e.target.checked
                    ? [...ids, v.id]
                    : ids.filter((id) => id !== v.id),
                )
              }
            />
            {v.name}
          </label>
        ))}
      </details>
      <div className="card-actions">
        <Button type="submit" variant="primary">
          Save decision
        </Button>
        {previous && (
          <Button
            type="button"
            onClick={() => {
              apply((d) => {
                d.decisions = d.decisions.filter((v) => v.id !== id);
              });
              onClose();
            }}
          >
            Delete decision
          </Button>
        )}
      </div>
    </form>
  );
}
function SimulationSettings() {
  const settings = useEditor((s) => s.history.present.engineering.simulation),
    apply = useEditor((s) => s.apply),
    notify = useEditor((s) => s.notify);
  const [values, setValues] = useState(settings);
  return (
    <details className="engineering-card">
      <summary>Simulation window and execution budget</summary>
      <form
        className="engineering-form"
        onSubmit={(e) => {
          e.preventDefault();
          const saved = apply((d) => {
            d.engineering.simulation = values;
          });
          if (saved) notify('Simulation settings applied.');
        }}
      >
        <div className="engineering-field-grid">
          {[
            { key: 'seed', label: 'Random seed', unit: 'seed' },
            {
              key: 'replications',
              label: 'Independent replications',
              unit: 'runs',
            },
            { key: 'warmupSeconds', label: 'Warm-up window', unit: 'seconds' },
            {
              key: 'durationSeconds',
              label: 'Observation window',
              unit: 'seconds',
            },
            { key: 'maxEvents', label: 'Event budget', unit: 'events' },
            {
              key: 'maxWallTimeMs',
              label: 'Execution time budget',
              unit: 'ms',
            },
          ].map((f) => (
            <NumberField
              key={f.key}
              label={f.label}
              value={values[f.key as keyof typeof values]}
              onChange={(v) =>
                setValues((old) => ({ ...old, [f.key]: Number(v) }))
              }
              unit={f.unit}
              min={
                f.key === 'seed'
                  ? -2147483648
                  : f.key === 'warmupSeconds'
                    ? 0
                    : 1
              }
            />
          ))}
        </div>
        <Button type="submit">Apply simulation settings</Button>
      </form>
    </details>
  );
}
