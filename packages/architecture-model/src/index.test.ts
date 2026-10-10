import { it, expect } from 'vitest';
import { sampleDocument } from '@swiftbuild/components-core';
import {
  moveNode,
  semanticSnapshot,
  deleteNodes,
  duplicateNodes,
  commit,
  undo,
  redo,
} from './index';
it('moving preserves semantics and original document', () => {
  const doc = sampleDocument();
  const moved = moveNode(doc, 'database', { x: 50, y: 70 });
  expect(semanticSnapshot(moved)).toBe(semanticSnapshot(doc));
  expect(doc.views[0]!.layout.database!.x).toBe(770);
});
it('delete removes incident edges and view references', () => {
  const doc = deleteNodes(sampleDocument(), ['service']);
  expect(doc.edges).toEqual([]);
  expect(doc.views[0]!.layout.service).toBeUndefined();
  expect(doc.nodes).toHaveLength(3);
});
it('duplicate remaps internal connections with fresh IDs', () => {
  let i = 0;
  const result = duplicateNodes(
    sampleDocument(),
    ['client', 'service'],
    () => `new-${i++}`,
  );
  expect(result.ids).toHaveLength(2);
  expect(result.document.edges.at(-1)!.source.nodeId).toBe('new-0');
  expect(result.document.edges.at(-1)!.target.nodeId).toBe('new-1');
});
it('history restores semantic and layout changes and drops redo after edit', () => {
  const doc = sampleDocument();
  const changed = moveNode(doc, 'database', { x: 1, y: 2 });
  const h = commit({ past: [], present: doc, future: [] }, changed);
  expect(undo(h).present).toEqual(doc);
  expect(redo(undo(h)).present).toEqual(changed);
  expect(commit(undo(h), deleteNodes(doc, ['cache'])).future).toEqual([]);
});

it('duplicates boundary contents without shifting child-relative layouts', () => {
  const doc = sampleDocument();
  doc.nodes.push({
    id: 'boundary',
    name: 'Deployment',
    componentId: 'core.boundary',
    componentVersion: '1.0.0',
    configuration: { kind: 'Deployment', region: 'Primary' },
    metadata: {},
  });
  doc.nodes[1]!.parentId = 'boundary';
  doc.views[0]!.nodeIds.push('boundary');
  doc.views[0]!.layout.boundary = { x: 100, y: 100, width: 560, height: 360 };
  doc.views[0]!.layout.service = { x: 32, y: 80 };
  let i = 0;
  const copy = duplicateNodes(doc, ['boundary'], () => `copy-${i++}`).document;
  const copiedService = copy.nodes.find(
    (n) => n.name === 'Storefront API copy',
  )!;
  expect(copy.views[0]!.layout[copiedService.id]).toEqual(
    doc.views[0]!.layout.service,
  );
  expect(copiedService.parentId).not.toBe('boundary');
  expect(
    deleteNodes(doc, ['boundary']).nodes.some((n) => n.id === 'service'),
  ).toBe(false);
});
