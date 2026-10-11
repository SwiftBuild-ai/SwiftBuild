import { expect, it } from 'vitest';
import { sampleDocument } from '@swiftbuild/components-core';
import {
  createCheckpoint,
  compareCheckpoints,
  restoreCheckpoint,
  inputFingerprint,
  undo,
} from './index';
it('compares semantics independently of layout and collection order', () => {
  const a = sampleDocument(),
    b = structuredClone(a);
  b.nodes.reverse();
  b.views[0]!.layout.client!.x += 10;
  const diff = compareCheckpoints(a, b);
  expect(diff.semanticChanged).toBe(false);
  expect(diff.layoutChanged).toBe(true);
  expect(diff.changes).toEqual([]);
  expect(inputFingerprint(a)).toBe(inputFingerprint(b));
});
it('restores a checkpoint with a recovery snapshot and an undoable edit', () => {
  const a = sampleDocument(),
    b = structuredClone(a);
  b.nodes[0]!.name = 'Changed';
  const checkpoint = createCheckpoint(
    a,
    'Original',
    'c',
    '2026-10-10T00:00:00Z',
  );
  const result = restoreCheckpoint(
    { past: [], present: b, future: [] },
    checkpoint,
    'recovery',
    '2026-10-10T01:00:00Z',
  );
  expect(result.recovery.document).toEqual(b);
  expect(result.history.present).toEqual(a);
  expect(undo(result.history).present).toEqual(b);
  a.nodes[0]!.name = 'After snapshot';
  expect(checkpoint.document.nodes[0]!.name).not.toBe('After snapshot');
});
it('ignores reordering of reference lists and declarative fields', () => {
  const a = sampleDocument();
  a.requirements.push({
    id: 'r',
    title: 'Review',
    description: 'Linked objects',
    nodeIds: ['client', 'service'],
  });
  const b = structuredClone(a);
  b.requirements[0]!.nodeIds.reverse();
  b.components[0]!.ports[0]!.relationships.reverse();
  b.components[1]!.configurationSchema.reverse();
  expect(compareCheckpoints(a, b).semanticChanged).toBe(false);
  expect(compareCheckpoints(a, b).changes).toEqual([]);
});
