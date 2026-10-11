import type {
  ArchitectureDocument,
  TrafficClass,
  Scenario,
  FlowPolicy,
  PerformanceProfile,
} from '@swiftbuild/architecture-schema';
import { inputFingerprint } from '@swiftbuild/architecture-model';
import { validateDocument } from '@swiftbuild/graph-engine';
import { ENGINE_VERSION, metric, type CapacityReport } from './types';
export function scenarioFor(
  document: ArchitectureDocument,
  id: string,
): Scenario {
  validateDocument(document);
  const s = document.scenarios.find((v) => v.id === id);
  if (!s) throw new Error(`Unknown scenario ${id}.`);
  return s;
}
export function rateFor(traffic: TrafficClass, scenario: Scenario): number {
  const base =
    traffic.workload.kind === 'rate'
      ? traffic.workload.requestsPerSecond
      : (traffic.workload.dailyActiveUsers *
          traffic.workload.requestsPerUserPerDay) /
        86400;
  const rate =
    base *
    traffic.peakMultiplier *
    Math.pow(1 + scenario.growthPercentPerMonth / 100, scenario.growthMonths);
  if (!Number.isFinite(rate))
    throw new Error(
      'Workload growth or peak multiplication exceeds the finite numerical range. Reduce the scenario values.',
    );
  return rate;
}
export function reportFor(
  document: ArchitectureDocument,
  scenarioId: string,
  kind: CapacityReport['kind'],
): CapacityReport {
  return {
    engineVersion: ENGINE_VERSION,
    modelVersion: '1.0',
    fingerprint: inputFingerprint(document),
    scenarioId,
    scenarioName: document.scenarios.find((s) => s.id === scenarioId)?.name,
    kind,
    status: 'complete',
    metrics: [],
    nodes: [],
    coverage: [],
    assumptions: [],
  };
}
export function estimateScenario(
  document: ArchitectureDocument,
  scenarioId: string,
): CapacityReport {
  const scenario = scenarioFor(document, scenarioId);
  const report = reportFor(document, scenarioId, 'estimate');
  for (const t of scenario.trafficClasses) {
    const r = rateFor(t, scenario);
    const inputs = {
      rate: r,
      readFraction: t.readFraction,
      objectBytes: t.objectBytes,
      retentionDays: t.retentionDays,
      payloadBytes: t.payloadBytes,
      responseBytes: t.responseBytes,
    };
    report.metrics.push(
      metric(
        `${t.id}:rate`,
        `${t.name} · offered traffic`,
        r,
        'ops/s',
        'base rate × peak multiplier × (1 + growth/100)^months',
        inputs,
        [
          scenario.assumptions,
          'Peak rate excludes additional time-varying bursts.',
        ],
      ),
      metric(
        `${t.id}:storage`,
        `${t.name} · retained writes`,
        r === 0 || t.readFraction === 1 || t.retentionDays === 0
          ? 0
          : t.objectBytes === undefined || t.retentionDays === undefined
            ? undefined
            : r *
              (1 - t.readFraction) *
              t.objectBytes *
              t.retentionDays *
              86400,
        'bytes',
        'rate × write fraction × object bytes × retention seconds',
        inputs,
        [
          'All modeled writes create retained objects; updates, indexes, compression and replication require explicit overhead.',
        ],
      ),
      metric(
        `${t.id}:bandwidth`,
        `${t.name} · external bandwidth`,
        t.payloadBytes === undefined || t.responseBytes === undefined
          ? undefined
          : r * (t.payloadBytes + t.responseBytes),
        'bytes/s',
        'rate × (request bytes + response bytes)',
        inputs,
        ['Application payload only; protocol overhead is excluded.'],
      ),
      metric(
        `${t.id}:cache-working-set`,
        `${t.name} · cache working set`,
        t.cacheWorkingSetObjects === undefined || t.objectBytes === undefined
          ? undefined
          : t.cacheWorkingSetObjects *
              (t.objectBytes + t.cacheEntryOverheadBytes),
        'bytes',
        'declared cacheable object count × (object bytes + entry overhead bytes)',
        {
          objectBytes: t.objectBytes,
          overheadBytes: t.cacheEntryOverheadBytes,
          objects: t.cacheWorkingSetObjects ?? 0,
        },
        [
          'Working-set cardinality is explicitly supplied and held constant; traffic does not imply cacheable object count or hit ratio.',
        ],
      ),
    );
  }
  return report;
}
export function meanServiceMs(profile: PerformanceProfile): number | undefined {
  const d = profile.serviceTime;
  const base = !d
    ? undefined
    : d.kind === 'empirical'
      ? d.samplesMs.reduce((a, b) => a + b, 0) / d.samplesMs.length
      : d.meanMs;
  return base === undefined
    ? undefined
    : base +
        (profile.serviceTimeScope === 'non-cpu' &&
        profile.cpuSecondsPerOperation &&
        profile.cpuCores
          ? (profile.cpuSecondsPerOperation /
              (profile.cpuCores / Math.ceil(profile.cpuCores))) *
            1000
          : 0);
}
export function policyFor(
  document: ArchitectureDocument,
  edgeId: string,
  trafficId: string,
): FlowPolicy | undefined {
  return (
    document.flowPolicies.find(
      (p) => p.edgeId === edgeId && p.trafficClassId === trafficId,
    ) ??
    document.flowPolicies.find((p) => p.edgeId === edgeId && !p.trafficClassId)
  );
}
export function retryFactor(policy: FlowPolicy): number {
  let factor = 0;
  for (let i = 0; i <= policy.maxRetries; i++)
    factor += policy.retryProbability ** i;
  return factor;
}
export function flowFraction(
  document: ArchitectureDocument,
  policy: FlowPolicy,
  read: boolean,
): number | undefined {
  if (
    (policy.operation === 'read' && !read) ||
    (policy.operation === 'write' && read)
  )
    return 0;
  if (policy.operation === 'cache-miss' || policy.operation === 'cache-aside') {
    if (!read) return policy.operation === 'cache-aside' ? policy.fraction : 0;
    const hit = document.performanceProfiles.find(
      (p) => p.nodeId === policy.cacheNodeId,
    )?.cacheHitRatio;
    if (hit === undefined) return undefined;
    return policy.fraction * (1 - hit);
  }
  return policy.fraction;
}
export function topologyOrder(
  document: ArchitectureDocument,
): string[] | undefined {
  const indegree = new Map(document.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const e of document.edges) {
    indegree.set(e.target.nodeId, indegree.get(e.target.nodeId)! + 1);
    outgoing.set(e.source.nodeId, [
      ...(outgoing.get(e.source.nodeId) ?? []),
      e.target.nodeId,
    ]);
  }
  const ready = [...indegree].filter(([, v]) => v === 0).map(([id]) => id);
  const order: string[] = [];
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]!;
    order.push(id);
    for (const target of outgoing.get(id) ?? []) {
      indegree.set(target, indegree.get(target)! - 1);
      if (!indegree.get(target)) ready.push(target);
    }
  }
  return order.length === document.nodes.length ? order : undefined;
}
