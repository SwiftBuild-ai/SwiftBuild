import { expect, it } from 'vitest';
import {
  parseDocument,
  migrateDocument,
  ScenarioSchema,
  PerformanceProfileSchema,
  FlowPolicySchema,
} from './index';
const legacy = {
  schemaVersion: '1.0',
  project: { id: 'p', name: 'Example', description: '' },
  architecture: { id: 'a', name: 'System', description: '' },
  nodes: [],
  edges: [],
  components: [],
  views: [{ id: 'v', name: 'System', nodeIds: [], layout: {} }],
  metadata: { extension: { retained: true } },
};
it('migrates legacy without mutating source and round trips 1.1', () => {
  const original = JSON.stringify(legacy);
  const next = migrateDocument(legacy);
  expect(next.schemaVersion).toBe('1.1');
  expect(next.metadata).toEqual(legacy.metadata);
  expect(next.scenarios).toEqual([]);
  expect(JSON.stringify(legacy)).toBe(original);
  expect(parseDocument(JSON.parse(JSON.stringify(next)))).toEqual(next);
});
it('rejects invalid distributions, units and implicit cache routing', () => {
  expect(
    ScenarioSchema.safeParse({
      id: 's',
      name: 'Peak',
      assumptions: 'Manual',
      trafficClasses: [
        {
          id: 't',
          name: 'Reads',
          entryNodeId: 'n',
          workload: { kind: 'rate', requestsPerSecond: -1 },
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    FlowPolicySchema.safeParse({
      id: 'f',
      edgeId: 'e',
      callsPerOperation: 1,
      operation: 'cache-miss',
      assumption: 'Manual',
    }).success,
  ).toBe(false);
  expect(
    PerformanceProfileSchema.safeParse({
      id: 'p',
      nodeId: 'n',
      model: 'cache',
      provenance: {
        kind: 'assumed',
        source: 'Manual',
        context: 'Test',
        recordedAt: '2026-10-10T00:00:00Z',
      },
    }).success,
  ).toBe(false);
});
