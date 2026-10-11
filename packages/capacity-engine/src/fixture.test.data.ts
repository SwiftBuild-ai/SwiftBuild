import { sampleDocument } from '@swiftbuild/components-core';
import {
  ScenarioSchema,
  PerformanceProfileSchema,
  FlowPolicySchema,
} from '@swiftbuild/architecture-schema';
export function fixture() {
  const d = sampleDocument();
  d.nodes = d.nodes.filter((n) => ['client', 'service'].includes(n.id));
  d.edges = d.edges.filter((e) => e.id === 'edge-request');
  d.views[0]!.nodeIds = ['client', 'service'];
  delete d.views[0]!.layout.cache;
  delete d.views[0]!.layout.database;
  d.scenarios = [
    ScenarioSchema.parse({
      id: 's',
      name: 'Baseline',
      assumptions: 'Illustrative test inputs.',
      trafficClasses: [
        {
          id: 't',
          name: 'Requests',
          entryNodeId: 'client',
          workload: { kind: 'rate', requestsPerSecond: 10 },
          arrivals: 'constant',
          readFraction: 0.8,
          payloadBytes: 100,
          responseBytes: 200,
          objectBytes: 1000,
          retentionDays: 1,
        },
      ],
    }),
  ];
  d.performanceProfiles = [
    PerformanceProfileSchema.parse({
      id: 'profile',
      nodeId: 'service',
      model: 'service',
      serviceTime: { kind: 'constant', meanMs: 20 },
      concurrency: 1,
      scaling: 'linear',
      provenance: {
        kind: 'illustrative',
        source: 'Unit fixture',
        context: 'Not real hardware',
        recordedAt: '2026-10-10T00:00:00Z',
      },
    }),
  ];
  d.flowPolicies = [
    FlowPolicySchema.parse({
      id: 'f',
      edgeId: 'edge-request',
      callsPerOperation: 1,
      assumption: 'One call per request.',
    }),
  ];
  return d;
}

export function queueFixture() {
  const d = fixture();
  const worker = {
    ...structuredClone(d.nodes[1]!),
    id: 'worker',
    name: 'Worker',
  };
  d.nodes.push(worker);
  d.views[0]!.nodeIds.push('worker');
  d.views[0]!.layout.worker = { x: 700, y: 200 };
  const queue = d.components.find((c) => c.id === 'core.queue')!;
  d.nodes[1]!.componentId = queue.id;
  d.nodes[1]!.configuration = Object.fromEntries(
    queue.configurationSchema.map((f) => [f.key, f.default]),
  );
  d.components
    .find((c) => c.id === 'core.client')!
    .ports[0]!.relationships.push('async-message');
  d.components
    .find((c) => c.id === 'core.service')!
    .ports[0]!.relationships.push('async-message');
  d.edges[0]!.relationship = 'async-message';
  d.edges.push({
    id: 'consume',
    source: { nodeId: 'service', portId: 'out' },
    target: { nodeId: 'worker', portId: 'in' },
    relationship: 'async-message',
    label: 'Consume',
    metadata: {},
  });
  const provenance = d.performanceProfiles[0]!.provenance;
  d.performanceProfiles = [
    PerformanceProfileSchema.parse({
      id: 'q',
      nodeId: 'service',
      model: 'queue',
      provenance,
      queue: { bufferMessages: 3, retentionSeconds: 30, deadLetter: true },
    }),
    PerformanceProfileSchema.parse({
      id: 'w',
      nodeId: 'worker',
      model: 'service',
      provenance,
      serviceTime: { kind: 'constant', meanMs: 100 },
    }),
  ];
  d.flowPolicies.push(
    FlowPolicySchema.parse({
      id: 'consume-policy',
      edgeId: 'consume',
      callsPerOperation: 1,
      execution: 'async',
      assumption: 'Competing consumer with acknowledgement on completion.',
    }),
  );
  d.scenarios[0]!.trafficClasses[0]!.workload = {
    kind: 'rate',
    requestsPerSecond: 20,
  };
  return d;
}
