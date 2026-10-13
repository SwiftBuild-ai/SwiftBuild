import type { ArchitectureDocument } from '@swiftbuild/architecture-schema';
import {
  AnalysisDefinitionSchema,
  type AnalysisDefinition,
} from '@swiftbuild/computation-contracts';
export function validateAnalysis(
  input: unknown,
  document: ArchitectureDocument,
): AnalysisDefinition {
  const definition = AnalysisDefinitionSchema.parse(input);
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (definition.kind === 'capacity-sensitivity') {
    const scenario = document.scenarios.find(
      (s) => s.id === definition.scenarioId,
    );
    if (!scenario) fail('Select an existing scenario.');
    if (
      definition.parameter === 'requestsPerSecond' ||
      definition.parameter === 'peakMultiplier'
    ) {
      const traffic = scenario!.trafficClasses.find(
        (t) => t.id === definition.targetId,
      );
      if (
        !traffic ||
        (definition.parameter === 'requestsPerSecond' &&
          traffic.workload.kind !== 'rate')
      )
        fail('Select a compatible traffic class.');
    } else {
      const profile = document.performanceProfiles.find(
        (p) => p.id === definition.targetId,
      );
      if (
        !profile ||
        (definition.parameter === 'meanMs' &&
          (!profile.serviceTime || profile.serviceTime.kind === 'empirical'))
      )
        fail('Select a compatible performance profile.');
    }
    if (
      definition.nodeId &&
      !document.nodes.some((n) => n.id === definition.nodeId)
    )
      fail('Metric node does not exist.');
    if (
      definition.values.some(
        (v) =>
          (definition.parameter !== 'requestsPerSecond' && v <= 0) ||
          (['concurrency', 'replicas'].includes(definition.parameter) &&
            !Number.isInteger(v)),
      )
    )
      fail('Values are incompatible with this parameter.');
    if (new Set(definition.values).size !== definition.values.length)
      fail('Sweep values must be distinct.');
  } else {
    const r = definition.reliability;
    const ids = [
      ...r.components.map((c) => c.nodeId),
      ...r.groups.map((g) => g.id),
      ...r.gates.map((g) => g.id),
    ];
    if (new Set(ids).size !== ids.length)
      fail('Analysis identifiers must be unique.');
    const nodes = new Set(document.nodes.map((n) => n.id));
    const components = new Set(r.components.map((c) => c.nodeId));
    if (r.components.some((c) => !nodes.has(c.nodeId)))
      fail('A reliability node is missing.');
    if (
      r.groups.some(
        (g) =>
          g.nodeIds.some((n) => !components.has(n)) ||
          new Set(g.nodeIds).size !== g.nodeIds.length,
      )
    )
      fail('Failure groups must reference distinct declared components.');
    const gates = new Map(r.gates.map((g) => [g.id, g]));
    const completed = new Set<string>();
    const visit = (id: string, path: Set<string>) => {
      if (completed.has(id)) return;
      if (components.has(id)) return;
      const gate = gates.get(id);
      if (!gate || path.has(id))
        fail('Success gates contain a cycle or invalid reference.');
      if (
        new Set(gate!.inputs).size !== gate!.inputs.length ||
        (gate!.kind === 'k-of-n'
          ? !gate!.k || gate!.k > gate!.inputs.length
          : gate!.k !== undefined)
      )
        fail('Invalid success gate threshold or duplicate input.');
      for (const next of gate!.inputs) visit(next, new Set([...path, id]));
      completed.add(id);
    };
    visit(r.root, new Set());
    for (const gate of r.gates) visit(gate.id, new Set());
    if (
      1 + definition.ranges.reduce((n, range) => n + range.values.length, 0) >
      50
    )
      fail('At most 50 evaluations are allowed.');
    for (const range of definition.ranges) {
      if (
        ![...components, ...r.groups.map((g) => g.id)].includes(
          range.targetId,
        ) ||
        new Set(range.values).size !== range.values.length ||
        (range.parameter === 'meanUpSeconds' &&
          range.values.some((v) => v <= 0))
      )
        fail('Invalid reliability range.');
    }
  }
  return definition;
}
