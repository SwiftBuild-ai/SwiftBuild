import { z } from 'zod';

const id = z.string().min(1).max(128);
const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
const fraction = z.number().finite().min(0).max(1);
export const ProvenanceSchema = z.object({
  kind: z.enum(['measured', 'assumed', 'illustrative']),
  source: z.string().trim().min(1),
  recordedAt: z.string().datetime(),
  context: z.string().trim().min(1),
  limitations: z.string().default(''),
});
export const DistributionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constant'), meanMs: positive }),
  z.object({ kind: z.literal('exponential'), meanMs: positive }),
  z.object({
    kind: z.literal('empirical'),
    samplesMs: z.array(positive).min(2).max(10000),
  }),
]);
export const TrafficClassSchema = z.object({
  id,
  name: z.string().min(1),
  entryNodeId: id,
  workload: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('rate'), requestsPerSecond: nonnegative }),
    z.object({
      kind: z.literal('users'),
      dailyActiveUsers: nonnegative,
      requestsPerUserPerDay: nonnegative,
    }),
  ]),
  arrivals: z.enum(['constant', 'poisson']).default('poisson'),
  readFraction: fraction.default(1),
  payloadBytes: nonnegative.optional(),
  responseBytes: nonnegative.optional(),
  objectBytes: nonnegative.optional(),
  cacheWorkingSetObjects: nonnegative.optional(),
  cacheEntryOverheadBytes: nonnegative.default(0),
  retentionDays: nonnegative.optional(),
  peakMultiplier: positive.default(1),
  bursts: z
    .array(
      z.object({
        startSeconds: nonnegative,
        durationSeconds: positive,
        multiplier: positive,
      }),
    )
    .default([]),
});
export const TargetSchema = z
  .object({
    id,
    nodeId: id.optional(),
    trafficClassId: id.optional(),
    metric: z.enum([
      'throughput',
      'mean-latency',
      'p95-latency',
      'p99-latency',
      'utilization',
      'queue-depth',
      'deadline',
    ]),
    comparator: z.enum(['at-most', 'at-least']),
    value: nonnegative,
    unit: z.enum(['ops/s', 'ms', 'ratio', 'messages']),
  })
  .superRefine((t, ctx) => {
    const expected =
      t.metric === 'throughput'
        ? 'ops/s'
        : t.metric === 'utilization'
          ? 'ratio'
          : t.metric === 'queue-depth'
            ? 'messages'
            : 'ms';
    if (t.unit !== expected)
      ctx.addIssue({
        code: 'custom',
        message: `Use ${expected} for ${t.metric}.`,
        path: ['unit'],
      });
    if (t.metric === 'utilization' && t.value > 1)
      ctx.addIssue({
        code: 'custom',
        message: 'Utilization must be a ratio between 0 and 1.',
        path: ['value'],
      });
  });
export const ScenarioSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  description: z.string().default(''),
  trafficClasses: z.array(TrafficClassSchema).min(1),
  growthPercentPerMonth: z.number().finite().min(-100).default(0),
  growthMonths: nonnegative.default(0),
  assumptions: z.string().trim().min(1),
  targets: z.array(TargetSchema).default([]),
});
export const PerformanceProfileSchema = z
  .object({
    id,
    nodeId: id,
    model: z.enum(['service', 'database', 'cache', 'queue', 'router']),
    provenance: ProvenanceSchema,
    serviceTime: DistributionSchema.optional(),
    serviceTimeScope: z.enum(['total', 'non-cpu']).default('total'),
    concurrency: z.number().int().positive().max(100000).default(1),
    replicas: z.number().int().positive().max(10000).default(1),
    scaling: z.enum(['none', 'linear']).default('none'),
    maxReplicas: z.number().int().positive().max(10000).default(100),
    targetUtilization: positive.max(1).default(0.7),
    cpuSecondsPerOperation: nonnegative.optional(),
    cpuCores: positive.optional(),
    memoryBytesPerOperation: nonnegative.optional(),
    memoryBytes: positive.optional(),
    storageBytes: positive.optional(),
    cacheHitRatio: fraction.optional(),
    capacityCurve: z
      .array(
        z.object({
          requestsPerSecond: nonnegative,
          meanLatencyMs: nonnegative,
          p95LatencyMs: nonnegative.optional(),
          p99LatencyMs: nonnegative.optional(),
        }),
      )
      .max(1000)
      .default([]),
    readReplicas: z.number().int().nonnegative().default(0),
    queue: z
      .object({
        bufferMessages: z.number().int().nonnegative(),
        initialMessages: z.number().int().nonnegative().default(0),
        retentionSeconds: positive,
        acknowledgement: z
          .enum(['on-completion', 'on-admission'])
          .default('on-completion'),
        deadLetter: z.boolean().default(false),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    if (p.model === 'queue' && !p.queue)
      ctx.addIssue({
        code: 'custom',
        message: 'Queue behavior requires buffer and retention settings.',
        path: ['queue'],
      });
    if (p.model === 'cache' && p.cacheHitRatio === undefined)
      ctx.addIssue({
        code: 'custom',
        message:
          'Specify the cache hit ratio; it cannot be inferred from memory.',
        path: ['cacheHitRatio'],
      });
    if (p.maxReplicas < p.replicas)
      ctx.addIssue({
        code: 'custom',
        message: 'Maximum replicas cannot be below current replicas.',
        path: ['maxReplicas'],
      });
    const rates = p.capacityCurve.map((v) => v.requestsPerSecond);
    if (rates.some((r, i) => i > 0 && r <= rates[i - 1]!))
      ctx.addIssue({
        code: 'custom',
        message: 'Capacity curve rates must be strictly increasing.',
        path: ['capacityCurve'],
      });
  });
export const FlowPolicySchema = z
  .object({
    id,
    edgeId: id,
    trafficClassId: id.optional(),
    callsPerOperation: nonnegative.max(100000),
    fraction: fraction.default(1),
    routing: z.enum(['independent', 'exclusive']).default('independent'),
    operation: z
      .enum(['all', 'read', 'write', 'cache-miss', 'cache-aside'])
      .default('all'),
    cacheNodeId: id.optional(),
    execution: z
      .enum(['sequential', 'parallel', 'async'])
      .default('sequential'),
    order: z.number().int().nonnegative().default(0),
    group: z.string().default('default'),
    delivery: z.enum(['competing', 'broadcast']).default('competing'),
    maxRetries: z.number().int().min(0).max(100).default(0),
    retryProbability: fraction.default(0),
    retryBackoffMs: nonnegative.default(0),
    timeoutMs: positive.optional(),
    linkBytesPerSecond: positive.optional(),
    networkLatencyMs: nonnegative.default(0),
    assumption: z.string().trim().min(1),
  })
  .superRefine((p, ctx) => {
    if (
      (p.operation === 'cache-miss' || p.operation === 'cache-aside') &&
      !p.cacheNodeId
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Cache-miss routing requires an explicit cache reference.',
        path: ['cacheNodeId'],
      });
  });
export const AssessmentSchema = z.object({
  id,
  requirementId: id,
  status: z.enum(['met', 'violated', 'unknown', 'manually-reviewed']),
  evidence: z.string().min(1),
  scenarioId: id.optional(),
  targetId: id.optional(),
  fingerprint: z.string().optional(),
});
export const EngineeringSettingsSchema = z
  .object({
    production: z.boolean().default(false),
    minimumReplicas: z.number().int().positive().default(2),
    simulation: z
      .object({
        seed: z.number().int().default(42),
        replications: z.number().int().min(1).max(50).default(5),
        warmupSeconds: nonnegative.default(30),
        durationSeconds: positive.default(300),
        maxEvents: z.number().int().positive().max(10000000).default(2000000),
        maxWallTimeMs: positive.max(120000).default(30000),
      })
      .prefault({}),
  })
  .prefault({});
export type Scenario = z.infer<typeof ScenarioSchema>;
export type TrafficClass = z.infer<typeof TrafficClassSchema>;
export type PerformanceProfile = z.infer<typeof PerformanceProfileSchema>;
export type FlowPolicy = z.infer<typeof FlowPolicySchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;
export type SimulationOptions = z.infer<
  typeof EngineeringSettingsSchema
>['simulation'];
