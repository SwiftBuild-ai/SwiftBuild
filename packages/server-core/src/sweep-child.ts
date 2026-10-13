import { ArchitectureDocumentSchema } from '@swiftbuild/architecture-schema';
import { analyzeTopology, simulateTopology } from '@swiftbuild/capacity-engine';
import { validateDocument } from '@swiftbuild/graph-engine';
import type { ExecutionInput } from '@swiftbuild/computation-contracts';
export async function capacitySweep(document: unknown, input: ExecutionInput) {
  const definition = input.definition;
  if (definition.kind !== 'capacity-sensitivity')
    throw new Error('Expected capacity sweep.');
  const original = ArchitectureDocumentSchema.parse(document);
  const samples: NonNullable<ExecutionInput['capacitySamples']> = [];
  for (const x of definition.values) {
    const derived = structuredClone(original);
    const parameter = definition.parameter;
    if (parameter === 'requestsPerSecond' || parameter === 'peakMultiplier') {
      const traffic = derived.scenarios
        .find((s) => s.id === definition.scenarioId)!
        .trafficClasses.find((t) => t.id === definition.targetId)!;
      if (parameter === 'requestsPerSecond') {
        if (traffic.workload.kind !== 'rate')
          throw new Error('Not a rate workload.');
        traffic.workload.requestsPerSecond = x;
      } else traffic.peakMultiplier = x;
    } else {
      const profile = derived.performanceProfiles.find(
        (p) => p.id === definition.targetId,
      )!;
      if (parameter === 'meanMs') {
        if (!profile.serviceTime || profile.serviceTime.kind === 'empirical')
          throw new Error('Not a mean-based distribution.');
        profile.serviceTime.meanMs = x;
      } else profile[parameter] = x;
    }
    derived.engineering.simulation.seed = input.seed;
    validateDocument(ArchitectureDocumentSchema.parse(derived));
    const report =
      definition.engine === 'analytical'
        ? analyzeTopology(derived, definition.scenarioId)
        : await simulateTopology(derived, definition.scenarioId);
    const metrics = definition.nodeId
      ? report.nodes.find((n) => n.nodeId === definition.nodeId)?.metrics
      : report.metrics;
    const metric = metrics?.find((m) => m.id === definition.metricId);
    samples.push({
      x,
      value: metric?.status === 'known' ? (metric.value ?? null) : null,
      status: report.status,
      coverage: report.coverage.map((c) => c.message),
      fingerprint: report.fingerprint,
      engineVersion: report.engineVersion,
      modelVersion: report.modelVersion,
      unit: metric?.unit ?? 'unknown',
      evidence: {
        formula: metric?.formula ?? '',
        inputs: metric?.inputs ?? {},
        assumptions: [...report.assumptions, ...(metric?.assumptions ?? [])],
        limitations: metric?.limitations ?? [],
        sources: metric?.sources ?? [],
        ...(metric?.interval ? { interval: metric.interval } : {}),
        ...(report.accounting ? { accounting: report.accounting } : {}),
      },
    });
  }
  return samples;
}
if (process.env.SWIFTBUILD_SWEEP_CHILD === '1' && process.send) {
  process.once(
    'message',
    (message: { document: unknown; input: ExecutionInput }) => {
      void capacitySweep(message.document, message.input)
        .then((samples) => {
          process.send!({ samples });
          process.disconnect();
        })
        .catch(() => {
          process.send!({ error: 'SWEEP_FAILED' });
          process.disconnect();
        });
    },
  );
}
