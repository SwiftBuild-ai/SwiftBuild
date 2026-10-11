import { it, expect } from 'vitest';
import { fixture, queueFixture } from './fixture.test.data';
import { simulateTopology } from './index';
const options = { durationSeconds: 10, warmupSeconds: 0, replications: 1 };
it('validates consumer groups using declared behavior rather than visual category', async () => {
  const d = queueFixture();
  const queueId = d.performanceProfiles.find(
    (p) => p.model === 'queue',
  )!.nodeId;
  const queue = d.nodes.find((n) => n.id === queueId)!;
  d.components.find((c) => c.id === queue.componentId)!.category = 'compute';
  d.flowPolicies.find((p) => p.edgeId === 'consume')!.fraction = 0.5;
  const report = await simulateTopology(d, 's', options);
  expect(report.status).toBe('partial');
  expect(
    report.coverage.some((c) =>
      c.message.includes('fractions must sum to one'),
    ),
  ).toBe(true);
});
it('distinguishes competing delivery from broadcast fan-out', async () => {
  const d = queueFixture();
  d.nodes.push({
    ...structuredClone(d.nodes.find((n) => n.id === 'worker')!),
    id: 'worker2',
  });
  d.views[0]!.nodeIds.push('worker2');
  d.views[0]!.layout.worker2 = { x: 1000, y: 200 };
  d.edges.push({
    ...structuredClone(d.edges.find((e) => e.id === 'consume')!),
    id: 'consume2',
    target: { nodeId: 'worker2', portId: 'in' },
  });
  d.performanceProfiles.push({
    ...structuredClone(
      d.performanceProfiles.find((p) => p.nodeId === 'worker')!,
    ),
    id: 'w2',
    nodeId: 'worker2',
  });
  d.flowPolicies.find((p) => p.edgeId === 'consume')!.fraction = 0.5;
  d.flowPolicies.push({
    ...structuredClone(d.flowPolicies.find((p) => p.edgeId === 'consume')!),
    id: 'consume2-policy',
    edgeId: 'consume2',
  });
  const competing = await simulateTopology(d, 's', options);
  const count = (report: typeof competing) =>
    report.nodes
      .filter((n) => n.nodeId.startsWith('worker'))
      .reduce(
        (sum, n) =>
          sum + n.metrics.find((m) => m.id === 'arrival')!.value! * 10,
        0,
      );
  expect(competing.status).toBe('complete');
  expect(count(competing)).toBeCloseTo(competing.accounting!.admitted);
  d.flowPolicies
    .filter((p) => p.edgeId.startsWith('consume'))
    .forEach((p) => {
      p.delivery = 'broadcast';
      p.fraction = 1;
    });
  const broadcast = await simulateTopology(d, 's', options);
  expect(count(broadcast)).toBeCloseTo(broadcast.accounting!.admitted * 2);
});
it('expires retained messages without counting outcomes twice', async () => {
  const d = queueFixture();
  d.performanceProfiles.find(
    (p) => p.model === 'queue',
  )!.queue!.retentionSeconds = 0.01;
  const report = await simulateTopology(d, 's', options),
    a = report.accounting!;
  expect(a.dropped).toBeGreaterThan(0);
  expect(a.offered).toBe(a.completed + a.failed + a.dropped + a.outstanding);
});
it('captures a burst and subsequent queue recovery', async () => {
  const d = fixture();
  d.scenarios[0]!.trafficClasses[0]!.bursts = [
    { startSeconds: 1, durationSeconds: 1, multiplier: 20 },
  ];
  const report = await simulateTopology(d, 's', options);
  expect(
    report.nodes[0]!.metrics.find((m) => m.id === 'queue-depth')!.value,
  ).toBeGreaterThan(100);
  expect(report.series!.at(-1)!.queueDepth).toBe(0);
});
