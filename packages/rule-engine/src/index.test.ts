import { expect, it } from 'vitest';
import { sampleDocument } from '@swiftbuild/components-core';
import { evaluateArchitecture } from './index';
it('distinguishes production policy from not-applicable results', () => {
  const d = sampleDocument();
  d.nodes.find((n) => n.id === 'service')!.configuration.healthChecks = false;
  expect(
    evaluateArchitecture(d).outcomes.find((o) => o.ruleId === 'health-checks')!
      .status,
  ).toBe('not-applicable');
  d.engineering.production = true;
  const report = evaluateArchitecture(d);
  expect(
    report.findings.find((f) => f.ruleId === 'health-checks')!.fix,
  ).toEqual({ nodeId: 'service', key: 'healthChecks', value: true });
  expect(report.findings.some((f) => f.ruleId === 'redundancy')).toBe(true);
});
it('reports unknown requirements rather than claiming success', () => {
  const d = sampleDocument();
  d.requirements.push({
    id: 'r',
    title: 'Reliable checkout',
    description: 'Must survive a failure',
    nodeIds: ['service'],
  });
  expect(evaluateArchitecture(d).assessments[0]!.status).toBe('unknown');
});
