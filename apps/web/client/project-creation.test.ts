import { describe, it, expect, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { workspaceFor } from '@swiftbuild/canvas/workspace';
import { blankDocument } from '@swiftbuild/components-core';
import { ProjectCreation } from './project-creation';
describe('durable creation intents', () => {
  it('persists before transport, reloads the original request, and clears only a confirmed response', async () => {
    const factory = new IDBFactory(),
      workspace = crypto.randomUUID();
    const first = new ProjectCreation('owner', factory);
    const intent = await first.prepare(
      workspace,
      workspaceFor(blankDocument()),
    );
    const reloaded = new ProjectCreation('owner', factory);
    expect(await reloaded.read(workspace)).toEqual(intent);
    const original = globalThis.fetch;
    const id = crypto.randomUUID();
    const send = vi.fn<typeof fetch>(async (_url, options) => {
      expect(await reloaded.read(workspace)).toEqual(intent);
      expect(JSON.parse(String(options?.body))).toEqual({
        workspaceId: workspace,
        archive: intent.archive,
        operationId: intent.operationId,
        expectedActorId: 'owner',
      });
      if (send.mock.calls.length === 1) throw new Error('lost response');
      return Response.json({
        id,
        workspaceId: workspace,
        revision: 1,
        archive: intent.archive,
      });
    });
    globalThis.fetch = send;
    try {
      await expect(first.submit(intent)).rejects.toThrow('lost response');
      expect(await reloaded.submit(intent)).toMatchObject({ id });
      expect(await first.read(workspace)).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
  it('rejects competing insertion and isolates accounts and workspaces', async () => {
    const factory = new IDBFactory(),
      workspace = crypto.randomUUID();
    const first = new ProjectCreation('owner', factory),
      second = new ProjectCreation('owner', factory);
    const archive = workspaceFor(blankDocument());
    const outcomes = await Promise.allSettled([
      first.prepare(workspace, archive),
      second.prepare(workspace, archive),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const intent = (await first.read(workspace))!;
    expect(
      await new ProjectCreation('other', factory).read(workspace),
    ).toBeNull();
    expect(await first.read(crypto.randomUUID())).toBeNull();
    await expect(
      new ProjectCreation('other', factory).submit(intent),
    ).rejects.toThrow('another account');
  });
  it('retains intents after denied or malformed responses and stops before sending on storage failure', async () => {
    const factory = new IDBFactory(),
      workspace = crypto.randomUUID();
    const store = new ProjectCreation('owner', factory);
    const intent = await store.prepare(
      workspace,
      workspaceFor(blankDocument()),
    );
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: { message: 'Denied' } }, { status: 403 }),
    );
    try {
      await expect(store.submit(intent)).rejects.toThrow('Denied');
      globalThis.fetch = vi.fn(async () =>
        Response.json({
          id: crypto.randomUUID(),
          workspaceId: workspace,
          revision: 2,
          archive: intent.archive,
        }),
      );
      await expect(store.submit(intent)).rejects.toThrow(
        'could not be confirmed',
      );
      expect(await store.read(workspace)).toEqual(intent);
      const broken = new ProjectCreation('owner', {
        open: () => {
          throw new Error('storage unavailable');
        },
      } as unknown as IDBFactory);
      await expect(broken.prepare(workspace, intent.archive)).rejects.toThrow(
        'storage unavailable',
      );
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
