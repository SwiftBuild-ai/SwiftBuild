import { expect, it } from 'vitest';
import {
  configurationErrors,
  parseDocument,
  serializeDocument,
} from '@swiftbuild/architecture-schema';
import {
  validateDocument,
  compatibleRelationships,
} from '@swiftbuild/graph-engine';
import { sampleDocument } from '@swiftbuild/components-core';
import {
  configureNode,
  commit,
  undo,
  redo,
} from '@swiftbuild/architecture-model';
import {
  infrastructureComponents,
  defaultComponents,
  loadPack,
  searchComponents,
  legacyMapping,
  upgradeLegacyNode,
  infrastructureSampleDocument,
} from './index';
const pack = {
  format: 'swiftbuild-component-pack',
  packVersion: '1.0',
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  license: 'Apache-2.0',
  components: infrastructureComponents,
};
it('provides a semantically valid technology architecture example', () => {
  const d = validateDocument(infrastructureSampleDocument());
  expect(d.nodes).toHaveLength(7);
  expect(d.edges).toHaveLength(6);
  expect(
    d.components.find(
      (c) => c.id === d.nodes.find((n) => n.id === 'cache')!.componentId,
    )!.name,
  ).toBe('Redis');
});
it('loads unique typed definitions with validated defaults and resource references', () => {
  expect(loadPack(pack).components.length).toBeGreaterThan(60);
  expect(new Set(defaultComponents.map((c) => c.id)).size).toBe(
    defaultComponents.length,
  );
  for (const c of infrastructureComponents)
    expect(
      configurationErrors(
        c,
        Object.fromEntries(
          c.configurationSchema.map((f) => [f.key, f.default]),
        ),
      ),
    ).toEqual([]);
  expect(() =>
    loadPack({
      ...pack,
      components: [infrastructureComponents[0], infrastructureComponents[0]],
    }),
  ).toThrow('Duplicate');
  expect(() =>
    loadPack({
      ...pack,
      components: [{ ...infrastructureComponents[0], catalog: undefined }],
    }),
  ).toThrow();
});
it('searches products, aliases, capabilities and taxonomy without an engine workflow', () => {
  expect(
    searchComponents(defaultComponents, 'postgres').map((c) => c.name),
  ).toContain('PostgreSQL');
  expect(
    searchComponents(defaultComponents, 'redis').map((c) => c.name),
  ).toEqual(['Redis']);
  const messaging = searchComponents(defaultComponents, 'queue').map(
    (c) => c.name,
  );
  for (const name of ['Apache Kafka', 'Amazon SQS', 'RabbitMQ', 'Queue'])
    expect(messaging).toContain(name);
  expect(
    searchComponents(defaultComponents, 'networking').some(
      (c) => c.name === 'NGINX',
    ),
  ).toBe(true);
  expect(
    infrastructureComponents
      .find((c) => c.name === 'PostgreSQL')!
      .configurationSchema.some((f) => f.key === 'engine'),
  ).toBe(false);
});
it('validates contextual configuration rather than decorative controls', () => {
  const kafka = infrastructureComponents.find(
      (c) => c.name === 'Apache Kafka',
    )!,
    config = Object.fromEntries(
      kafka.configurationSchema.map((f) => [f.key, f.default]),
    );
  expect(
    configurationErrors(kafka, { ...config, brokers: 2, replicationFactor: 3 }),
  ).toContain('Replication factor cannot exceed broker count.');
  expect(configurationErrors(kafka, { ...config, partitions: 1.5 })).toContain(
    'Partition count must be a whole number.',
  );
  const redis = infrastructureComponents.find((c) => c.name === 'Redis')!;
  expect(
    configurationErrors(redis, {
      ...Object.fromEntries(
        redis.configurationSchema.map((f) => [f.key, f.default]),
      ),
      hitRatio: 1.5,
    }).join(' '),
  ).toContain('at most 1');
});
it('explicitly converts only known legacy databases without losing work', () => {
  const original = sampleDocument(),
    before = JSON.stringify(original);
  expect(legacyMapping(original, 'database')?.name).toBe('PostgreSQL');
  const upgraded = validateDocument(upgradeLegacyNode(original, 'database'));
  expect(
    upgraded.nodes.find((n) => n.id === 'database')!.configuration,
  ).toMatchObject(
    original.nodes.find((n) => n.id === 'database')!.configuration,
  );
  expect(upgraded.edges).toEqual(original.edges);
  expect(upgraded.views).toEqual(original.views);
  expect(JSON.stringify(original)).toBe(before);
  expect(parseDocument(JSON.parse(serializeDocument(upgraded)))).toEqual(
    upgraded,
  );
  const h = commit({ past: [], present: original, future: [] }, upgraded);
  expect(undo(h).present).toEqual(original);
  expect(redo(undo(h)).present).toEqual(upgraded);
  const ambiguous = structuredClone(original);
  ambiguous.components.find((c) => c.id === 'core.database')!.ports[0]!.label =
    'Custom protocol';
  expect(legacyMapping(ambiguous, 'database')).toBeUndefined();
  expect(() => upgradeLegacyNode(ambiguous, 'database')).toThrow('lossless');
});
it('preserves semantic compatibility and binds declared bounds only to existing profiles', () => {
  const d = upgradeLegacyNode(sampleDocument(), 'database');
  expect(
    compatibleRelationships(
      d,
      { nodeId: 'service', portId: 'out' },
      { nodeId: 'database', portId: 'in' },
    ),
  ).toContain('database-connection');
  const node = d.nodes.find((n) => n.id === 'database')!;
  const changed = configureNode(d, node.id, node.name, {
    ...node.configuration,
    storageGB: 200,
  });
  expect(changed.performanceProfiles).toEqual([]);
  d.performanceProfiles.push({
    id: 'profile',
    nodeId: 'database',
    model: 'database',
    serviceTime: { kind: 'constant', meanMs: 5 },
    serviceTimeScope: 'total',
    concurrency: 1,
    replicas: 1,
    scaling: 'none',
    maxReplicas: 100,
    targetUtilization: 0.7,
    capacityCurve: [],
    readReplicas: 0,
    provenance: {
      kind: 'measured',
      source: 'Test',
      recordedAt: '2026-10-11T00:00:00Z',
      context: 'Declared deployment',
      limitations: '',
    },
  });
  const configured = validateDocument(
    configureNode(d, node.id, node.name, {
      ...node.configuration,
      storageGB: 200,
    }),
  );
  expect(configured.performanceProfiles[0]!.storageBytes).toBe(200e9);
  expect(configured.performanceProfiles[0]!.provenance.kind).toBe('assumed');
  expect(d.performanceProfiles[0]!.provenance.kind).toBe('measured');
  expect(configured.performanceProfiles[0]!.provenance.limitations).toContain(
    'applicability',
  );
});
