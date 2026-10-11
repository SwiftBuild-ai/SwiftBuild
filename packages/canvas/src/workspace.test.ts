import { expect, it, vi } from 'vitest';
import { IDBFactory, IDBDatabase as SimulatedDatabase } from 'fake-indexeddb';
import { blankDocument } from '@swiftbuild/components-core';
import { createCheckpoint } from '@swiftbuild/architecture-model';
import {
  IndexedWorkspace,
  loadWorkspace,
  workspaceFor,
  importArchive,
  serializeArchive,
} from './workspace';
it('migrates a legacy draft transactionally and preserves original raw data', async () => {
  const adapter = new IndexedWorkspace(new IDBFactory());
  const legacy = JSON.stringify({ ...blankDocument(), schemaVersion: '1.0' });
  const loaded = await loadWorkspace(adapter, () => legacy);
  expect(loaded.status).toBe('loaded');
  if (loaded.status === 'loaded') {
    expect(loaded.migrated).toBe(true);
    expect(loaded.archive.document.schemaVersion).toBe('1.1');
  }
  expect(
    (
      await loadWorkspace(adapter, () => {
        throw new Error('Must not reread old draft.');
      })
    ).status,
  ).toBe('loaded');
  expect(JSON.parse(legacy).schemaVersion).toBe('1.0');
});
it('preserves current workspace after rejected archives and failed transactions', async () => {
  const adapter = new IndexedWorkspace(new IDBFactory()),
    archive = workspaceFor(blankDocument());
  archive.checkpoints.push(
    createCheckpoint(archive.document, 'First', 'c', '2026-10-10T00:00:00Z'),
  );
  await adapter.write(archive);
  expect(importArchive(serializeArchive(archive), 10)).toEqual(archive);
  expect(() => importArchive('{bad', 4)).toThrow();
  expect(await adapter.read()).toMatchObject(archive);
  const failed = {
    read: async () => null,
    write: async () => {
      throw new Error('Quota exceeded');
    },
  };
  const result = await loadWorkspace(failed, () =>
    JSON.stringify(archive.document),
  );
  expect(result.status).toBe('error');
});
it('does not overwrite corrupt drafts', async () => {
  let writes = 0;
  const result = await loadWorkspace(
    {
      read: async () => null,
      write: async () => {
        writes++;
      },
    },
    () => '{invalid',
  );
  expect(result.status).toBe('error');
  expect(writes).toBe(0);
});
it('retains the prior workspace when an in-flight transaction is interrupted', async () => {
  const adapter = new IndexedWorkspace(new IDBFactory());
  const initial = workspaceFor(blankDocument());
  await adapter.write(initial);
  const original = SimulatedDatabase.prototype.transaction;
  const spy = vi
    .spyOn(SimulatedDatabase.prototype, 'transaction')
    .mockImplementation(function (this: IDBDatabase, ...args) {
      const transaction = original.apply(this, args);
      if (args[1] === 'readwrite') queueMicrotask(() => transaction.abort());
      return transaction;
    });
  try {
    const changed = structuredClone(initial);
    changed.document.architecture.name = 'Interrupted change';
    await expect(adapter.write(changed)).rejects.toThrow();
    expect(await adapter.read()).toMatchObject(initial);
  } finally {
    spy.mockRestore();
  }
});
it('keeps namespaced recovery archives independent of the browser draft and other users', async () => {
  const factory = new IDBFactory();
  const draft = new IndexedWorkspace(factory);
  const first = new IndexedWorkspace(factory, 'server:user-one:project-one');
  const second = new IndexedWorkspace(factory, 'server:user-two:project-one');
  const localArchive = workspaceFor(blankDocument());
  const recovery = workspaceFor(blankDocument());
  recovery.document.architecture.name = 'Independent recovery';
  await draft.write(localArchive);
  await first.write(recovery);
  expect(await draft.read()).toMatchObject(localArchive);
  expect(await first.read()).toMatchObject(recovery);
  expect(await second.read()).toBeNull();
  await second.write(localArchive);
  expect(await first.read()).toMatchObject(recovery);
  const stale = new IndexedWorkspace(factory, 'server:user-one:project-one');
  await stale.read();
  await first.write(localArchive);
  await expect(stale.write(recovery)).rejects.toThrow('changed in another tab');
  expect(await draft.read()).toMatchObject(localArchive);
});
