import { expect, it } from 'vitest';
import { engineeringSampleDocument } from '@swiftbuild/components-core';

import { fixture, queueFixture } from './fixture.test.data';
import {
  analyzeTopology,
  simulateTopology,
  importMeasurementsCSV,
} from './index';
const options = {
  warmupSeconds: 0,
  durationSeconds: 10,
  replications: 1,
  maxEvents: 100000,
  maxWallTimeMs: 10000,
};
it('keeps writes on the primary at cache-hit extremes', () => {
  const d = engineeringSampleDocument();
  d.performanceProfiles.find((p) => p.model === 'cache')!.cacheHitRatio = 1;
  expect(
    analyzeTopology(d, d.scenarios[0]!.id).nodes.find(
      (n) => n.nodeId === 'database',
    )!.metrics[0]!.value,
  ).toBeCloseTo(2);
  d.performanceProfiles.find((p) => p.model === 'cache')!.cacheHitRatio = 0;
  expect(
    analyzeTopology(d, d.scenarios[0]!.id).nodes.find(
      (n) => n.nodeId === 'database',
    )!.metrics[0]!.value,
  ).toBe(20);
});
it('joins parallel work and sequences ordered dependencies', async () => {
  const d = fixture();
  d.scenarios[0]!.trafficClasses[0]!.readFraction = 1;
  d.nodes.push({ ...structuredClone(d.nodes[1]!), id: 'slow', name: 'Slow' });
  d.views[0]!.nodeIds.push('slow');
  d.views[0]!.layout.slow = { x: 700, y: 100 };
  d.edges.push({
    ...structuredClone(d.edges[0]!),
    id: 'second',
    target: { nodeId: 'slow', portId: 'in' },
  });
  d.performanceProfiles.push({
    ...structuredClone(d.performanceProfiles[0]!),
    id: 'slow-profile',
    nodeId: 'slow',
    serviceTime: { kind: 'constant', meanMs: 40 },
  });
  d.flowPolicies[0]!.execution = 'parallel';
  d.flowPolicies.push({
    ...structuredClone(d.flowPolicies[0]!),
    id: 'second-policy',
    edgeId: 'second',
  });
  expect(
    (await simulateTopology(d, 's', options)).metrics.find(
      (m) => m.id === 'mean-latency',
    )!.value,
  ).toBeCloseTo(40);
  d.flowPolicies.forEach((p) => {
    p.execution = 'sequential';
  });
  expect(
    (await simulateTopology(d, 's', options)).metrics.find(
      (m) => m.id === 'mean-latency',
    )!.value,
  ).toBeCloseTo(60);
});
it('enforces finite queue capacity and preserves work accounting under saturation', async () => {
  const report = await simulateTopology(queueFixture(), 's', options);
  expect(report.status).toBe('complete');
  expect(report.accounting!.dropped).toBeGreaterThan(80);
  expect(
    report.nodes
      .find((n) => n.nodeId === 'service')!
      .metrics.find((m) => m.id === 'queue-depth')!.value,
  ).toBe(3);
  const a = report.accounting!;
  expect(a.offered).toBe(a.completed + a.failed + a.dropped + a.outstanding);
});
it('models bounded retries and dead-letter outcomes', async () => {
  const d = queueFixture();
  d.flowPolicies[1]!.retryProbability = 1;
  d.flowPolicies[1]!.maxRetries = 2;
  const report = await simulateTopology(d, 's', options);
  expect(
    report.nodes
      .find((n) => n.nodeId === 'service')!
      .metrics.find((m) => m.id === 'dead-lettered')!.value,
  ).toBeGreaterThan(0);
  expect(report.accounting!.failed).toBeGreaterThan(0);
});
it('refuses fabricated CPU decomposition and simulates explicit CPU contention', async () => {
  const d = fixture();
  const p = d.performanceProfiles[0]!;
  p.cpuCores = 1;
  p.cpuSecondsPerOperation = 0.2;
  expect((await simulateTopology(d, 's', options)).status).toBe('partial');
  p.serviceTimeScope = 'non-cpu';
  const report = await simulateTopology(d, 's', options);
  expect(report.status).toBe('complete');
  expect(report.metrics.find((m) => m.id === 'throughput')!.value).toBeLessThan(
    5.1,
  );
  expect(
    report.nodes[0]!.metrics.find((m) => m.id === 'cpu')!.value,
  ).toBeGreaterThan(0.9);
});
it('does not scale database writes with replica counts', () => {
  const d = fixture();
  const p = d.performanceProfiles[0]!;
  p.model = 'database';
  p.scaling = 'linear';
  p.replicas = 100;
  p.readReplicas = 4;
  d.scenarios[0]!.trafficClasses[0]!.readFraction = 0;
  expect(
    analyzeTopology(d, 's').nodes[1]!.metrics.find(
      (m) => m.id === 'utilization',
    )!.value,
  ).toBeCloseTo(0.2);
  expect(
    analyzeTopology(d, 's').nodes[1]!.metrics.find(
      (m) => m.id === 'required-replicas',
    )!.value,
  ).toBeUndefined();
});
it('validates empirical samples and capacity curve operating ranges', () => {
  const d = fixture(),
    p = d.performanceProfiles[0]!;
  const samples = importMeasurementsCSV('service_ms\r\n"10"\r\n20\r\n', p);
  expect(samples.serviceTime).toEqual({
    kind: 'empirical',
    samplesMs: [10, 20],
  });
  expect(() => importMeasurementsCSV('service_ms\n0\n20', p)).toThrow(
    'positive',
  );
  d.performanceProfiles[0] = importMeasurementsCSV(
    'requests_per_second,mean_latency_ms\n1,20\n5,40',
    p,
  );
  expect(
    analyzeTopology(d, 's').nodes[1]!.metrics.find(
      (m) => m.id === 'mean-latency',
    )!.value,
  ).toBeUndefined();
});
it('rejects malformed CSV quoting without changing the supplied profile', () => {
  const profile = fixture().performanceProfiles[0]!;
  const original = structuredClone(profile);
  for (const raw of [
    'service_ms\n"2"0\n30',
    'service_ms\n"20" "0"\n30',
    'service_ms\n2"0\n30',
    'service_ms\n"20\n30',
    'requests_per_second,mean_latency_ms\n1,"2"0\n5,40',
  ]) {
    expect(() => importMeasurementsCSV(raw, profile)).toThrow(
      /CSV row 2, field/,
    );
    expect(profile).toEqual(original);
  }
});
it('preserves BOM, quoted cells, trailing whitespace and CRLF in CSV', () => {
  const profile = fixture().performanceProfiles[0]!;
  const samples = importMeasurementsCSV(
    '\uFEFF"service_ms"\r\n"20" \t\r\n30\r\n',
    profile,
  );
  expect(samples.serviceTime).toEqual({
    kind: 'empirical',
    samplesMs: [20, 30],
  });
  expect(samples.provenance).toEqual(profile.provenance);
  const curve = importMeasurementsCSV(
    'requests_per_second,mean_latency_ms,p95_latency_ms\r1,"20",\r5,"40",50',
    profile,
  );
  expect(curve.capacityCurve).toEqual([
    {
      requestsPerSecond: 1,
      meanLatencyMs: 20,
      p95LatencyMs: undefined,
      p99LatencyMs: undefined,
    },
    {
      requestsPerSecond: 5,
      meanLatencyMs: 40,
      p95LatencyMs: 50,
      p99LatencyMs: undefined,
    },
  ]);
  // Doubled quotes are valid CSV syntax, but the decoded value is not numeric.
  expect(() =>
    importMeasurementsCSV('service_ms\n"2""0"\n30', profile),
  ).toThrow('positive number');
});
