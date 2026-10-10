import { it, expect } from 'vitest';
import { sampleDocument } from '@swiftbuild/components-core';
import {
  graphIssues,
  validateDocument,
  compatibleRelationships,
} from './index';
it('accepts the sample and preserves serialization', () => {
  const doc = sampleDocument();
  expect(graphIssues(doc)).toEqual([]);
  expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
});
it('rejects duplicate IDs, unknown references and configuration', () => {
  const doc = sampleDocument();
  doc.nodes.push(doc.nodes[0]!);
  doc.nodes[1]!.configuration.replicas = 0;
  doc.edges[0]!.target.portId = 'missing';
  expect(
    graphIssues(doc)
      .map((i) => i.message)
      .join(' '),
  ).toMatch(/Duplicate.*at least.*incompatible/);
});
it('allows only semantic intersections with correct direction', () => {
  const doc = sampleDocument();
  expect(
    compatibleRelationships(
      doc,
      { nodeId: 'service', portId: 'out' },
      { nodeId: 'database', portId: 'in' },
    ),
  ).toEqual(['database-connection']);
  expect(
    compatibleRelationships(
      doc,
      { nodeId: 'database', portId: 'in' },
      { nodeId: 'client', portId: 'out' },
    ),
  ).toEqual([]);
});
it('rejects dangling decision and deployment references', () => {
  const doc = sampleDocument();
  doc.decisions.push({
    id: 'decision',
    title: 'x',
    context: '',
    alternatives: [],
    reason: '',
    consequences: '',
    nodeIds: ['missing'],
    edgeIds: [],
    requirementIds: ['missing'],
    versionIds: [],
  });
  doc.deployments.push({
    id: 'deployment',
    nodeId: 'service',
    environmentId: 'missing',
    region: 'x',
    replicas: 1,
  });
  expect(graphIssues(doc)).toHaveLength(3);
});

it('rejects cyclic boundary containment', () => {
  const doc = sampleDocument();
  for (const [id, parentId] of [
    ['a', 'b'],
    ['b', 'a'],
  ] as const)
    doc.nodes.push({
      id,
      parentId,
      name: id,
      componentId: 'core.boundary',
      componentVersion: '1.0.0',
      configuration: { kind: 'Deployment', region: 'Primary' },
      metadata: {},
    });
  expect(
    graphIssues(doc).filter((i) => i.message.includes('cycle')),
  ).toHaveLength(2);
});
it('rejects dangling endpoint and view references', () => {
  const doc = sampleDocument();
  const bad = structuredClone(doc);
  bad.edges[0]!.target.nodeId = 'missing';
  expect(() => validateDocument(bad)).toThrow('incompatible');
  bad.edges = doc.edges;
  bad.views[0]!.nodeIds.push('missing');
  expect(() => validateDocument(bad)).toThrow('Missing node');
});
it('rejects missing layouts even when a node ID matches an inherited property', () => {
  const doc = sampleDocument();
  doc.nodes = [{ ...doc.nodes[0]!, id: 'toString' }];
  doc.edges = [];
  doc.views[0]!.nodeIds = ['toString'];
  doc.views[0]!.layout = {};
  expect(() => validateDocument(JSON.parse(JSON.stringify(doc)))).toThrow(
    'Missing layout for toString',
  );
});
