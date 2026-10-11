import type {
  ArchitectureDocument,
  Scenario,
  TrafficClass,
  PerformanceProfile,
  SimulationOptions,
  FlowPolicy,
} from '@swiftbuild/architecture-schema';
import {
  reportFor,
  scenarioFor,
  rateFor,
  policyFor,
  topologyOrder,
  meanServiceMs,
} from './workload';
import { metric, type CapacityReport } from './types';
import { randomFor } from './random';
export { randomFor } from './random';

type Event = { time: number; sequence: number; action: () => void };
class EventQueue {
  heap: Event[] = [];
  less(a: Event, b: Event) {
    return a.time < b.time || (a.time === b.time && a.sequence < b.sequence);
  }
  push(e: Event) {
    const h = this.heap;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }
  pop(): Event | undefined {
    const h = this.heap;
    if (!h.length) return undefined;
    const first = h[0]!,
      last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let next = i;
        if (l < h.length && this.less(h[l]!, h[next]!)) next = l;
        if (r < h.length && this.less(h[r]!, h[next]!)) next = r;
        if (next === i) break;
        [h[i], h[next]] = [h[next]!, h[i]!];
        i = next;
      }
    }
    return first;
  }
}
export function sampleService(
  profile: PerformanceProfile,
  random: () => number,
): number | undefined {
  const d = profile.serviceTime;
  if (!d) return undefined;
  if (d.kind === 'constant') return d.meanMs / 1000;
  if (d.kind === 'exponential')
    return (-Math.log(1 - random()) * d.meanMs) / 1000;
  return d.samplesMs[Math.floor(random() * d.samplesMs.length)]! / 1000;
}
export type SimulationControl = Partial<SimulationOptions> & {
  shouldCancel?: () => boolean;
  onProgress?: (progress: {
    replication: number;
    replications: number;
    events: number;
    seconds: number;
  }) => void;
  yieldControl?: () => Promise<void>;
};
type Job = {
  traffic: TrafficClass;
  read: boolean;
  arrived: number;
  done: (outcome: 'completed' | 'failed' | 'dropped') => void;
};
type NodeState = {
  observedArrivals: number;
  observedCompletions: number;
  busy: number;
  busyReads: number;
  busyWrites: number;
  readBusySeconds: number;
  writeBusySeconds: number;
  deadLettered: number;
  cpuBusy: number;
  cpuBusySeconds: number;
  cpuPending: (() => void)[];
  peakMemoryBytes: number;
  pending: Job[];
  arrived: number;
  completed: number;
  failed: number;
  dropped: number;
  waitMs: number[];
  latenciesMs: number[];
  busySeconds: number;
  lastTime: number;
  peakQueue: number;
  queueDepth: number;
};
type Replication = {
  traffic: Map<string, { latencies: number[]; completed: number }>;
  accounting: NonNullable<CapacityReport['accounting']>;
  series: NonNullable<CapacityReport['series']>;
  states: Map<string, NodeState>;
  latencies: number[];
  measuredCompleted: number;
  deadlineViolations: number;
  events: number;
  observedSeconds: number;
  ended: boolean;
  cancelled: boolean;
};

function rateAt(t: TrafficClass, s: Scenario, time: number): number {
  const burst = t.bursts.find(
    (b) => time >= b.startSeconds && time < b.startSeconds + b.durationSeconds,
  );
  return rateFor(t, s) * (burst?.multiplier ?? 1);
}
function nextArrival(
  t: TrafficClass,
  s: Scenario,
  from: number,
  end: number,
  random: () => number,
): number | undefined {
  let hazard = t.arrivals === 'poisson' ? -Math.log(1 - random()) : 1;
  let time = from;
  const boundaries = [
    ...new Set(
      t.bursts
        .flatMap((b) => [b.startSeconds, b.startSeconds + b.durationSeconds])
        .filter((v) => v > from && v < end),
    ),
  ].sort((a, b) => a - b);
  for (const boundary of [...boundaries, end]) {
    const rate = rateAt(t, s, time);
    const available = (boundary - time) * rate;
    if (rate > 0 && hazard < available) return time + hazard / rate;
    hazard -= available;
    time = boundary;
  }
  return undefined;
}
function percentile(values: number[], q: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}
function average(values: number[]): number | undefined {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : undefined;
}

async function runReplication(
  document: ArchitectureDocument,
  scenario: Scenario,
  options: SimulationOptions,
  control: SimulationControl,
  replication: number,
  remainingEvents: number,
  deadline: number,
): Promise<Replication> {
  const random = randomFor(options.seed, replication);
  const events = new EventQueue();
  let sequence = 0,
    now = 0,
    processed = 0,
    cancelled = false;
  let budgetReached = false;
  const end = options.warmupSeconds + options.durationSeconds;
  const states = new Map(
    document.nodes.map((n) => [
      n.id,
      {
        busy: 0,
        busyReads: 0,
        busyWrites: 0,
        readBusySeconds: 0,
        writeBusySeconds: 0,
        deadLettered: 0,
        cpuBusy: 0,
        cpuBusySeconds: 0,
        cpuPending: [],
        peakMemoryBytes: 0,
        pending: [],
        arrived: 0,
        observedArrivals: 0,
        observedCompletions: 0,
        completed: 0,
        failed: 0,
        dropped: 0,
        waitMs: [],
        latenciesMs: [],
        busySeconds: 0,
        lastTime: 0,
        peakQueue: 0,
        queueDepth: 0,
      } as NodeState,
    ]),
  );
  const profiles = new Map(
    document.performanceProfiles.map((p) => [p.nodeId, p]),
  );
  const categories = new Map(
    document.nodes.map((n) => [
      n.id,
      document.components.find((c) => c.id === n.componentId)!.category,
    ]),
  );
  const accounting = {
    offered: 0,
    admitted: 0,
    completed: 0,
    failed: 0,
    dropped: 0,
    outstanding: 0,
  };
  const latencies: number[] = [];
  const trafficResults = new Map(
    scenario.trafficClasses.map((t) => [
      t.id,
      { latencies: [] as number[], completed: 0 },
    ]),
  );
  let measuredCompleted = 0,
    deadlineViolations = 0;
  const series: Replication['series'] = [];
  const links = new Map<string, number>();
  const schedule = (time: number, action: () => void) => {
    if (time > end) return;
    if (sequence >= remainingEvents || events.heap.length >= 100000) {
      budgetReached = true;
      return;
    }
    events.push({ time, sequence: sequence++, action });
  };
  const slots = (profile: PerformanceProfile) =>
    profile.concurrency *
    (profile.model !== 'database' && profile.scaling === 'linear'
      ? profile.replicas
      : 1);
  const trackBusy = (state: NodeState) => {
    const duration = Math.max(
      0,
      now - Math.max(state.lastTime, options.warmupSeconds),
    );
    state.readBusySeconds += state.busyReads * duration;
    state.writeBusySeconds += state.busyWrites * duration;
    state.cpuBusySeconds += state.cpuBusy * duration;
    state.busySeconds +=
      state.busy *
      Math.max(0, now - Math.max(state.lastTime, options.warmupSeconds));
    state.lastTime = now;
  };
  function route(nodeId: string, job: Job, callback: Job['done']) {
    const policies = document.edges
      .filter((e) => e.source.nodeId === nodeId)
      .map((edge) => ({
        edge,
        policy: policyFor(document, edge.id, job.traffic.id),
      }));
    const selected: { edgeId: string; target: string; policy: FlowPolicy }[] =
      [];
    const cacheOutcomes = new Map<string, boolean>();
    const competing = new Map<string, typeof policies>();
    for (const item of policies) {
      const p = item.policy;
      if (!p) {
        callback('failed');
        return;
      }
      if (
        (p.operation === 'read' && !job.read) ||
        (p.operation === 'write' && job.read)
      )
        continue;
      if (
        (p.operation === 'cache-miss' || p.operation === 'cache-aside') &&
        job.read
      ) {
        if (!cacheOutcomes.has(p.cacheNodeId!))
          cacheOutcomes.set(
            p.cacheNodeId!,
            random() >= profiles.get(p.cacheNodeId!)!.cacheHitRatio!,
          );
        if (!cacheOutcomes.get(p.cacheNodeId!)) continue;
      }
      if (p.operation === 'cache-miss' && !job.read) continue;
      if (
        p.routing === 'exclusive' ||
        (categories.get(nodeId) === 'messaging' && p.delivery === 'competing')
      ) {
        const groupKey = JSON.stringify([
          p.group,
          p.operation,
          p.cacheNodeId ?? null,
        ]);
        competing.set(groupKey, [...(competing.get(groupKey) ?? []), item]);
        continue;
      }
      let calls = Math.floor(p.callsPerOperation);
      if (random() < p.callsPerOperation - calls) calls++;
      for (let c = 0; c < calls; c++)
        if (selected.length >= 100000) {
          budgetReached = true;
          return;
        } else if (random() < p.fraction)
          selected.push({
            edgeId: item.edge.id,
            target: item.edge.target.nodeId,
            policy: p,
          });
    }
    for (const group of competing.values()) {
      const draw = random();
      let cumulative = 0;
      for (const item of group) {
        cumulative += item.policy!.fraction;
        if (draw < cumulative) {
          const p = item.policy!;
          let calls = Math.floor(p.callsPerOperation);
          if (random() < p.callsPerOperation - calls) calls++;
          for (let c = 0; c < calls; c++)
            selected.push({
              edgeId: item.edge.id,
              target: item.edge.target.nodeId,
              policy: p,
            });
          break;
        }
      }
    }
    const groups = new Map<number, typeof selected>();
    for (const item of selected) {
      if (
        item.policy.execution === 'async' &&
        profiles.get(nodeId)?.model !== 'queue'
      )
        invoke(item, job, () => {});
      else
        groups.set(item.policy.order, [
          ...(groups.get(item.policy.order) ?? []),
          item,
        ]);
    }
    const stages = [...groups].sort(([a], [b]) => a - b);
    const runStage = (index: number) => {
      if (index >= stages.length) {
        callback('completed');
        return;
      }
      const items = stages[index]![1];
      const sequential = items.filter(
        (i) => i.policy.execution === 'sequential',
      );
      const parallel = items.filter(
        (i) =>
          i.policy.execution === 'parallel' || i.policy.execution === 'async',
      );
      const runSequential = (i: number) => {
        if (i >= sequential.length) {
          if (!parallel.length) {
            runStage(index + 1);
            return;
          }
          let left = parallel.length,
            failed = false;
          for (const item of parallel)
            invoke(item, job, (outcome) => {
              if (outcome !== 'completed') failed = true;
              if (--left === 0) {
                if (failed) callback('failed');
                else runStage(index + 1);
              }
            });
          return;
        }
        invoke(sequential[i]!, job, (outcome) => {
          if (outcome === 'completed') runSequential(i + 1);
          else callback(outcome);
        });
      };
      runSequential(0);
    };
    runStage(0);
  }
  function invoke(
    item: { edgeId: string; target: string; policy: FlowPolicy },
    parent: Job,
    done: Job['done'],
  ) {
    const p = item.policy;
    const attempt = (retry: number) => {
      let settled = false;
      const finish: Job['done'] = (result) => {
        if (settled) return;
        settled = true;
        const outcome =
          result === 'completed' && random() < p.retryProbability
            ? 'failed'
            : result;
        if (outcome !== 'completed' && retry < p.maxRetries)
          schedule(now + p.retryBackoffMs / 1000, () => attempt(retry + 1));
        else done(outcome);
      };
      let dispatch = now + p.networkLatencyMs / 1000;
      if (p.linkBytesPerSecond) {
        dispatch =
          Math.max(dispatch, links.get(item.edgeId) ?? 0) +
          ((parent.traffic.payloadBytes ?? 0) +
            (parent.traffic.responseBytes ?? 0)) /
            p.linkBytesPerSecond;
        links.set(item.edgeId, dispatch);
      }
      schedule(dispatch, () =>
        arrive(item.target, { ...parent, arrived: now, done: finish }),
      );
      if (p.timeoutMs)
        schedule(now + p.timeoutMs / 1000, () => finish('failed'));
    };
    attempt(0);
  }
  function arrive(nodeId: string, job: Job) {
    const originalDone = job.done;
    let settled = false;
    job = {
      ...job,
      done: (outcome) => {
        if (settled) return;
        settled = true;
        originalDone(outcome);
      },
    };
    const state = states.get(nodeId)!,
      profile = profiles.get(nodeId);
    state.arrived++;
    if (now >= options.warmupSeconds) state.observedArrivals++;
    if (categories.get(nodeId) === 'client' || profile?.model === 'router') {
      route(nodeId, job, job.done);
      return;
    }
    if (!profile) {
      state.failed++;
      job.done('failed');
      return;
    }
    if (profile.model === 'queue') {
      if (state.queueDepth >= profile.queue!.bufferMessages) {
        state.dropped++;
        job.done('dropped');
        return;
      }
      state.queueDepth++;
      state.peakQueue = Math.max(state.peakQueue, state.queueDepth);
      let acked = false;
      const ack = () => {
        if (!acked) {
          acked = true;
          state.queueDepth--;
        }
      };
      if (profile.queue!.acknowledgement === 'on-admission') ack();
      schedule(now + profile.queue!.retentionSeconds, () => {
        if (!acked) {
          ack();
          state.dropped++;
          job.done('dropped');
        }
      });
      const queuedAt = now;
      route(nodeId, job, (outcome) => {
        const expired =
          acked && profile.queue!.acknowledgement === 'on-completion';
        ack();
        if (expired) {
          job.done('dropped');
          return;
        }
        if (outcome === 'completed') {
          state.completed++;
          if (now >= options.warmupSeconds) state.observedCompletions++;
        } else if (profile.queue!.deadLetter) state.deadLettered++;
        else state.failed++;
        if (queuedAt >= options.warmupSeconds)
          state.latenciesMs.push((now - queuedAt) * 1000);
        job.done(outcome);
      });
      return;
    }
    if (!profile.serviceTime) {
      state.failed++;
      job.done('failed');
      return;
    }
    state.pending.push(job);
    drain(nodeId);
    state.peakQueue = Math.max(state.peakQueue, state.pending.length);
  }
  function drain(nodeId: string) {
    const state = states.get(nodeId)!,
      profile = profiles.get(nodeId)!;
    const separateReads =
      profile.model === 'database' && profile.readReplicas > 0;
    while (state.pending.length) {
      if (
        profile.memoryBytesPerOperation &&
        profile.memoryBytes &&
        (state.busy + 1) * profile.memoryBytesPerOperation > profile.memoryBytes
      )
        break;
      const index = separateReads
        ? state.pending.findIndex((job) =>
            job.read
              ? state.busyReads < profile.concurrency * profile.readReplicas
              : state.busyWrites < profile.concurrency,
          )
        : state.busy < slots(profile)
          ? 0
          : -1;
      if (index < 0) break;
      const job = state.pending.splice(index, 1)[0]!;
      trackBusy(state);
      state.busy++;
      state.peakMemoryBytes = Math.max(
        state.peakMemoryBytes,
        state.busy * (profile.memoryBytesPerOperation ?? 0),
      );
      if (job.read) state.busyReads++;
      else state.busyWrites++;
      if (now >= options.warmupSeconds)
        state.waitMs.push((now - job.arrived) * 1000);
      const duration = sampleService(profile, random)!;
      const finishLocal = () => {
        trackBusy(state);
        state.busy--;
        if (job.read) state.busyReads--;
        else state.busyWrites--;
        route(nodeId, job, (outcome) => {
          if (outcome === 'completed') {
            state.completed++;
            if (now >= options.warmupSeconds) state.observedCompletions++;
          } else state.failed++;
          if (job.arrived >= options.warmupSeconds)
            state.latenciesMs.push((now - job.arrived) * 1000);
          job.done(outcome);
        });
        drain(nodeId);
      };
      if (
        profile.cpuSecondsPerOperation &&
        profile.cpuCores &&
        profile.serviceTimeScope === 'non-cpu'
      ) {
        state.cpuPending.push(() => schedule(now + duration, finishLocal));
        drainCpu(nodeId);
      } else schedule(now + duration, finishLocal);
    }
  }
  function drainCpu(nodeId: string) {
    const state = states.get(nodeId)!,
      profile = profiles.get(nodeId)!;
    const processors = Math.ceil(profile.cpuCores!);
    const coreFraction = profile.cpuCores! / processors;
    while (state.cpuBusy < processors && state.cpuPending.length) {
      const continuation = state.cpuPending.shift()!;
      trackBusy(state);
      state.cpuBusy++;
      schedule(now + profile.cpuSecondsPerOperation! / coreFraction, () => {
        trackBusy(state);
        state.cpuBusy--;
        continuation();
        drainCpu(nodeId);
      });
    }
  }
  function offer(traffic: TrafficClass) {
    accounting.offered++;
    accounting.admitted++;
    accounting.outstanding++;
    const started = now;
    let finished = false;
    arrive(traffic.entryNodeId, {
      traffic,
      read: random() < traffic.readFraction,
      arrived: now,
      done: (outcome) => {
        if (finished) return;
        finished = true;
        accounting.outstanding--;
        accounting[outcome]++;
        if (outcome === 'dropped') accounting.admitted--;
        if (outcome === 'completed' && now >= options.warmupSeconds) {
          measuredCompleted++;
          trafficResults.get(traffic.id)!.completed++;
        }
        if (outcome === 'completed' && started >= options.warmupSeconds) {
          const ms = (now - started) * 1000;
          latencies.push(ms);
          trafficResults.get(traffic.id)!.latencies.push(ms);
          if (
            scenario.targets.some(
              (t) =>
                t.metric === 'deadline' &&
                (!t.trafficClassId || t.trafficClassId === traffic.id) &&
                ms > t.value,
            )
          )
            deadlineViolations++;
        }
      },
    });
    const next = nextArrival(traffic, scenario, now, end, random);
    if (next !== undefined) schedule(next, () => offer(traffic));
  }
  for (const traffic of scenario.trafficClasses) {
    const next = nextArrival(traffic, scenario, 0, end, random);
    if (next !== undefined) schedule(next, () => offer(traffic));
  }
  const seriesStep = Math.max(1, options.durationSeconds / 120);
  for (let at = options.warmupSeconds; at <= end; at += seriesStep)
    schedule(at, () => {
      series.push({
        seconds: now - options.warmupSeconds,
        completed: measuredCompleted,
        outstanding: accounting.outstanding,
        queueDepth: [...states.values()].reduce(
          (n, s) => n + s.queueDepth + s.pending.length,
          0,
        ),
        dropped: accounting.dropped,
      });
    });
  while (
    events.heap.length &&
    !budgetReached &&
    processed < remainingEvents &&
    Date.now() < deadline
  ) {
    if (control.shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const event = events.pop()!;
    now = event.time;
    event.action();
    processed++;
    if (processed % 5000 === 0) {
      control.onProgress?.({
        replication: replication + 1,
        replications: options.replications,
        events: processed,
        seconds: now,
      });
      await (control.yieldControl?.() ??
        new Promise<void>((resolve) => setTimeout(resolve, 0)));
    }
  }
  const ended = !events.heap.length && !budgetReached;
  if (ended) now = end;
  for (const state of states.values()) trackBusy(state);
  return {
    traffic: trafficResults,
    accounting,
    states,
    series,
    latencies,
    measuredCompleted,
    deadlineViolations,
    events: processed,
    observedSeconds: Math.max(0, now - options.warmupSeconds),
    ended,
    cancelled,
  };
}
export async function simulateTopology(
  document: ArchitectureDocument,
  scenarioId: string,
  control: SimulationControl = {},
): Promise<CapacityReport> {
  const scenario = structuredClone(scenarioFor(document, scenarioId));
  document = structuredClone(document);
  const compareIds = (a: { id: string }, b: { id: string }) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  document.nodes.sort(compareIds);
  document.edges.sort(compareIds);
  document.performanceProfiles.sort(compareIds);
  for (const profile of document.performanceProfiles)
    if (profile.serviceTime?.kind === 'empirical')
      profile.serviceTime.samplesMs.sort((a, b) => a - b);
  scenario.trafficClasses = [...scenario.trafficClasses].sort((a, b) =>
    compareIds(a, b),
  );
  const options = { ...document.engineering.simulation, ...control };
  // Validate execution overrides using the same contract as persisted settings.
  const { EngineeringSettingsSchema } =
    await import('@swiftbuild/architecture-schema');
  const valid = EngineeringSettingsSchema.parse({
    simulation: options,
  }).simulation;
  document.engineering.simulation = valid;
  const report = reportFor(document, scenarioId, 'simulation');
  report.runSettings = valid;
  const coverage: CapacityReport['coverage'] = [];
  if (!topologyOrder(document))
    coverage.push({
      message:
        'Recursive topology cycles are unsupported. Use bounded retry policies instead.',
    });
  for (const n of document.nodes) {
    const category = document.components.find(
      (c) => c.id === n.componentId,
    )!.category;
    const p = document.performanceProfiles.find((v) => v.nodeId === n.id);
    if (
      category !== 'client' &&
      category !== 'boundary' &&
      (!p || (p.model !== 'router' && p.model !== 'queue' && !p.serviceTime))
    )
      coverage.push({
        nodeId: n.id,
        message:
          'A service-time distribution is required for simulation. Capacity curves alone do not identify a service distribution.',
      });
    if (p?.queue?.initialMessages)
      coverage.push({
        nodeId: n.id,
        message:
          'Initial queue messages require traffic-class attribution. This model does not invent a workload for unattributed backlog.',
      });
    if (
      p?.cpuSecondsPerOperation &&
      (!p.cpuCores || p.serviceTimeScope !== 'non-cpu')
    )
      coverage.push({
        nodeId: n.id,
        message:
          'Coupled CPU simulation requires allocated cores and explicitly measured/assumed non-CPU delay. Total latency cannot identify CPU and I/O phases.',
      });
    if (
      p?.memoryBytesPerOperation &&
      (!p.memoryBytes || p.memoryBytesPerOperation > p.memoryBytes)
    )
      coverage.push({
        nodeId: n.id,
        message:
          'Memory allocation is missing or cannot admit one operation under the declared per-operation memory demand.',
      });
    if (
      p?.model === 'queue' &&
      !document.edges.some((e) => e.source.nodeId === n.id)
    )
      coverage.push({
        nodeId: n.id,
        message:
          'Queue delivery requires an explicit consumer connection and policy.',
      });
    const queueGroups = new Map<string, number>();
    for (const e of document.edges.filter((e) => e.source.nodeId === n.id))
      for (const t of scenario.trafficClasses) {
        const policy = policyFor(document, e.id, t.id);
        if (
          policy?.linkBytesPerSecond &&
          (t.payloadBytes === undefined || t.responseBytes === undefined)
        )
          coverage.push({
            edgeId: e.id,
            message: `Link serialization requires declared request and response payload sizes for ${t.name}.`,
          });
        if (!policy)
          coverage.push({
            edgeId: e.id,
            message: `Missing flow policy for ${t.name}.`,
          });
        if (
          policy &&
          (policy.routing === 'exclusive' ||
            (p?.model === 'queue' && policy.delivery === 'competing'))
        ) {
          const key = JSON.stringify([
            t.id,
            policy.group,
            policy.operation,
            policy.cacheNodeId ?? null,
          ]);
          queueGroups.set(key, (queueGroups.get(key) ?? 0) + policy.fraction);
        }
      }
    if ([...queueGroups.values()].some((sum) => Math.abs(sum - 1) > 1e-9))
      coverage.push({
        nodeId: n.id,
        message:
          'Competing consumer fractions must sum to one within each traffic class and group.',
      });
  }
  if (coverage.length) {
    report.coverage = coverage;
    report.status = 'partial';
    report.nodes = document.nodes
      .filter(
        (n) =>
          document.components.find((c) => c.id === n.componentId)?.category !==
          'boundary',
      )
      .map((n) => ({
        nodeId: n.id,
        bottleneck: false,
        metrics: [
          metric(
            'arrival',
            'Observed demand',
            undefined,
            'ops/s',
            'Not evaluated because the declared model is incomplete.',
            {},
            [scenario.assumptions],
            coverage
              .filter(
                (c) =>
                  c.nodeId === n.id ||
                  (!c.nodeId && !c.edgeId) ||
                  (c.edgeId &&
                    document.edges.some(
                      (e) =>
                        e.id === c.edgeId &&
                        (e.source.nodeId === n.id || e.target.nodeId === n.id),
                    )),
              )
              .map((c) => c.message),
          ),
          metric(
            'utilization',
            'Service-slot utilization',
            undefined,
            'ratio',
            'Not evaluated because the declared model is incomplete.',
            {},
            [scenario.assumptions],
          ),
        ],
      }));
    return report;
  }
  const replications: Replication[] = [];
  const deadline = Date.now() + valid.maxWallTimeMs;
  let used = 0;
  for (let i = 0; i < valid.replications; i++) {
    const r = await runReplication(
      document,
      scenario,
      valid,
      control,
      i,
      valid.maxEvents - used,
      deadline,
    );
    replications.push(r);
    used += r.events;
    if (!r.ended) {
      report.status = r.cancelled ? 'cancelled' : 'partial';
      report.coverage.push({
        message: r.cancelled
          ? 'Simulation cancelled. Partial results are not a completed assessment.'
          : 'Execution budget reached. Increase the budget or reduce the workload/window; results are incomplete.',
      });
      break;
    }
  }
  report.seed = valid.seed;
  report.replications = replications.length;
  report.processedEvents = used;
  report.accounting = replications[0]!.accounting;
  report.series = replications[0]!.series;
  const throughput = replications.map((r) =>
    r.observedSeconds ? r.measuredCompleted / r.observedSeconds : 0,
  );
  const latencyValues = replications.flatMap((r) => r.latencies);
  const assumptions = [
    scenario.assumptions,
    'Declared service slots model local processing contention; slots release before downstream dependencies.',
    'Random failures use declared independent probabilities. Timeouts do not cancel downstream work.',
    'Intervals describe simulation sampling uncertainty, not accuracy of the supplied model.',
    'When CPU demand is separately declared, CPU centers execute first and non-CPU delay follows. Declared memory is reserved during local processing, including CPU wait.',
  ];
  report.assumptions = [
    ...assumptions,
    ...document.performanceProfiles.map(
      (p) =>
        `${p.nodeId}: ${p.provenance.kind} evidence from ${p.provenance.source}; ${p.provenance.context}. ${p.provenance.limitations}`,
    ),
  ];
  report.metrics = [
    metric(
      'deadline',
      'Maximum observed foreground latency',
      latencyValues.length
        ? latencyValues.reduce((maximum, value) => Math.max(maximum, value), 0)
        : undefined,
      'ms',
      'maximum duration among completed observed foreground requests',
      {},
      assumptions,
      [
        'Right-censored, failed and dropped requests prevent a positive strict-deadline assessment.',
      ],
    ),
    metric(
      'throughput',
      'Completed foreground throughput',
      average(throughput),
      'ops/s',
      'completed foreground requests in observation window / observed seconds',
      {},
      assumptions,
    ),
    metric(
      'mean-latency',
      'Mean foreground latency',
      average(latencyValues),
      'ms',
      'mean completed request duration',
      {},
      assumptions,
    ),
    metric(
      'p95-latency',
      'P95 foreground latency',
      percentile(latencyValues, 0.95),
      'ms',
      'nearest-rank 95th percentile of completed request durations',
      {},
      assumptions,
      [
        'Only completed requests are sampled; inspect drops and outstanding work.',
      ],
    ),
    metric(
      'p99-latency',
      'P99 foreground latency',
      percentile(latencyValues, 0.99),
      'ms',
      'nearest-rank 99th percentile of completed request durations',
      {},
      assumptions,
      ['Small sample counts produce unreliable tail estimates.'],
    ),
    metric(
      'deadline-violations',
      'Completed requests exceeding deadlines',
      scenario.targets.some((t) => t.metric === 'deadline')
        ? replications.reduce((n, r) => n + r.deadlineViolations, 0)
        : undefined,
      'requests',
      'count completed requests exceeding the matching deadline',
      {},
      assumptions,
    ),
  ];
  for (const m of report.metrics) {
    m.inputs = {
      seed: valid.seed,
      replications: replications.length,
      warmupSeconds: valid.warmupSeconds,
      observationSeconds: valid.durationSeconds,
      processedEvents: used,
      completedSamples: latencyValues.length,
    };
    m.sources = document.performanceProfiles.map(
      (p) =>
        `${p.nodeId}: ${p.provenance.kind} · ${p.provenance.source} · ${p.provenance.recordedAt} · ${p.provenance.context}`,
    );
  }
  if (report.status === 'complete' && throughput.length >= 5) {
    const mean = average(throughput)!;
    const variance =
      throughput.reduce((s, v) => s + (v - mean) ** 2, 0) /
      (throughput.length - 1);
    // Conservative Student-t critical value for >= 5 independent replications.
    const margin = 2.776 * Math.sqrt(variance / throughput.length);
    report.metrics.find((m) => m.id === 'throughput')!.interval = {
      lower: Math.max(0, mean - margin),
      upper: mean + margin,
      level: 0.95,
      replications: throughput.length,
    };
  }
  report.traffic = scenario.trafficClasses.map((t) => {
    const values = replications.flatMap((r) => r.traffic.get(t.id)!.latencies);
    const seconds = replications.reduce((n, r) => n + r.observedSeconds, 0);
    return {
      trafficClassId: t.id,
      metrics: [
        metric(
          'throughput',
          `${t.name} · completed throughput`,
          seconds
            ? replications.reduce(
                (n, r) => n + r.traffic.get(t.id)!.completed,
                0,
              ) / seconds
            : undefined,
          'ops/s',
          'completed traffic-class requests / observed seconds',
          {},
          assumptions,
        ),
        metric(
          'mean-latency',
          `${t.name} · mean latency`,
          average(values),
          'ms',
          'mean completed traffic-class duration',
          {},
          assumptions,
        ),
        metric(
          'p95-latency',
          `${t.name} · P95 latency`,
          percentile(values, 0.95),
          'ms',
          'nearest-rank 95th percentile for this traffic class',
          {},
          assumptions,
        ),
        metric(
          'p99-latency',
          `${t.name} · P99 latency`,
          percentile(values, 0.99),
          'ms',
          'nearest-rank 99th percentile for this traffic class',
          {},
          assumptions,
        ),
      ],
    };
  });
  for (const node of document.nodes) {
    const profile = document.performanceProfiles.find(
      (p) => p.nodeId === node.id,
    );
    if (!profile) continue;
    const states = replications.map((r) => r.states.get(node.id)!);
    const seconds = replications.reduce((n, r) => n + r.observedSeconds, 0);
    const capacitySlots =
      profile.concurrency *
      (profile.model !== 'database' && profile.scaling === 'linear'
        ? profile.replicas
        : 1);
    const utilization = seconds
      ? profile.model === 'database' && profile.readReplicas > 0
        ? Math.max(
            states.reduce((n, s) => n + s.readBusySeconds, 0) /
              seconds /
              (profile.concurrency * profile.readReplicas),
            states.reduce((n, s) => n + s.writeBusySeconds, 0) /
              seconds /
              profile.concurrency,
          )
        : states.reduce((n, s) => n + s.busySeconds, 0) /
          seconds /
          capacitySlots
      : undefined;
    report.nodes.push({
      nodeId: node.id,
      bottleneck:
        utilization !== undefined && utilization >= profile.targetUtilization,
      metrics: [
        metric(
          'deadline',
          'Maximum observed node response time',
          states.some((s) => s.latenciesMs.length)
            ? states
                .flatMap((s) => s.latenciesMs)
                .reduce((maximum, value) => Math.max(maximum, value), 0)
            : undefined,
          'ms',
          'maximum completed node duration',
          {},
          assumptions,
        ),
        metric(
          'arrival',
          'Observed node arrivals',
          seconds
            ? states.reduce((n, s) => n + s.observedArrivals, 0) / seconds
            : undefined,
          'ops/s',
          'node arrivals in observation windows / observed seconds',
          {},
          assumptions,
        ),
        metric(
          'throughput',
          'Completed node throughput',
          seconds
            ? states.reduce((n, s) => n + s.observedCompletions, 0) / seconds
            : undefined,
          'ops/s',
          'completed node operations in observation windows / observed seconds',
          {},
          assumptions,
        ),
        metric(
          'cpu',
          'Observed CPU utilization',
          profile.cpuSecondsPerOperation && profile.cpuCores && seconds
            ? states.reduce((n, s) => n + s.cpuBusySeconds, 0) /
                seconds /
                Math.ceil(profile.cpuCores)
            : undefined,
          'ratio',
          'busy virtual CPU seconds / (observation seconds × virtual CPUs)',
          { cores: profile.cpuCores ?? 0 },
          assumptions,
          [
            'Fractional cores are represented by uniformly slower virtual CPUs.',
          ],
        ),
        metric(
          'memory',
          'Peak reserved memory utilization',
          profile.memoryBytesPerOperation && profile.memoryBytes
            ? Math.max(...states.map((s) => s.peakMemoryBytes)) /
                profile.memoryBytes
            : undefined,
          'ratio',
          'peak concurrent local jobs × bytes per operation / allocated bytes',
          {},
          assumptions,
        ),
        metric(
          'p95-latency',
          'P95 node response time',
          percentile(
            states.flatMap((s) => s.latenciesMs),
            0.95,
          ),
          'ms',
          'nearest-rank 95th percentile of completed node durations',
          {},
          assumptions,
        ),
        metric(
          'p99-latency',
          'P99 node response time',
          percentile(
            states.flatMap((s) => s.latenciesMs),
            0.99,
          ),
          'ms',
          'nearest-rank 99th percentile of completed node durations',
          {},
          assumptions,
        ),
        metric(
          'dead-lettered',
          'Dead-letter outcomes',
          states.reduce((n, s) => n + s.deadLettered, 0),
          'messages',
          'failed consumer outcomes sent to configured dead-letter handling',
          {},
          assumptions,
        ),
        metric(
          'utilization',
          'Service-slot utilization',
          profile.model === 'queue' || profile.model === 'router'
            ? undefined
            : utilization,
          'ratio',
          'busy slot seconds / (observation seconds × service slots)',
          {},
          assumptions,
          [],
          [profile.provenance.source],
        ),
        metric(
          'mean-latency',
          'Mean node response time',
          average(states.flatMap((s) => s.latenciesMs)),
          'ms',
          'mean node duration including synchronous downstream work',
          {},
          assumptions,
        ),
        metric(
          'queue-wait',
          'Mean local queue wait',
          average(states.flatMap((s) => s.waitMs)),
          'ms',
          'mean time waiting for a service slot',
          {},
          assumptions,
        ),
        metric(
          'queue-depth',
          'Peak local queue depth',
          Math.max(...states.map((s) => s.peakQueue)),
          'messages',
          'maximum observed waiting queue or unacknowledged broker messages',
          {},
          assumptions,
        ),
        metric(
          'dropped',
          'Node drops',
          states.reduce((n, s) => n + s.dropped, 0),
          'operations',
          'buffer or retention drops across replications',
          {},
          assumptions,
        ),
      ],
    });
    for (const m of report.nodes.at(-1)!.metrics) {
      m.inputs = {
        ...m.inputs,
        concurrency: profile.concurrency,
        replicas: profile.replicas,
        readReplicas: profile.readReplicas,
        observedSeconds: seconds,
        ...(meanServiceMs(profile) === undefined
          ? {}
          : { meanLocalServiceMs: meanServiceMs(profile)! }),
      };
      m.sources = [
        profile.provenance.source,
        profile.provenance.recordedAt,
        profile.provenance.context,
      ];
      m.assumptions.push(
        `Evidence classification: ${profile.provenance.kind}.`,
      );
      if (profile.provenance.limitations)
        m.limitations.push(profile.provenance.limitations);
    }
  }
  return report;
}
