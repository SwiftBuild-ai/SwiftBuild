import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { blankDocument } from '../../../packages/components-core/src/index';
import {
  workspaceFor,
  type ProjectArchive,
} from '@swiftbuild/canvas/workspace';
import {
  BrowserProjectRecovery,
  clearConfirmedRecovery,
  type Recovery,
  type RecoveryStore,
} from './project-recovery';
import { ServerWorkspace, type ServerProject } from './server-workspace';
const uuid = () => crypto.randomUUID();
function fixture() {
  const archive = workspaceFor(blankDocument());
  const project: ServerProject = {
    id: uuid(),
    workspaceId: uuid(),
    revision: 1,
    archive,
    role: 'editor',
  };
  let data: Recovery | null = null;
  const store: RecoveryStore = {
    read: async () => structuredClone(data),
    write: async (value) => {
      data = structuredClone(value);
    },
  };
  return { project, store, data: () => data };
}
const changed = (archive: ProjectArchive, name: string) => {
  const next = structuredClone(archive);
  next.document.architecture.name = name;
  return next;
};
describe('server workspace recovery and retry protocol', () => {
  it('retains a lost restore response across reload and retries its exact source and base', async () => {
    const { project, store, data } = fixture();
    const restored = changed(project.archive, 'Historical');
    const send = vi.fn<typeof fetch>(async (url, options) => {
      expect(String(url)).toBe(`/api/v1/projects/${project.id}/restore`);
      expect(options?.method).toBe('POST');
      expect(new Headers(options?.headers).get('if-match')).toBe('"1"');
      expect(data()?.pending).toMatchObject({
        kind: 'restore',
        sourceRevision: 1,
        revision: 1,
      });
      if (send.mock.calls.length === 1) throw new Error('response lost');
      return Response.json({ ...project, revision: 2, archive: restored });
    });
    const adapter = new ServerWorkspace(project, store, send);
    await adapter.read();
    await expect(adapter.restore(1, restored)).rejects.toThrow('response lost');
    const reopened = new ServerWorkspace(
      { ...project, revision: 2, archive: restored },
      store,
      send,
    );
    expect((await reopened.inspectRecovery())?.pending?.kind).toBe('restore');
    await reopened.retryRestore();
    expect(send.mock.calls[0]?.[1]?.body).toBe(send.mock.calls[1]?.[1]?.body);
    expect(data()).toMatchObject({ dirty: false, archive: restored });
  });
  it('refuses restoration while a save is unresolved or for viewer previews', async () => {
    const { project, store } = fixture();
    const send = vi.fn<typeof fetch>(async () => {
      throw new Error('offline');
    });
    const adapter = new ServerWorkspace(project, store, send);
    await adapter.read();
    await expect(
      adapter.write(changed(project.archive, 'unsaved')),
    ).rejects.toThrow('offline');
    await expect(adapter.restore(1, project.archive)).rejects.toThrow(
      'Preserve unsaved',
    );
    const other = fixture();
    const viewer = new ServerWorkspace(
      { ...other.project, role: 'viewer' },
      other.store,
      send,
    );
    await viewer.read();
    await expect(viewer.restore(1, other.project.archive)).rejects.toThrow(
      'Preserve unsaved',
    );
  });
  it('calls the native browser transport with its global receiver', async () => {
    const { project, store } = fixture();
    const original = globalThis.fetch;
    globalThis.fetch = async function (this: unknown, _input, options) {
      expect(this).toBe(globalThis);
      const body = JSON.parse(String(options?.body));
      return Response.json({ ...project, revision: 1, archive: body.archive });
    };
    try {
      const adapter = new ServerWorkspace(project, store);
      await adapter.read();
      await adapter.write(project.archive);
    } finally {
      globalThis.fetch = original;
    }
  });
  it('resolves a lost response with the original operation before sending a newer edit', async () => {
    const { project, store, data } = fixture();
    const requests: {
      operationId: string;
      archive: ProjectArchive;
      tag: string | null;
    }[] = [];
    const send = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      requests.push({
        ...body,
        tag: new Headers(options?.headers).get('if-match'),
      });
      expect(data()?.dirty).toBe(true);
      expect(data()?.pending?.operationId).toBe(body.operationId);
      if (requests.length === 1)
        throw new TypeError('Response lost after commit');
      return Response.json({
        ...project,
        revision: requests.length === 2 ? 2 : 3,
        archive: body.archive,
      });
    });
    const adapter = new ServerWorkspace(project, store, send);
    await adapter.read();
    const first = changed(project.archive, 'First edit'),
      second = changed(project.archive, 'Later edit');
    await expect(adapter.write(first)).rejects.toThrow('Response lost');
    await adapter.write(second);
    expect(requests.map((r) => r.tag)).toEqual(['"1"', '"1"', '"2"']);
    expect(requests[0]?.operationId).toBe(requests[1]?.operationId);
    expect(requests[2]?.operationId).not.toBe(requests[0]?.operationId);
    expect(requests[1]?.archive).toEqual(first);
    expect(requests[2]?.archive).toEqual(second);
    expect(data()).toMatchObject({ archive: second, dirty: false });
    expect(data()?.pending).toBeUndefined();
  });
  it('preserves the latest edit and stops network writes after a stale revision', async () => {
    const { project, store, data } = fixture();
    const send = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 412 }),
    );
    const adapter = new ServerWorkspace(project, store, send);
    await adapter.read();
    await expect(
      adapter.write(changed(project.archive, 'Conflict')),
    ).rejects.toThrow('server project changed');
    const latest = changed(project.archive, 'Still editing');
    await expect(adapter.write(latest)).rejects.toThrow('paused');
    expect(send).toHaveBeenCalledTimes(1);
    expect(data()?.archive).toEqual(latest);
    expect(data()?.dirty).toBe(true);
    expect(data()?.pending?.archive.document.architecture.name).toBe(
      'Conflict',
    );
  });
  it('does not mutate the server when recovery storage fails', async () => {
    const { project } = fixture();
    const send = vi.fn<typeof fetch>();
    const adapter = new ServerWorkspace(
      project,
      {
        read: async () => null,
        write: async () => {
          throw new Error('Quota exceeded');
        },
      },
      send,
    );
    await expect(
      adapter.write(changed(project.archive, 'Unsaved')),
    ).rejects.toThrow('Quota exceeded');
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps viewer edits local and offers dirty recovery on reopen', async () => {
    const { project, store, data } = fixture();
    project.role = 'viewer';
    const send = vi.fn<typeof fetch>();
    const adapter = new ServerWorkspace(project, store, send);
    const preview = changed(project.archive, 'Local preview');
    await adapter.read();
    await adapter.write(preview);
    expect(send).not.toHaveBeenCalled();
    expect(data()).toMatchObject({ dirty: true, archive: preview });
    const reopened = new ServerWorkspace(project, store, send);
    expect((await reopened.inspectRecovery())?.archive).toEqual(preview);
    await expect(reopened.read()).rejects.toThrow('Unsaved recovery');
    await reopened.openServerRevision();
    expect(await reopened.read()).toEqual(project.archive);
  });
  it('preserves an uncertain older operation even when the latest edit reverts to the server snapshot', async () => {
    const { project, store } = fixture();
    const pending = {
      operationId: uuid(),
      revision: 1,
      archive: changed(project.archive, 'Uncertain committed edit'),
    };
    await store.write({
      version: 1,
      dirty: true,
      archive: project.archive,
      pending,
    });
    const reopened = new ServerWorkspace(project, store);
    expect((await reopened.inspectRecovery())?.pending).toEqual(pending);
    await expect(reopened.read()).rejects.toThrow('Unsaved recovery');
  });
  it('recognizes a committed recovery archive despite export timestamps and object key order', async () => {
    const { project, store } = fixture();
    const archive = { ...project.archive, exportedAt: '2026-10-11T00:00:00Z' };
    await store.write({
      version: 1,
      archive,
      dirty: true,
      pending: { operationId: uuid(), revision: 1, archive },
    });
    expect(
      await new ServerWorkspace(project, store).inspectRecovery(),
    ).toBeNull();
  });
  it('does not overwrite inspected dirty recovery before the host makes an explicit choice', async () => {
    const { project, store, data } = fixture();
    const archive = changed(project.archive, 'Unresolved local work');
    await store.write({ version: 1, dirty: true, archive });
    const send = vi.fn<typeof fetch>();
    const adapter = new ServerWorkspace(project, store, send);
    await adapter.inspectRecovery();
    await expect(adapter.write(project.archive)).rejects.toThrow(
      'Unsaved recovery',
    );
    expect(data()?.archive).toEqual(archive);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects invalid confirmation responses and retains the same retry operation', async () => {
    const { project, store, data } = fixture();
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({ ...project, revision: 2, archive: project.archive }),
    );
    const adapter = new ServerWorkspace(project, store, send);
    await adapter.read();
    await expect(
      adapter.write(changed(project.archive, 'Expected payload')),
    ).rejects.toThrow('could not be confirmed');
    expect(data()?.pending).toBeDefined();
    expect(data()?.dirty).toBe(true);
  });
});
describe('transactional browser recovery', () => {
  it('clears only the selected user confirmed caches while retaining dirty and other-user records', async () => {
    const factory = new IDBFactory();
    const confirmed = new BrowserProjectRecovery(
      'user-a:confirmed',
      () => factory,
    );
    const dirty = new BrowserProjectRecovery('user-a:dirty', () => factory);
    const other = new BrowserProjectRecovery('user-b:confirmed', () => factory);
    const { project } = fixture();
    await confirmed.write({
      version: 1,
      archive: project.archive,
      dirty: false,
    });
    await dirty.write({ version: 1, archive: project.archive, dirty: true });
    await other.write({ version: 1, archive: project.archive, dirty: false });
    expect(await clearConfirmedRecovery('user-a', factory)).toBe(1);
    expect(await confirmed.read()).toBeNull();
    expect((await dirty.read())?.dirty).toBe(true);
    expect(await other.read()).not.toBeNull();
  });
  it('isolates users/projects and rejects stale tabs before replacement', async () => {
    const factory = new IDBFactory(),
      one = new BrowserProjectRecovery('user-a:project-a', () => factory),
      two = new BrowserProjectRecovery('user-b:project-a', () => factory),
      stale = new BrowserProjectRecovery('user-a:project-a', () => factory);
    const { project } = fixture();
    const record: Recovery = {
      version: 1,
      dirty: true,
      archive: project.archive,
      pending: { operationId: uuid(), revision: 1, archive: project.archive },
    };
    await one.write(record);
    expect(await two.read()).toBeNull();
    await stale.read();
    const latest = {
      ...record,
      archive: changed(project.archive, 'Latest recovery'),
    };
    await one.write(latest);
    await expect(stale.write(record)).rejects.toThrow('changed in another tab');
    expect(await one.read()).toEqual(latest);
  });
  it('rejects unsupported recovery without overwriting the stored archive', async () => {
    const recovery = new BrowserProjectRecovery(
      'user:project',
      () => new IDBFactory(),
    );
    const { project } = fixture();
    await recovery.write({
      version: 1,
      archive: project.archive,
      dirty: false,
    });
    await expect(
      recovery.write({
        version: 3,
        archive: project.archive,
        dirty: false,
      } as unknown as Recovery),
    ).rejects.toThrow('unsupported');
    expect((await recovery.read())?.archive).toEqual(project.archive);
  });
});
