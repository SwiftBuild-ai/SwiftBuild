import { it, expect } from 'vitest';
import { fixture } from './fixture.test.data';
import { analyzeTopology, simulateTopology, randomFor } from './index';
import { inputFingerprint } from '@swiftbuild/architecture-model';
it('agrees with the analytical M/M/1 mean after warm-up', async () => {
  const d = fixture();
  d.scenarios[0]!.trafficClasses[0]!.arrivals = 'poisson';
  d.performanceProfiles[0]!.serviceTime = { kind: 'exponential', meanMs: 20 };
  const analytical = analyzeTopology(d, 's')
    .nodes.find((n) => n.nodeId === 'service')!
    .metrics.find((m) => m.id === 'mean-latency')!.value!;
  const simulation = await simulateTopology(d, 's', {
    warmupSeconds: 60,
    durationSeconds: 600,
    replications: 5,
    maxEvents: 300000,
    maxWallTimeMs: 20000,
  });
  expect(simulation.status).toBe('complete');
  expect(
    Math.abs(
      simulation.metrics.find((m) => m.id === 'mean-latency')!.value! -
        analytical,
    ),
  ).toBeLessThan(1.5);
}, 20000);
it('rejects recursive feedback without changing the input', async () => {
  const d = fixture();
  d.components
    .find((c) => c.id === 'core.client')!
    .ports.push({
      id: 'return',
      label: 'Return',
      direction: 'input',
      relationships: ['request'],
    });
  d.edges.push({
    id: 'feedback',
    source: { nodeId: 'service', portId: 'out' },
    target: { nodeId: 'client', portId: 'return' },
    relationship: 'request',
    label: 'Feedback',
    metadata: {},
  });
  const before = JSON.stringify(d);
  const report = await simulateTopology(d, 's');
  expect(report.status).toBe('partial');
  expect(report.coverage[0]!.message).toContain('cycles');
  expect(JSON.stringify(d)).toBe(before);
});
it('makes seeded replay independent of document collection order', async () => {
  const d = fixture(),
    reordered = structuredClone(d);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  reordered.performanceProfiles.reverse();
  const options = { durationSeconds: 5, warmupSeconds: 0, replications: 2 };
  expect(await simulateTopology(d, 's', options)).toEqual(
    await simulateTopology(reordered, 's', options),
  );
  const a = randomFor(42, 0),
    b = randomFor(42, 1),
    c = randomFor(42, 1);
  const first = Array.from({ length: 5 }, a),
    second = Array.from({ length: 5 }, b);
  expect(first).not.toEqual(second);
  expect(second).toEqual(Array.from({ length: 5 }, c));
});
it('records actual execution overrides and normalizes empirical replay order', async () => {
  const d = fixture();
  d.performanceProfiles[0]!.serviceTime = {
    kind: 'empirical',
    samplesMs: [10, 30, 20],
  };
  const reordered = structuredClone(d);
  reordered.performanceProfiles[0]!.serviceTime = {
    kind: 'empirical',
    samplesMs: [30, 20, 10],
  };
  const options = {
    durationSeconds: 3,
    warmupSeconds: 0,
    replications: 1,
    seed: 987,
  };
  const report = await simulateTopology(d, 's', options);
  expect(report).toEqual(await simulateTopology(reordered, 's', options));
  expect(report.runSettings).toMatchObject(options);
  expect(report.fingerprint).not.toBe(inputFingerprint(d));
  const actual = structuredClone(d);
  actual.engineering.simulation = {
    ...actual.engineering.simulation,
    ...options,
  };
  expect(report.fingerprint).toBe(inputFingerprint(actual));
  expect(d.engineering.simulation.seed).toBe(42);
});
