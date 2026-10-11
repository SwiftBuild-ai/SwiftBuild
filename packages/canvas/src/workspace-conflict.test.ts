import { IDBFactory } from 'fake-indexeddb';
import { it, expect } from 'vitest';
import { blankDocument } from '@swiftbuild/components-core';
import { IndexedWorkspace, workspaceFor } from './workspace';
it('rejects a stale tab write without overwriting another tab', async () => {
  const factory = new IDBFactory();
  const first = new IndexedWorkspace(factory),
    second = new IndexedWorkspace(factory);
  await first.read();
  await second.read();
  const archive = workspaceFor(blankDocument());
  await first.write(archive);
  const stale = structuredClone(archive);
  stale.document.project.name = 'Stale writer';
  await expect(second.write(stale)).rejects.toThrow('another tab');
  expect(await first.read()).toMatchObject(archive);
});
