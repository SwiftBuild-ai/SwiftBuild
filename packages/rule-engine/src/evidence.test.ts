import { it, expect } from 'vitest';
import { engineeringSampleDocument } from '@swiftbuild/components-core';
import { inputFingerprint } from '@swiftbuild/architecture-model';
import { analyzeTopology } from '@swiftbuild/capacity-engine';
import { evaluateArchitecture } from './index';
it('evaluates backup, dead-letter and health policies from explicit configuration', () => {
  const d = engineeringSampleDocument();
  d.engineering.production = true;
  d.nodes.find((n) => n.id === 'database')!.configuration.backups = false;
  d.nodes.find((n) => n.id === 'service')!.configuration.healthChecks = false;
  const q = d.components.find((c) => c.id === 'core.queue')!;
  d.nodes.push({
    id: 'queue',
    name: 'Queue',
    componentId: q.id,
    componentVersion: q.version,
    configuration: Object.fromEntries(
      q.configurationSchema.map((f) => [
        f.key,
        f.key === 'deadLetter' ? false : f.default,
      ]),
    ),
    metadata: {},
  });
  d.views[0]!.nodeIds.push('queue');
  d.views[0]!.layout.queue = { x: 1200, y: 400 };
  const report = evaluateArchitecture(d);
  for (const id of ['backups', 'dead-letter', 'health-checks'])
    expect(report.findings.some((f) => f.ruleId === id && !!f.fix)).toBe(true);
});
it('flags declared external access and trust-boundary crossings', () => {
  const d = engineeringSampleDocument(),
    b = d.components.find((c) => c.id === 'core.boundary')!;
  d.nodes.push({
    id: 'trust',
    name: 'Trust zone',
    componentId: b.id,
    componentVersion: b.version,
    configuration: { kind: 'Trust', region: 'Primary' },
    metadata: {},
  });
  d.views[0]!.nodeIds.push('trust');
  d.views[0]!.layout.trust = { x: 700, y: 100, width: 600, height: 500 };
  d.nodes.find((n) => n.id === 'database')!.parentId = 'trust';
  d.components
    .find((c) => c.id === 'core.database')!
    .ports[0]!.relationships.push('public-access');
  d.edges.push({
    id: 'external',
    source: { nodeId: 'client', portId: 'out' },
    target: { nodeId: 'database', portId: 'in' },
    relationship: 'public-access',
    label: 'External',
    metadata: {},
  });
  const report = evaluateArchitecture(d);
  expect(report.findings.some((f) => f.ruleId === 'trust-exposure')).toBe(true);
  expect(report.findings.some((f) => f.ruleId === 'trust-boundary')).toBe(true);
});
it('assesses overload, retained-storage exhaustion and explicit node targets', () => {
  const d = engineeringSampleDocument();
  d.assessments = [];
  d.scenarios[0]!.trafficClasses[0]!.workload = {
    kind: 'rate',
    requestsPerSecond: 1000,
  };
  d.scenarios[0]!.targets = [
    {
      id: 'util',
      nodeId: 'service',
      metric: 'utilization',
      comparator: 'at-most',
      value: 0.7,
      unit: 'ratio',
    },
  ];
  d.performanceProfiles.find((p) => p.nodeId === 'database')!.storageBytes = 1;
  const capacity = analyzeTopology(d, d.scenarios[0]!.id),
    report = evaluateArchitecture(d, { capacity });
  for (const id of ['overload', 'storage', 'target:util'])
    expect(report.findings.some((f) => f.ruleId === id)).toBe(true);
  expect(new Set(report.findings.map((f) => f.id)).size).toBe(
    report.findings.length,
  );
});
it('does not use stale or imported capacity as current assessment evidence', () => {
  const d = engineeringSampleDocument(),
    capacity = analyzeTopology(d, d.scenarios[0]!.id);
  expect(
    evaluateArchitecture(d, { capacity: { ...capacity, origin: 'imported' } })
      .capacityStale,
  ).toBe(true);
  d.nodes[0]!.name = 'Changed';
  expect(evaluateArchitecture(d, { capacity }).capacityStale).toBe(true);
});
it('invalidates manual review after semantic changes while preserving its record', () => {
  const d = engineeringSampleDocument();
  d.assessments[0]!.status = 'manually-reviewed';
  d.assessments[0]!.evidence = 'Documented human review.';
  d.assessments[0]!.fingerprint = inputFingerprint(d);
  expect(evaluateArchitecture(d).assessments[0]!.status).toBe(
    'manually-reviewed',
  );
  d.nodes[0]!.name = 'Changed';
  expect(evaluateArchitecture(d).assessments[0]!.status).toBe('unknown');
  expect(d.assessments[0]!.evidence).toBe('Documented human review.');
});
