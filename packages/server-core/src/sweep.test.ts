import { expect, it } from 'vitest';
import { fixture } from '../../capacity-engine/src/fixture.test.data';
import { analyzeTopology } from '@swiftbuild/capacity-engine';
import { ExecutionInputSchema } from '@swiftbuild/computation-contracts';
import { capacitySweep } from './sweep-child';
import { validateAnalysis } from './analysis-validation';
it('uses the existing TypeScript engine without changing the source document', async () => {
  const d = fixture();
  d.scenarios[0]!.trafficClasses[0]!.arrivals = 'poisson';
  d.performanceProfiles[0]!.serviceTime = { kind: 'exponential', meanMs: 20 };
  const before = JSON.stringify(d);
  const traffic = d.scenarios[0]!.trafficClasses[0]!;
  const input = ExecutionInputSchema.parse({
    contractVersion: '1.0',
    projectId: '00000000-0000-4000-8000-000000000001',
    revision: 1,
    seed: 42,
    samples: 1000,
    deadlineMs: 120000,
    definition: {
      kind: 'capacity-sensitivity',
      scenarioId: 's',
      engine: 'analytical',
      targetId: traffic.id,
      parameter: 'requestsPerSecond',
      values: [10, 20],
      metricId: 'mean-latency',
      nodeId: 'service',
    },
  });
  validateAnalysis(input.definition, d);
  const samples = await capacitySweep(d, input);
  const direct = structuredClone(d);
  const workload = direct.scenarios[0]!.trafficClasses[0]!.workload;
  if (workload.kind === 'rate') workload.requestsPerSecond = 10;
  const report = analyzeTopology(direct, 's');
  expect(samples[0]!.value).toBe(
    report.nodes
      .find((n) => n.nodeId === 'service')!
      .metrics.find((m) => m.id === 'mean-latency')!.value,
  );
  expect(samples[0]!.fingerprint).toBe(report.fingerprint);
  expect(samples[0]!.evidence!.formula).toBe(
    report.nodes
      .find((n) => n.nodeId === 'service')!
      .metrics.find((m) => m.id === 'mean-latency')!.formula,
  );
  expect(JSON.stringify(d)).toBe(before);
});
