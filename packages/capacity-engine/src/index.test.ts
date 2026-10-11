import { expect, it } from 'vitest';
import { fixture } from './fixture.test.data';
import {
  estimateScenario,
  analyzeTopology,
  simulateTopology,
  mmc,
  randomFor,
  sampleService,
} from './index';
it('calculates dimensional traffic, storage and bandwidth', () => {
  const r = estimateScenario(fixture(), 's');
  expect(r.metrics[0]!.value).toBe(10);
  expect(r.metrics[1]!.value).toBeCloseTo(172800000);
  expect(r.metrics[2]!.value).toBe(3000);
});
it('matches the hand-calculated M/M/1 queue and reports instability', () => {
  expect(mmc(10, 0.02, 1)).toEqual({
    utilization: 0.2,
    waitSeconds: 0.005,
    meanSeconds: 0.025,
  });
  expect(mmc(50, 0.02, 1).waitSeconds).toBeUndefined();
});
it('does not fabricate performance for missing profiles or routing', () => {
  const d = fixture();
  d.performanceProfiles = [];
  d.flowPolicies = [];
  const r = analyzeTopology(d, 's');
  expect(r.status).toBe('partial');
  expect(
    r.nodes.find((n) => n.nodeId === 'service')!.metrics[0]!.value,
  ).toBeUndefined();
});
it('propagates bounded retries and keeps layout out of fingerprints', () => {
  const d = fixture();
  d.flowPolicies[0]!.maxRetries = 2;
  d.flowPolicies[0]!.retryProbability = 0.5;
  const a = analyzeTopology(d, 's');
  expect(a.nodes.find((n) => n.nodeId === 'service')!.metrics[0]!.value).toBe(
    17.5,
  );
  d.views[0]!.layout.service!.x += 100;
  expect(analyzeTopology(d, 's').fingerprint).toBe(a.fingerprint);
});
it('simulates constant traffic reproducibly and preserves accounting', async () => {
  const d = fixture();
  const opts = {
    warmupSeconds: 1,
    durationSeconds: 10,
    replications: 5,
    maxEvents: 100000,
    maxWallTimeMs: 10000,
  };
  const a = await simulateTopology(d, 's', opts),
    b = await simulateTopology(d, 's', opts);
  expect(a).toEqual(b);
  expect(a.status).toBe('complete');
  expect(a.metrics.find((m) => m.id === 'mean-latency')!.value).toBeCloseTo(20);
  expect(a.metrics.find((m) => m.id === 'throughput')!.value).toBeCloseTo(
    10,
    0,
  );
  const c = a.accounting!;
  expect(c.offered).toBe(c.completed + c.failed + c.dropped + c.outstanding);
});
it('marks budget limits and cancellation as incomplete', async () => {
  expect(
    (await simulateTopology(fixture(), 's', { maxEvents: 2, replications: 1 }))
      .status,
  ).toBe('partial');
  expect(
    (await simulateTopology(fixture(), 's', { shouldCancel: () => true }))
      .status,
  ).toBe('cancelled');
});
it('samples exponential service with the expected mean', () => {
  const p = fixture().performanceProfiles[0]!;
  p.serviceTime = { kind: 'exponential', meanMs: 20 };
  const random = randomFor(42);
  const mean =
    Array.from({ length: 100000 }, () => sampleService(p, random)!).reduce(
      (a, b) => a + b,
      0,
    ) / 100000;
  expect(mean).toBeCloseTo(0.02, 3);
});
