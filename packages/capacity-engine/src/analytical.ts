import type {
  ArchitectureDocument,
  PerformanceProfile,
} from '@swiftbuild/architecture-schema';
import { metric, type CapacityReport, type Metric } from './types';
import {
  scenarioFor,
  reportFor,
  rateFor,
  policyFor,
  flowFraction,
  retryFactor,
  meanServiceMs,
  topologyOrder,
} from './workload';

/** Erlang-C, evaluated recursively to avoid factorial overflow. */
export function mmc(
  lambda: number,
  meanSeconds: number,
  servers: number,
): { utilization: number; waitSeconds?: number; meanSeconds?: number } {
  if (
    !Number.isFinite(lambda) ||
    lambda < 0 ||
    !Number.isFinite(meanSeconds) ||
    meanSeconds <= 0 ||
    !Number.isSafeInteger(servers) ||
    servers < 1
  )
    throw new Error(
      'Queueing inputs require a finite nonnegative rate, positive service time and positive integer server count.',
    );
  const a = lambda * meanSeconds;
  if (!Number.isFinite(a))
    throw new Error(
      'Offered service demand exceeds the finite numerical range.',
    );
  const rho = a / servers;
  if (rho >= 1) return { utilization: rho };
  if (servers > 100000) return { utilization: rho };
  let erlangB = 1;
  for (let k = 1; k <= servers; k++)
    erlangB = (a * erlangB) / (k + a * erlangB);
  const erlangC = erlangB / (1 - rho + rho * erlangB);
  const wait =
    lambda === 0 ? 0 : (erlangC * meanSeconds) / (servers * (1 - rho));
  return {
    utilization: rho,
    waitSeconds: wait,
    meanSeconds: wait + meanSeconds,
  };
}
function curveLatency(
  profile: PerformanceProfile,
  rate: number,
): number | undefined {
  const curve = profile.capacityCurve;
  if (
    !curve.length ||
    rate < curve[0]!.requestsPerSecond ||
    rate > curve.at(-1)!.requestsPerSecond
  )
    return undefined;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!,
      b = curve[i]!;
    if (rate <= b.requestsPerSecond)
      return (
        a.meanLatencyMs +
        ((b.meanLatencyMs - a.meanLatencyMs) * (rate - a.requestsPerSecond)) /
          (b.requestsPerSecond - a.requestsPerSecond)
      );
  }
  return curve[0]!.meanLatencyMs;
}
export function analyzeTopology(
  document: ArchitectureDocument,
  scenarioId: string,
): CapacityReport {
  const scenario = scenarioFor(document, scenarioId);
  const report = reportFor(document, scenarioId, 'analytical');
  const order = topologyOrder(document);
  if (!order) {
    report.status = 'partial';
    report.coverage.push({
      message:
        'Topology contains a feedback cycle. This behavior model supports directed acyclic paths and bounded policy retries, not recursive routing.',
    });
    return report;
  }
  const rates = new Map<
    string,
    { reads: number; writes: number; bytes: number; storage: number }
  >();
  const unknownStorage = new Set<string>();
  for (const n of document.nodes)
    rates.set(n.id, { reads: 0, writes: 0, bytes: 0, storage: 0 });
  for (const traffic of scenario.trafficClasses)
    for (const read of [true, false]) {
      const arrivals = new Map<string, number>([
        [
          traffic.entryNodeId,
          rateFor(traffic, scenario) *
            (read ? traffic.readFraction : 1 - traffic.readFraction),
        ],
      ]);
      for (const nodeId of order) {
        const rate = arrivals.get(nodeId) ?? 0;
        if (!rate) continue;
        const total = rates.get(nodeId)!;
        if (read) total.reads += rate;
        else {
          total.writes += rate;
          if (
            traffic.objectBytes === undefined ||
            traffic.retentionDays === undefined
          )
            unknownStorage.add(nodeId);
          else
            total.storage +=
              rate * traffic.objectBytes * traffic.retentionDays * 86400;
        }
        total.bytes +=
          rate * ((traffic.payloadBytes ?? 0) + (traffic.responseBytes ?? 0));
        for (const edge of document.edges.filter(
          (e) => e.source.nodeId === nodeId,
        )) {
          const policy = policyFor(document, edge.id, traffic.id);
          if (!policy) {
            report.coverage.push({
              nodeId,
              edgeId: edge.id,
              message: `Missing calls and routing policy for ${traffic.name}; downstream demand is unknown.`,
            });
            continue;
          }
          const fraction = flowFraction(document, policy, read);
          if (fraction === undefined) {
            report.coverage.push({
              edgeId: edge.id,
              message: 'Cache-miss routing has no hit-ratio evidence.',
            });
            continue;
          }
          const next =
            rate * fraction * policy.callsPerOperation * retryFactor(policy);
          arrivals.set(
            edge.target.nodeId,
            (arrivals.get(edge.target.nodeId) ?? 0) + next,
          );
          if (policy.linkBytesPerSecond)
            report.metrics.push(
              metric(
                `${traffic.id}:${read}:${edge.id}:link-utilization`,
                `${edge.label || edge.id} · link utilization`,
                traffic.payloadBytes === undefined ||
                  traffic.responseBytes === undefined
                  ? undefined
                  : (next * (traffic.payloadBytes + traffic.responseBytes)) /
                      policy.linkBytesPerSecond,
                'ratio',
                'offered operations × payload / declared link bandwidth',
                { rate: next, bandwidth: policy.linkBytesPerSecond },
                [policy.assumption],
              ),
            );
        }
      }
    }
  const unknown = new Set<string>();
  for (const issue of report.coverage)
    if (issue.edgeId) {
      const edge = document.edges.find((e) => e.id === issue.edgeId)!;
      unknown.add(edge.target.nodeId);
    }
  for (const id of order)
    if (unknown.has(id))
      for (const e of document.edges.filter((e) => e.source.nodeId === id))
        unknown.add(e.target.nodeId);
  for (const node of document.nodes) {
    const category = document.components.find(
      (c) => c.id === node.componentId,
    )!.category;
    if (category === 'boundary') continue;
    const demand = rates.get(node.id)!;
    const rate = demand.reads + demand.writes;
    const profile = document.performanceProfiles.find(
      (p) => p.nodeId === node.id,
    );
    const metrics: Metric[] = [
      metric(
        'arrival',
        'Offered demand',
        unknown.has(node.id) ? undefined : rate,
        'ops/s',
        'Σ external arrivals + upstream calls × routing × bounded retry factor',
        { reads: demand.reads, writes: demand.writes },
        [
          'Downstream offered demand is propagated independently of admission limits.',
        ],
        unknown.has(node.id) ? ['An upstream routing policy is missing.'] : [],
      ),
    ];
    if (unknown.has(node.id)) {
      report.nodes.push({ nodeId: node.id, metrics, bottleneck: false });
      continue;
    }
    if (!profile && category !== 'client') {
      metrics.push(
        metric(
          'utilization',
          'Service-slot utilization',
          undefined,
          'ratio',
          'A registered performance profile is required.',
          {},
          [],
          ['No component performance evidence.'],
        ),
      );
      report.coverage.push({
        nodeId: node.id,
        message:
          'No registered behavior profile or performance evidence. Capacity is unknown.',
      });
    }
    if (profile) {
      const mean = meanServiceMs(profile);
      const provenance = [
        profile.provenance.source,
        profile.provenance.context,
      ];
      const assumptions = [
        profile.provenance.kind === 'measured'
          ? 'Measured input within its recorded context.'
          : `${profile.provenance.kind} input; not measured production performance.`,
      ];
      if (
        mean !== undefined &&
        profile.model !== 'queue' &&
        profile.model !== 'router'
      ) {
        const servers =
          profile.concurrency *
          (profile.model !== 'database' && profile.scaling === 'linear'
            ? profile.replicas
            : 1);
        const separateReads =
          profile.model === 'database' && profile.readReplicas > 0;
        const equivalentRate = separateReads
          ? Math.max(demand.writes, demand.reads / profile.readReplicas)
          : rate;
        let q = mmc(rate, mean / 1000, servers);
        if (separateReads) {
          const read = mmc(
            demand.reads,
            mean / 1000,
            servers * profile.readReplicas,
          );
          const write = mmc(demand.writes, mean / 1000, servers);
          q = {
            utilization: Math.max(read.utilization, write.utilization),
            waitSeconds:
              read.waitSeconds !== undefined && write.waitSeconds !== undefined
                ? rate
                  ? (read.waitSeconds * demand.reads +
                      write.waitSeconds * demand.writes) /
                    rate
                  : 0
                : undefined,
            meanSeconds:
              read.meanSeconds !== undefined && write.meanSeconds !== undefined
                ? rate
                  ? (read.meanSeconds * demand.reads +
                      write.meanSeconds * demand.writes) /
                    rate
                  : mean / 1000
                : undefined,
          };
        }
        metrics.push(
          metric(
            'utilization',
            'Service-slot utilization',
            q.utilization,
            'ratio',
            'offered rate × mean service seconds / service slots',
            { offered: equivalentRate, meanMs: mean, servers },
            [
              ...assumptions,
              ...(separateReads
                ? [
                    'Read replicas are modeled as a separate balanced read pool; writes remain on the primary.',
                  ]
                : []),
            ],
            ['Service-slot utilization is not CPU utilization.'],
            provenance,
          ),
        );
        const poisson = scenario.trafficClasses.every(
          (t) => t.arrivals === 'poisson' && !t.bursts.length,
        );
        const exponential =
          profile.serviceTime?.kind === 'exponential' &&
          !profile.cpuSecondsPerOperation;
        const wait = metric(
          'queue-wait',
          'Mean queue wait',
          poisson && exponential
            ? q.waitSeconds === undefined
              ? undefined
              : q.waitSeconds * 1000
            : undefined,
          'ms',
          'Erlang-C × mean service time / (servers × (1 − utilization))',
          { offered: equivalentRate, servers, meanMs: mean },
          [
            'M/M/c: Poisson arrivals, independent exponential service, FCFS, infinite buffer, stationary load.',
          ],
          [
            'Transformed downstream arrivals may violate independence; validate using simulation.',
          ],
          provenance,
        );
        if (q.utilization >= 1) wait.status = 'unstable';
        metrics.push(wait);
        const latency = profile.capacityCurve.length
          ? curveLatency(profile, rate)
          : poisson && exponential && q.meanSeconds !== undefined
            ? q.meanSeconds * 1000
            : undefined;
        metrics.push(
          metric(
            'mean-latency',
            'Local mean latency',
            latency,
            'ms',
            profile.capacityCurve.length
              ? 'Linear interpolation within measured curve range'
              : 'mean queue wait + mean local service time',
            { rate, meanMs: mean },
            assumptions,
            [
              'Local latency excludes downstream dependencies; end-to-end latency requires simulation.',
            ],
            provenance,
          ),
        );
        const replicas =
          profile.scaling === 'linear' &&
          profile.model !== 'database' &&
          !(
            profile.cpuSecondsPerOperation &&
            profile.cpuCores &&
            (rate * profile.cpuSecondsPerOperation) / profile.cpuCores >
              profile.targetUtilization
          )
            ? Math.max(
                1,
                Math.ceil(
                  (equivalentRate * mean) /
                    1000 /
                    (profile.concurrency * profile.targetUtilization),
                ),
              )
            : undefined;
        metrics.push(
          metric(
            'required-replicas',
            'Required replicas',
            replicas !== undefined && replicas <= profile.maxReplicas
              ? replicas
              : undefined,
            'replicas',
            'ceil(rate × mean service seconds / (concurrency × target utilization))',
            { rate: equivalentRate, target: profile.targetUtilization },
            [
              'Requires declared homogeneous linear scaling; excludes shared bottlenecks.',
            ],
            replicas && replicas > profile.maxReplicas
              ? ['No solution within configured replica bounds.']
              : [],
            provenance,
          ),
        );
      } else if (profile.model !== 'router' && profile.model !== 'queue') {
        metrics.push(
          metric(
            'mean-latency',
            'Local measured latency',
            curveLatency(profile, rate),
            'ms',
            'Linear interpolation within measured curve range',
            { rate },
            assumptions,
            [
              'Curve values are never extrapolated. Utilization and service times cannot be inferred from end-to-end latency.',
            ],
            provenance,
          ),
        );
        if (!profile.capacityCurve.length)
          report.coverage.push({
            nodeId: node.id,
            message: 'Service time or measured capacity curve is required.',
          });
      }
      if (profile.cpuSecondsPerOperation !== undefined && profile.cpuCores)
        metrics.push(
          metric(
            'cpu',
            'CPU utilization',
            (rate * profile.cpuSecondsPerOperation) / profile.cpuCores,
            'ratio',
            'rate × CPU seconds per operation / allocated cores',
            {
              rate,
              demand: profile.cpuSecondsPerOperation,
              cores: profile.cpuCores,
            },
            assumptions,
            [],
            provenance,
          ),
        );
      if (profile.storageBytes)
        metrics.push(
          metric(
            'storage',
            'Retained new-write utilization (lower bound)',
            unknownStorage.has(node.id)
              ? undefined
              : demand.storage / profile.storageBytes,
            'ratio',
            'retained write bytes / allocated storage bytes',
            { retainedBytes: demand.storage, capacity: profile.storageBytes },
            [
              'Object creation workload. Excludes preexisting data; this is a lower bound, not a claim of free storage. Storage overhead is not inferred.',
            ],
            [],
            provenance,
          ),
        );
      if (profile.model === 'cache')
        metrics.push(
          metric(
            'cache-hit',
            'Declared cache hit ratio',
            profile.cacheHitRatio,
            'ratio',
            'User supplied measured or assumed ratio',
            {},
            assumptions,
            ['Hit ratio is not derived from cache memory.'],
            provenance,
          ),
        );
      if (profile.model === 'queue') {
        let completionFraction = 1;
        let known = true;
        let consumers = 0;
        for (const e of document.edges.filter(
          (e) => e.source.nodeId === node.id,
        )) {
          const consumer = document.performanceProfiles.find(
            (p) => p.nodeId === e.target.nodeId,
          );
          const service = consumer && meanServiceMs(consumer);
          consumers++;
          if (!consumer || !service) known = false;
          else {
            const offered = rates.get(e.target.nodeId)!;
            const demand = offered.reads + offered.writes;
            let capacity =
              (consumer.concurrency *
                (consumer.model !== 'database' && consumer.scaling === 'linear'
                  ? consumer.replicas
                  : 1) *
                1000) /
              service;
            if (consumer.cpuSecondsPerOperation && consumer.cpuCores)
              capacity = Math.min(
                capacity,
                consumer.cpuCores / consumer.cpuSecondsPerOperation,
              );
            if (demand)
              completionFraction = Math.min(
                completionFraction,
                capacity / demand,
              );
          }
        }
        const consumption = rate * Math.min(1, completionFraction);
        metrics.push(
          metric(
            'backlog-growth',
            'Backlog growth',
            known && consumers ? Math.max(0, rate - consumption) : undefined,
            'messages/s',
            'max(0, producer rate − consumer service capacity)',
            { offered: rate, consumerCapacity: consumption },
            [
              'Offered work shares declared consumer pools. The limiting consumer completion fraction bounds broker acknowledgement capacity.',
            ],
            [
              'Approximation assumes shared FCFS workload and fixed routing. Use simulation for independent broadcast-group dynamics, retries and retention.',
            ],
            provenance,
          ),
        );
      }
    }
    const bottleneck = metrics.some(
      (m) =>
        (m.id === 'utilization' || m.id === 'cpu' || m.id === 'storage') &&
        m.value !== undefined &&
        m.value >= 1,
    );
    report.nodes.push({ nodeId: node.id, metrics, bottleneck });
  }
  report.assumptions = [
    'Analytical offered-load model. Finite queues, bursts, joins and timeouts require the discrete-event engine.',
  ];
  report.assumptions.push(
    scenario.assumptions,
    'Analytical rates exclude additional time-varying burst intervals. Inspect the simulation for transient demand and recovery.',
  );
  for (const m of [
    ...report.metrics,
    ...report.nodes.flatMap((n) => n.metrics),
  ])
    m.assumptions.push(...report.assumptions);
  if (report.coverage.length) report.status = 'partial';
  return report;
}
