'use client';
import { useState, useEffect, useId, type FormEvent } from 'react';
import { Button } from '@swiftbuild/ui';
import {
  PerformanceProfileSchema,
  FlowPolicySchema,
  ScenarioSchema,
  type ArchitectureNode,
  type Scenario,
  type TrafficClass,
  type PerformanceProfile,
} from '@swiftbuild/architecture-schema';
import { importMeasurementsCSV } from '@swiftbuild/capacity-engine';
import { useEditor } from './editor-context';

export function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error)
    return (error as { issues: { path: unknown[]; message: string }[] }).issues
      .map((i) => `${i.path.join(' › ')}: ${i.message}`)
      .join('\n');
  return error instanceof Error
    ? error.message
    : 'Unable to save this configuration.';
}
export function NumberField({
  label,
  value,
  onChange,
  unit,
  min = 0,
  max,
  help,
  required = true,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  unit: string;
  min?: number;
  max?: number;
  help?: string;
  required?: boolean;
}) {
  const [display, setDisplay] = useState(String(value));
  const fieldId = useId();
  useEffect(() => {
    if (
      Number(display) !== Number(value) ||
      (typeof value === 'string' && value !== display)
    )
      setDisplay(String(value));
  }, [value, display]);
  return (
    <label className="engineering-field">
      <span>{label}</span>
      <span className="unit-input">
        <input
          aria-label={label}
          aria-describedby={`${fieldId}-hint`}
          type="number"
          step="any"
          required={required}
          min={min}
          max={max}
          value={display}
          onChange={(e) => {
            setDisplay(e.target.value);
            onChange(e.target.value);
          }}
        />
        <span aria-hidden="true">{unit}</span>
      </span>
      <span id={`${fieldId}-hint`} className="field-hint">
        {help ? `${help} Unit: ${unit}.` : `Value in ${unit}.`}
      </span>
    </label>
  );
}
export function ProfileEditor({ node }: { node: ArchitectureNode }) {
  const document = useEditor((s) => s.history.present),
    apply = useEditor((s) => s.apply);
  const previous = document.performanceProfiles.find(
    (p) => p.nodeId === node.id,
  );
  const definition = document.components.find(
    (c) => c.id === node.componentId,
  )!;
  const category = definition.category;
  const [model, setModel] = useState<PerformanceProfile['model']>(
    previous?.model ??
      (definition.catalog && definition.catalog.capacityModel !== 'unmodeled'
        ? definition.catalog.capacityModel
        : undefined) ??
      (category === 'database'
        ? 'database'
        : category === 'cache'
          ? 'cache'
          : category === 'messaging'
            ? 'queue'
            : 'service'),
  );
  const [mean, setMean] = useState(
    previous?.serviceTime && previous.serviceTime.kind !== 'empirical'
      ? String(previous.serviceTime.meanMs)
      : '',
  );
  const [distribution, setDistribution] = useState(
    previous?.serviceTime?.kind ?? 'constant',
  );
  const [concurrency, setConcurrency] = useState(
    String(previous?.concurrency ?? 1),
  );
  const [replicas, setReplicas] = useState(
    String(previous?.replicas ?? node.configuration.replicas ?? 1),
  );
  const [scaling, setScaling] = useState<PerformanceProfile['scaling']>(
    previous?.scaling ?? 'none',
  );
  const [target, setTarget] = useState(
    String((previous?.targetUtilization ?? 0.7) * 100),
  );
  const [hit, setHit] = useState(
    previous?.cacheHitRatio === undefined
      ? ''
      : String(previous.cacheHitRatio * 100),
  );
  const [buffer, setBuffer] = useState(
    String(previous?.queue?.bufferMessages ?? ''),
  );
  const [retention, setRetention] = useState(
    String(previous?.queue?.retentionSeconds ?? ''),
  );
  const [acknowledgement, setAcknowledgement] = useState<
    'on-completion' | 'on-admission'
  >(previous?.queue?.acknowledgement ?? 'on-completion');
  const [source, setSource] = useState(previous?.provenance.source ?? '');
  const [recordedAt, setRecordedAt] = useState(
    previous?.provenance.recordedAt ?? new Date().toISOString(),
  );
  const [context, setContext] = useState(previous?.provenance.context ?? '');
  const [kind, setKind] = useState<PerformanceProfile['provenance']['kind']>(
    previous?.provenance.kind ?? 'assumed',
  );
  const [limitations, setLimitations] = useState(
    previous?.provenance.limitations ?? '',
  );
  const [imported, setImported] = useState<PerformanceProfile | null>(null);
  const [error, setError] = useState('');
  const [maxReplicas, setMaxReplicas] = useState(
    String(previous?.maxReplicas ?? 100),
  );
  const [readReplicas, setReadReplicas] = useState(
    String(previous?.readReplicas ?? node.configuration.readReplicas ?? 0),
  );
  const [cpuDemand, setCpuDemand] = useState(
    String(previous?.cpuSecondsPerOperation ?? ''),
  );
  const [timeScope, setTimeScope] = useState(
    previous?.serviceTimeScope ?? 'total',
  );
  const [cores, setCores] = useState(
    String(previous?.cpuCores ?? node.configuration.cpuCores ?? ''),
  );
  const [memoryDemand, setMemoryDemand] = useState(
    String(previous?.memoryBytesPerOperation ?? ''),
  );
  const [memory, setMemory] = useState(
    String(
      previous?.memoryBytes ??
        (typeof node.configuration.memoryGB === 'number'
          ? node.configuration.memoryGB * 1e9
          : ''),
    ),
  );
  const [storage, setStorage] = useState(
    String(
      previous?.storageBytes ??
        (typeof node.configuration.storageGB === 'number'
          ? node.configuration.storageGB * 1e9
          : ''),
    ),
  );
  const build = () =>
    PerformanceProfileSchema.parse({
      ...previous,
      ...(imported ?? {}),
      id: previous?.id ?? crypto.randomUUID(),
      nodeId: node.id,
      model,
      serviceTime:
        distribution === 'empirical'
          ? (imported?.serviceTime ?? previous?.serviceTime)
          : mean
            ? { kind: distribution, meanMs: Number(mean) }
            : undefined,
      concurrency: Number(concurrency),
      serviceTimeScope: timeScope,
      replicas: Number(replicas),
      scaling,
      maxReplicas: Number(maxReplicas),
      targetUtilization: Number(target) / 100,
      cacheHitRatio:
        model === 'cache' && hit !== '' ? Number(hit) / 100 : undefined,
      readReplicas: Number(readReplicas),
      cpuSecondsPerOperation: cpuDemand === '' ? undefined : Number(cpuDemand),
      cpuCores: cores === '' ? undefined : Number(cores),
      memoryBytesPerOperation:
        memoryDemand === '' ? undefined : Number(memoryDemand),
      memoryBytes: memory === '' ? undefined : Number(memory),
      storageBytes: storage === '' ? undefined : Number(storage),
      queue:
        model === 'queue'
          ? {
              bufferMessages: Number(buffer),
              retentionSeconds: Number(retention),
              acknowledgement,
              deadLetter: node.configuration.deadLetter === true,
            }
          : undefined,
      provenance: {
        kind,
        source,
        context,
        limitations,
        recordedAt,
      },
    });
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      const profile = build();
      const saved = apply((d) => {
        d.performanceProfiles = [
          ...d.performanceProfiles.filter((p) => p.nodeId !== node.id),
          profile,
        ];
      });
      setError(
        saved
          ? ''
          : 'Profile was not saved. Resolve the document validation errors and try again.',
      );
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (category === 'boundary' || category === 'client')
    return (
      <p className="field-hint">
        {category === 'boundary'
          ? 'Boundaries describe containment and do not consume processing capacity.'
          : 'Bind this client to a workload scenario in Capacity.'}
      </p>
    );
  return (
    <form onSubmit={save} className="engineering-form">
      <p className="field-hint">
        No hardware performance is inferred. Enter a measured profile or clearly
        declared assumptions.
      </p>
      <label className="engineering-field">
        Behavior model
        <select
          value={model}
          onChange={(e) =>
            setModel(e.target.value as PerformanceProfile['model'])
          }
        >
          {['service', 'database', 'cache', 'queue', 'router'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      {model !== 'queue' && model !== 'router' && (
        <>
          <label className="engineering-field">
            Service-time distribution
            <select
              value={distribution}
              onChange={(e) =>
                setDistribution(e.target.value as typeof distribution)
              }
            >
              <option value="constant">Constant</option>
              <option value="exponential">Exponential</option>
              {(imported?.serviceTime?.kind === 'empirical' ||
                previous?.serviceTime?.kind === 'empirical') && (
                <option value="empirical">Imported empirical samples</option>
              )}
            </select>
          </label>
          {distribution !== 'empirical' && (
            <NumberField
              label="Mean local service time"
              value={mean}
              onChange={setMean}
              unit="ms"
              min={0.001}
              required={false}
              help="Local processing time, excluding queues and downstream dependencies. Leave blank if unknown."
            />
          )}
          <div className="engineering-field-grid">
            <NumberField
              label="Concurrent service slots"
              value={concurrency}
              onChange={setConcurrency}
              unit="slots"
              min={1}
            />
            <NumberField
              label="Replicas"
              value={replicas}
              onChange={setReplicas}
              unit="replicas"
              min={1}
            />
          </div>
          <label className="engineering-field">
            Scaling assumption
            <select
              value={scaling}
              onChange={(e) =>
                setScaling(e.target.value as PerformanceProfile['scaling'])
              }
            >
              <option value="none">No linear scaling assumption</option>
              <option value="linear">Homogeneous independent replicas</option>
            </select>
          </label>
          <NumberField
            label="Target utilization"
            value={target}
            onChange={setTarget}
            unit="%"
            min={1}
            max={100}
          />
        </>
      )}
      {model === 'cache' && (
        <NumberField
          label="Declared cache hit ratio"
          value={hit}
          onChange={setHit}
          unit="%"
          max={100}
          help="Measured or assumed; never calculated from memory size."
        />
      )}
      {model === 'queue' && (
        <>
          <NumberField
            label="Unacknowledged message limit"
            value={buffer}
            onChange={setBuffer}
            unit="messages"
          />
          <NumberField
            label="Message retention"
            value={retention}
            onChange={setRetention}
            unit="seconds"
            min={0.001}
          />
          <label className="engineering-field">
            Acknowledgement
            <select
              value={acknowledgement}
              onChange={(e) =>
                setAcknowledgement(e.target.value as typeof acknowledgement)
              }
            >
              <option value="on-completion">After consumer completes</option>
              <option value="on-admission">When admitted</option>
            </select>
          </label>
        </>
      )}
      <details>
        <summary>Resources and scaling bounds</summary>
        <label className="engineering-field">
          Service-time interpretation
          <select
            value={timeScope}
            onChange={(e) => setTimeScope(e.target.value as typeof timeScope)}
          >
            <option value="total">Total local service time</option>
            <option value="non-cpu">
              Non-CPU delay plus a separate CPU phase
            </option>
          </select>
          <span className="field-hint">
            Coupled CPU simulation requires non-CPU delay measurements. Total
            latency cannot identify its CPU and I/O phases.
          </span>
        </label>
        <NumberField
          label="Maximum replicas"
          value={maxReplicas}
          onChange={setMaxReplicas}
          unit="replicas"
          min={1}
        />
        {model === 'database' && (
          <NumberField
            label="Independent read replicas"
            value={readReplicas}
            onChange={setReadReplicas}
            unit="replicas"
            min={0}
            help="Zero shares the primary pool. Additional read replicas serve a separate balanced read pool; writes remain on the primary."
          />
        )}
        <NumberField
          label="CPU demand per operation"
          value={cpuDemand}
          onChange={setCpuDemand}
          unit="CPU seconds"
          required={false}
        />
        <NumberField
          label="Allocated CPU cores"
          value={cores}
          onChange={setCores}
          unit="cores"
          min={0.001}
          required={false}
        />
        <NumberField
          label="Memory per in-flight operation"
          value={memoryDemand}
          onChange={setMemoryDemand}
          unit="bytes"
          required={false}
        />
        <NumberField
          label="Allocated memory"
          value={memory}
          onChange={setMemory}
          unit="bytes"
          min={1}
          required={false}
        />
        <NumberField
          label="Allocated durable storage"
          value={storage}
          onChange={setStorage}
          unit="bytes"
          min={1}
          required={false}
        />
      </details>
      <fieldset>
        <legend>Evidence provenance</legend>
        <label className="engineering-field">
          Evidence recorded at (UTC)
          <input
            type="datetime-local"
            required
            value={recordedAt.slice(0, 16)}
            onChange={(e) =>
              setRecordedAt(e.target.value ? `${e.target.value}:00.000Z` : '')
            }
          />
          <span className="field-hint">
            UTC date and time of the measurement or assumption record.
          </span>
        </label>
        <label className="engineering-field">
          Evidence type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="assumed">Declared assumption</option>
            <option value="measured">Measured</option>
            <option value="illustrative">Illustrative example</option>
          </select>
        </label>
        <label className="engineering-field">
          Source
          <input
            required
            value={source}
            placeholder="Load test report, benchmark, or assumption rationale"
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label className="engineering-field">
          Operating context
          <textarea
            required
            value={context}
            placeholder="Hardware, workload, deployment, and measurement range"
            onChange={(e) => setContext(e.target.value)}
          />
        </label>
        <label className="engineering-field">
          Limitations
          <textarea
            value={limitations}
            onChange={(e) => setLimitations(e.target.value)}
          />
        </label>
      </fieldset>
      <label className="engineering-field">
        Import measurement CSV
        <input
          aria-label="Import measurement CSV"
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              if (file.size > 5 * 1024 * 1024)
                throw new Error('CSV exceeds 5 MB.');
              const profile = importMeasurementsCSV(await file.text(), build());
              setImported(profile);
              if (profile.serviceTime?.kind === 'empirical')
                setDistribution('empirical');
              setError('');
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
        <span className="field-hint">
          service_ms samples, or requests_per_second,mean_latency_ms capacity
          curves. Importing does not automatically mark evidence as measured.
        </span>
      </label>
      {(imported?.capacityCurve.length ?? previous?.capacityCurve.length ?? 0) >
        0 && (
        <p className="field-hint">
          {imported?.capacityCurve.length ?? previous?.capacityCurve.length}{' '}
          curve points. Interpolation stays within this measured range.
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit">
        Save capacity profile
      </Button>
    </form>
  );
}
export function FlowEditor({ edgeId }: { edgeId: string }) {
  const scenarios = useEditor((s) => s.history.present.scenarios);
  const [scope, setScope] = useState('');
  return (
    <div>
      <label className="engineering-field">
        Traffic policy scope
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">Default for all traffic classes</option>
          {scenarios.flatMap((s) =>
            s.trafficClasses.map((t) => (
              <option key={t.id} value={t.id}>
                {s.name} · {t.name}
              </option>
            )),
          )}
        </select>
      </label>
      <FlowPolicyForm
        key={`${edgeId}:${scope}`}
        edgeId={edgeId}
        trafficClassId={scope || undefined}
      />
    </div>
  );
}
function FlowPolicyForm({
  edgeId,
  trafficClassId,
}: {
  edgeId: string;
  trafficClassId?: string;
}) {
  const document = useEditor((s) => s.history.present),
    apply = useEditor((s) => s.apply);
  const previous = document.flowPolicies.find(
    (p) => p.edgeId === edgeId && p.trafficClassId === trafficClassId,
  );
  const [calls, setCalls] = useState(String(previous?.callsPerOperation ?? ''));
  const [fraction, setFraction] = useState(
    String((previous?.fraction ?? 1) * 100),
  );
  const [operation, setOperation] = useState(previous?.operation ?? 'all');
  const [cache, setCache] = useState(previous?.cacheNodeId ?? '');
  const [execution, setExecution] = useState(
    previous?.execution ?? 'sequential',
  );
  const [order, setOrder] = useState(String(previous?.order ?? 0));
  const [delivery, setDelivery] = useState(previous?.delivery ?? 'competing');
  const [group, setGroup] = useState(previous?.group ?? 'default');
  const [routing, setRouting] = useState(previous?.routing ?? 'independent');
  const [retries, setRetries] = useState(String(previous?.maxRetries ?? 0));
  const [probability, setProbability] = useState(
    String((previous?.retryProbability ?? 0) * 100),
  );
  const [backoff, setBackoff] = useState(String(previous?.retryBackoffMs ?? 0));
  const [timeout, setTimeoutValue] = useState(
    String(previous?.timeoutMs ?? ''),
  );
  const [latency, setLatency] = useState(
    String(previous?.networkLatencyMs ?? 0),
  );
  const [bandwidth, setBandwidth] = useState(
    String(previous?.linkBytesPerSecond ?? ''),
  );
  const [assumption, setAssumption] = useState(previous?.assumption ?? '');
  const [error, setError] = useState('');
  return (
    <form
      className="engineering-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const policy = FlowPolicySchema.parse({
            id: previous?.id ?? crypto.randomUUID(),
            edgeId,
            trafficClassId,
            callsPerOperation: Number(calls),
            fraction: Number(fraction) / 100,
            operation,
            cacheNodeId: cache || undefined,
            execution,
            order: Number(order),
            group,
            routing,
            delivery,
            maxRetries: Number(retries),
            retryProbability: Number(probability) / 100,
            retryBackoffMs: Number(backoff),
            timeoutMs: timeout ? Number(timeout) : undefined,
            networkLatencyMs: Number(latency),
            linkBytesPerSecond: bandwidth ? Number(bandwidth) : undefined,
            assumption,
          });
          const saved = apply((d) => {
            d.flowPolicies = [
              ...d.flowPolicies.filter(
                (p) =>
                  !(p.edgeId === edgeId && p.trafficClassId === trafficClassId),
              ),
              policy,
            ];
          });
          setError(
            saved
              ? ''
              : 'Flow policy was not saved. Resolve the document validation errors and try again.',
          );
        } catch (e) {
          setError(errorText(e));
        }
      }}
    >
      <NumberField
        label="Calls per upstream operation"
        value={calls}
        onChange={setCalls}
        unit="calls"
        help="A connection does not imply one call. Declare the workload relationship."
      />
      <NumberField
        label="Routing fraction"
        value={fraction}
        onChange={setFraction}
        unit="%"
        max={100}
      />
      <label className="engineering-field">
        Operation condition
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value as typeof operation)}
        >
          {['all', 'read', 'write', 'cache-miss', 'cache-aside'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {(operation === 'cache-miss' || operation === 'cache-aside') && (
        <label className="engineering-field">
          Cache evidence
          <select
            required
            value={cache}
            onChange={(e) => setCache(e.target.value)}
          >
            <option value="">Select cache profile</option>
            {document.performanceProfiles
              .filter((p) => p.model === 'cache')
              .map((p) => (
                <option key={p.nodeId} value={p.nodeId}>
                  {document.nodes.find((n) => n.id === p.nodeId)?.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="engineering-field">
        Execution
        <select
          value={execution}
          onChange={(e) => setExecution(e.target.value as typeof execution)}
        >
          <option value="sequential">Sequential dependency</option>
          <option value="parallel">Parallel dependency with join</option>
          <option value="async">Asynchronous background work</option>
        </select>
      </label>
      <NumberField
        label="Execution stage"
        value={order}
        onChange={setOrder}
        unit="stage"
        help="Lower stages execute first. Parallel calls in the same stage join before continuing."
      />
      <details>
        <summary>Delivery, retries and network</summary>
        <label className="engineering-field">
          Routing mode
          <select
            value={routing}
            onChange={(e) => setRouting(e.target.value as typeof routing)}
          >
            <option value="independent">Independent calls</option>
            <option value="exclusive">Exclusive weighted routing</option>
          </select>
          <span className="field-hint">
            Exclusive fractions total 100% within a group. Each operation
            selects one destination.
          </span>
        </label>
        <label className="engineering-field">
          Consumer group
          <input value={group} onChange={(e) => setGroup(e.target.value)} />
        </label>
        <label className="engineering-field">
          Queue delivery
          <select
            value={delivery}
            onChange={(e) => setDelivery(e.target.value as typeof delivery)}
          >
            <option value="competing">Competing consumers</option>
            <option value="broadcast">Broadcast subscriber</option>
          </select>
        </label>
        <NumberField
          label="Maximum retries"
          value={retries}
          onChange={setRetries}
          unit="retries"
          max={100}
        />
        <NumberField
          label="Independent failure probability"
          value={probability}
          onChange={setProbability}
          unit="%"
          max={100}
        />
        <NumberField
          label="Retry backoff"
          value={backoff}
          onChange={setBackoff}
          unit="ms"
        />
        <NumberField
          label="Timeout"
          value={timeout}
          onChange={setTimeoutValue}
          unit="ms"
          required={false}
          min={0.001}
        />
        <NumberField
          label="Network latency"
          value={latency}
          onChange={setLatency}
          unit="ms"
        />
        <NumberField
          label="Link bandwidth"
          value={bandwidth}
          onChange={setBandwidth}
          unit="bytes/s"
          required={false}
          min={0.001}
        />
      </details>
      <label className="engineering-field">
        Routing rationale
        <textarea
          required
          value={assumption}
          onChange={(e) => setAssumption(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary">
        Save flow policy
      </Button>
    </form>
  );
}
export function ScenarioEditor({
  scenario,
  onSaved,
}: {
  scenario?: Scenario;
  onSaved: (id: string) => void;
}) {
  const document = useEditor((s) => s.history.present),
    apply = useEditor((s) => s.apply);
  const [name, setName] = useState(scenario?.name ?? 'Baseline workload');
  const [description, setDescription] = useState(scenario?.description ?? '');
  const [assumptions, setAssumptions] = useState(scenario?.assumptions ?? '');
  const [growth, setGrowth] = useState(
    String(scenario?.growthPercentPerMonth ?? 0),
  );
  const [months, setMonths] = useState(String(scenario?.growthMonths ?? 0));
  const [traffic, setTraffic] = useState<TrafficClass[]>(
    scenario?.trafficClasses ?? [],
  );
  const [targets, setTargets] = useState<Scenario['targets']>(
    scenario?.targets ?? [],
  );
  const [error, setError] = useState('');
  const update = (id: string, change: Partial<TrafficClass>) =>
    setTraffic((ts) => ts.map((t) => (t.id === id ? { ...t, ...change } : t)));
  return (
    <form
      className="engineering-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const s = ScenarioSchema.parse({
            id: scenario?.id ?? crypto.randomUUID(),
            name,
            description,
            assumptions,
            growthPercentPerMonth: Number(growth),
            growthMonths: Number(months),
            trafficClasses: traffic,
            targets,
          });
          const saved = apply((d) => {
            d.scenarios = [...d.scenarios.filter((v) => v.id !== s.id), s];
            const trafficIds = new Set(
              d.scenarios.flatMap((scenario) =>
                scenario.trafficClasses.map((t) => t.id),
              ),
            );
            const targetIds = new Set(
              d.scenarios.flatMap((scenario) =>
                scenario.targets.map((t) => t.id),
              ),
            );
            d.flowPolicies = d.flowPolicies.filter(
              (p) => !p.trafficClassId || trafficIds.has(p.trafficClassId),
            );
            for (const assessment of d.assessments)
              if (assessment.targetId && !targetIds.has(assessment.targetId)) {
                assessment.targetId = undefined;
                assessment.status = 'unknown';
                assessment.fingerprint = undefined;
              }
          });
          if (!saved) {
            setError(
              'Scenario was not saved. Check entry points, target references and burst intervals.',
            );
            return;
          }
          setError('');
          onSaved(s.id);
        } catch (e) {
          setError(errorText(e));
        }
      }}
    >
      <label className="engineering-field">
        Scenario name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="engineering-field">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="engineering-field-grid">
        <NumberField
          label="Monthly workload growth"
          value={growth}
          onChange={setGrowth}
          unit="%"
          min={-100}
        />
        <NumberField
          label="Growth horizon"
          value={months}
          onChange={setMonths}
          unit="months"
        />
      </div>
      {traffic.map((t, index) => (
        <fieldset key={t.id}>
          <legend>Traffic class {index + 1}</legend>
          <label className="engineering-field">
            Traffic class name
            <input
              required
              value={t.name}
              onChange={(e) => update(t.id, { name: e.target.value })}
            />
          </label>
          <label className="engineering-field">
            Entry point
            <select
              required
              value={t.entryNodeId}
              onChange={(e) => update(t.id, { entryNodeId: e.target.value })}
            >
              <option value="">Choose architecture object</option>
              {document.nodes
                .filter(
                  (n) =>
                    document.components.find((c) => c.id === n.componentId)
                      ?.category !== 'boundary',
                )
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="engineering-field">
            Workload source
            <select
              value={t.workload.kind}
              onChange={(e) =>
                update(t.id, {
                  workload:
                    e.target.value === 'rate'
                      ? { kind: 'rate', requestsPerSecond: 0 }
                      : {
                          kind: 'users',
                          dailyActiveUsers: 0,
                          requestsPerUserPerDay: 0,
                        },
                })
              }
            >
              <option value="rate">Direct request rate</option>
              <option value="users">Daily active users</option>
            </select>
          </label>
          {t.workload.kind === 'rate' ? (
            <NumberField
              label="Request rate"
              value={t.workload.requestsPerSecond}
              onChange={(v) =>
                update(t.id, {
                  workload: { kind: 'rate', requestsPerSecond: Number(v) },
                })
              }
              unit="ops/s"
            />
          ) : (
            <>
              <NumberField
                label="Daily active users"
                value={t.workload.dailyActiveUsers}
                onChange={(v) =>
                  update(t.id, {
                    workload: {
                      ...(t.workload as {
                        kind: 'users';
                        dailyActiveUsers: number;
                        requestsPerUserPerDay: number;
                      }),
                      dailyActiveUsers: Number(v),
                    },
                  })
                }
                unit="users"
              />
              <NumberField
                label="Requests per user per day"
                value={t.workload.requestsPerUserPerDay}
                onChange={(v) =>
                  update(t.id, {
                    workload: {
                      ...(t.workload as {
                        kind: 'users';
                        dailyActiveUsers: number;
                        requestsPerUserPerDay: number;
                      }),
                      requestsPerUserPerDay: Number(v),
                    },
                  })
                }
                unit="requests"
              />
            </>
          )}
          <label className="engineering-field">
            Arrival process
            <select
              value={t.arrivals}
              onChange={(e) =>
                update(t.id, {
                  arrivals: e.target.value as TrafficClass['arrivals'],
                })
              }
            >
              <option value="poisson">Poisson arrivals</option>
              <option value="constant">Regular arrivals</option>
            </select>
          </label>
          <div className="engineering-field-grid">
            <NumberField
              label="Read proportion"
              value={t.readFraction * 100}
              onChange={(v) => update(t.id, { readFraction: Number(v) / 100 })}
              unit="%"
              max={100}
            />
            <NumberField
              label="Peak multiplier"
              value={t.peakMultiplier}
              onChange={(v) => update(t.id, { peakMultiplier: Number(v) })}
              unit="×"
              min={0.001}
            />
          </div>
          <details>
            <summary>Payloads, retention and bursts</summary>
            {(
              [
                {
                  key: 'payloadBytes',
                  label: 'Request payload',
                  unit: 'bytes',
                },
                {
                  key: 'responseBytes',
                  label: 'Response payload',
                  unit: 'bytes',
                },
                {
                  key: 'objectBytes',
                  label: 'New object size per write',
                  unit: 'bytes',
                },
                { key: 'retentionDays', label: 'Retention', unit: 'days' },
              ] as const
            ).map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                value={t[f.key] ?? ''}
                onChange={(v) =>
                  update(t.id, { [f.key]: v === '' ? undefined : Number(v) })
                }
                unit={f.unit}
                required={false}
              />
            ))}
            <NumberField
              label="Cache working-set objects"
              value={t.cacheWorkingSetObjects ?? ''}
              onChange={(v) =>
                update(t.id, {
                  cacheWorkingSetObjects: v === '' ? undefined : Number(v),
                })
              }
              unit="objects"
              required={false}
              help="Explicit cacheable object cardinality. Leave blank when unknown."
            />
            <NumberField
              label="Cache entry overhead"
              value={t.cacheEntryOverheadBytes}
              onChange={(v) =>
                update(t.id, { cacheEntryOverheadBytes: Number(v) })
              }
              unit="bytes"
            />
            {t.bursts.map((b, i) => (
              <div key={i} className="engineering-field-grid">
                {(
                  [
                    { key: 'startSeconds', label: 'Burst starts', unit: 's' },
                    {
                      key: 'durationSeconds',
                      label: 'Burst duration',
                      unit: 's',
                    },
                    { key: 'multiplier', label: 'Burst multiplier', unit: '×' },
                  ] as const
                ).map((f) => (
                  <NumberField
                    key={f.key}
                    label={f.label}
                    value={b[f.key]}
                    onChange={(v) =>
                      update(t.id, {
                        bursts: t.bursts.map((old, j) =>
                          j === i ? { ...old, [f.key]: Number(v) } : old,
                        ),
                      })
                    }
                    unit={f.unit}
                  />
                ))}
                <Button
                  type="button"
                  onClick={() =>
                    update(t.id, { bursts: t.bursts.filter((_, j) => j !== i) })
                  }
                >
                  Remove burst
                </Button>
              </div>
            ))}
            <Button
              type="button"
              onClick={() =>
                update(t.id, {
                  bursts: [
                    ...t.bursts,
                    { startSeconds: 0, durationSeconds: 30, multiplier: 2 },
                  ],
                })
              }
            >
              Add burst interval
            </Button>
          </details>
          <Button
            type="button"
            onClick={() => {
              setTraffic((ts) => ts.filter((old) => old.id !== t.id));
              setTargets((targets) =>
                targets.filter((target) => target.trafficClassId !== t.id),
              );
            }}
          >
            Remove traffic class
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        onClick={() =>
          setTraffic((ts) => [
            ...ts,
            {
              id: crypto.randomUUID(),
              name: `Traffic ${ts.length + 1}`,
              entryNodeId: '',
              workload: { kind: 'rate', requestsPerSecond: 0 },
              arrivals: 'poisson',
              readFraction: 1,
              cacheEntryOverheadBytes: 0,
              peakMultiplier: 1,
              bursts: [],
            },
          ])
        }
      >
        Add traffic class
      </Button>
      <details>
        <summary>Performance targets ({targets.length})</summary>
        {targets.map((t, index) => (
          <fieldset key={t.id}>
            <legend>Target {index + 1}</legend>
            <label className="engineering-field">
              Metric
              <select
                value={t.metric}
                onChange={(e) => {
                  const metric = e.target.value as typeof t.metric;
                  setTargets((targets) =>
                    targets.map((old) =>
                      old.id === t.id
                        ? {
                            ...old,
                            metric,
                            value:
                              metric === 'utilization'
                                ? 0.7
                                : metric === 'throughput'
                                  ? 1
                                  : 100,
                            unit:
                              metric === 'throughput'
                                ? 'ops/s'
                                : metric === 'utilization'
                                  ? 'ratio'
                                  : metric === 'queue-depth'
                                    ? 'messages'
                                    : 'ms',
                          }
                        : old,
                    ),
                  );
                }}
              >
                {[
                  'throughput',
                  'mean-latency',
                  'p95-latency',
                  'p99-latency',
                  'utilization',
                  'queue-depth',
                  'deadline',
                ].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="engineering-field">
              Object scope
              <select
                value={t.nodeId ?? ''}
                onChange={(e) =>
                  setTargets((targets) =>
                    targets.map((old) =>
                      old.id === t.id
                        ? {
                            ...old,
                            nodeId: e.target.value || undefined,
                            trafficClassId: undefined,
                          }
                        : old,
                    ),
                  )
                }
              >
                <option value="">Entire scenario</option>
                {document.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="engineering-field">
              Traffic class scope
              <select
                aria-label="Traffic class scope"
                disabled={!!t.nodeId}
                value={t.trafficClassId ?? ''}
                onChange={(e) =>
                  setTargets((targets) =>
                    targets.map((old) =>
                      old.id === t.id
                        ? {
                            ...old,
                            trafficClassId: e.target.value || undefined,
                          }
                        : old,
                    ),
                  )
                }
              >
                <option value="">All traffic classes</option>
                {traffic.map((classOfTraffic) => (
                  <option key={classOfTraffic.id} value={classOfTraffic.id}>
                    {classOfTraffic.name}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Traffic-class metrics apply to the entire scenario. Object
                targets use aggregate object metrics.
              </span>
            </label>
            <label className="engineering-field">
              Condition
              <select
                value={t.comparator}
                onChange={(e) =>
                  setTargets((targets) =>
                    targets.map((old) =>
                      old.id === t.id
                        ? {
                            ...old,
                            comparator: e.target.value as typeof t.comparator,
                          }
                        : old,
                    ),
                  )
                }
              >
                <option value="at-most">At most</option>
                <option value="at-least">At least</option>
              </select>
            </label>
            <NumberField
              label="Target value"
              value={t.value}
              onChange={(v) =>
                setTargets((targets) =>
                  targets.map((old) =>
                    old.id === t.id ? { ...old, value: Number(v) } : old,
                  ),
                )
              }
              unit={t.unit}
            />
            <Button
              type="button"
              onClick={() =>
                setTargets((targets) =>
                  targets.filter((old) => old.id !== t.id),
                )
              }
            >
              Remove target
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          onClick={() =>
            setTargets((targets) => [
              ...targets,
              {
                id: crypto.randomUUID(),
                metric: 'mean-latency',
                comparator: 'at-most',
                value: 100,
                unit: 'ms',
              },
            ])
          }
        >
          Add performance target
        </Button>
      </details>
      <label className="engineering-field">
        Assumptions and limitations
        <textarea
          required
          value={assumptions}
          onChange={(e) => setAssumptions(e.target.value)}
          placeholder="Document what this workload represents and where uncertainty remains."
        />
      </label>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit">
        Save scenario
      </Button>
    </form>
  );
}
export function NotesEditor({
  node,
  onOpenRecord,
}: {
  node: ArchitectureNode;
  onOpenRecord?: (kind: 'requirements' | 'decisions', id: string) => void;
}) {
  const document = useEditor((s) => s.history.present),
    apply = useEditor((s) => s.apply);
  const existing =
    document.annotations.find((a) => a.id === `note:${node.id}`) ??
    document.annotations.find(
      (a) => a.nodeIds.length === 1 && a.nodeIds[0] === node.id,
    );
  const [text, setText] = useState(existing?.text ?? '');
  return (
    <div className="engineering-form">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply((d) => {
            d.annotations = d.annotations.filter((a) => a.id !== existing?.id);
            if (text.trim())
              d.annotations.push({
                id: existing?.id ?? crypto.randomUUID(),
                text: text.trim(),
                nodeIds: [node.id],
              });
          });
        }}
      >
        <label className="engineering-field">
          Architecture notes
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Responsibilities, constraints, and review notes"
          />
        </label>
        <Button type="submit">Save notes</Button>
      </form>
      <h3>Linked requirements</h3>
      {[...document.requirements, ...document.nonFunctionalRequirements]
        .filter((r) => r.nodeIds.includes(node.id))
        .map((r) => (
          <Button
            key={r.id}
            variant="ghost"
            onClick={() => onOpenRecord?.('requirements', r.id)}
          >
            {r.title}
          </Button>
        ))}
      <h3>Linked decisions</h3>
      {document.decisions
        .filter((d) => d.nodeIds.includes(node.id))
        .map((d) => (
          <Button
            key={d.id}
            variant="ghost"
            onClick={() => onOpenRecord?.('decisions', d.id)}
          >
            {d.title} · {d.status}
          </Button>
        ))}
      {document.annotations
        .filter((a) => a.id !== existing?.id && a.nodeIds.includes(node.id))
        .map((a) => (
          <p key={a.id}>{a.text}</p>
        ))}
    </div>
  );
}
