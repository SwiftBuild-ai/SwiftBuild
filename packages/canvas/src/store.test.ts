import { sampleDocument } from '@swiftbuild/components-core';
import { it, expect } from 'vitest';
import { createEditorStore } from './store';
import { coreComponents } from '@swiftbuild/components-core';
it('does not commit invalid configuration and preserves undo semantics', () => {
  const store = createEditorStore(sampleDocument());
  const original = store.getState().history.present;
  store.getState().apply((d) => {
    d.nodes[1]!.configuration.replicas = 0;
  });
  expect(store.getState().history.present).toBe(original);
  expect(store.getState().message).toContain('at least');
  store.getState().select(['service']);
  store.getState().remove();
  expect(store.getState().history.present.nodes).toHaveLength(3);
  store.getState().undo();
  expect(store.getState().history.present).toEqual(original);
});
it('adds valid primitives with one history entry', () => {
  const store = createEditorStore(sampleDocument());
  store.getState().add(coreComponents[4]!);
  expect(store.getState().history.present.nodes).toHaveLength(5);
  expect(store.getState().history.past).toHaveLength(1);
});
