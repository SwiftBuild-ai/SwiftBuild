import { validateDocument } from '@swiftbuild/graph-engine';
import {
  validateArchive,
  workspaceFor,
  type ProjectArchive,
  type WorkspaceAdapter,
} from '@swiftbuild/project-format';
import { DRAFT_KEY } from './storage';
export * from '@swiftbuild/project-format';

export class IndexedWorkspace implements WorkspaceAdapter {
  private connection?: Promise<IDBDatabase>;
  private revision = 0;
  constructor(
    private factory: IDBFactory = indexedDB,
    private key = 'current',
  ) {}
  private open() {
    if (!this.connection)
      this.connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open('swiftbuild-workspace', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('workspace');
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () =>
          reject(request.error ?? new Error('IndexedDB unavailable.'));
        request.onblocked = () =>
          reject(
            new Error(
              'Workspace upgrade is blocked by another tab. Close older workspace tabs.',
            ),
          );
      });
    return this.connection;
  }
  async read(): Promise<unknown | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readonly');
      const request = transaction.objectStore('workspace').get(this.key);
      let value: unknown = null;
      request.onsuccess = () => {
        value = request.result ?? null;
        this.revision =
          typeof request.result?.storageRevision === 'number'
            ? request.result.storageRevision
            : 0;
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = transaction.onerror = () =>
        reject(
          transaction.error ??
            request.error ??
            new Error('Workspace read failed.'),
        );
    });
  }
  async write(archive: ProjectArchive): Promise<void> {
    const valid = validateArchive(archive);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite');
      const store = transaction.objectStore('workspace');
      const read = store.get(this.key);
      let conflict: Error | undefined;
      const expectedRevision = this.revision;
      const nextRevision = expectedRevision + 1;
      read.onsuccess = () => {
        const revision =
          typeof read.result?.storageRevision === 'number'
            ? read.result.storageRevision
            : 0;
        if (revision !== expectedRevision) {
          conflict = new Error(
            'Workspace changed in another tab. Export your current work, then reload before saving.',
          );
          transaction.abort();
          return;
        }
        try {
          store.put({ ...valid, storageRevision: nextRevision }, this.key);
        } catch (error) {
          conflict =
            error instanceof Error
              ? error
              : new Error('Workspace write failed.');
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        this.revision = nextRevision;
        resolve();
      };
      transaction.onabort = transaction.onerror = () =>
        reject(
          conflict ??
            transaction.error ??
            new Error('Workspace transaction failed.'),
        );
    });
  }
}
export async function loadWorkspace(
  adapter: WorkspaceAdapter,
  legacyRead: () => string | null,
): Promise<
  | { status: 'loaded'; archive: ProjectArchive; migrated: boolean }
  | { status: 'empty' }
  | { status: 'error'; message: string }
> {
  try {
    const current = await adapter.read();
    if (current !== null)
      return {
        status: 'loaded',
        archive: validateArchive(current),
        migrated: false,
      };
    const legacy = legacyRead();
    if (legacy === null) return { status: 'empty' };
    if (new TextEncoder().encode(legacy).length > 5 * 1024 * 1024)
      throw new Error('Legacy draft exceeds 5 MB.');
    const archive = workspaceFor(validateDocument(JSON.parse(legacy)));
    try {
      await adapter.write(archive);
    } catch (error) {
      const concurrent = await adapter.read();
      if (concurrent !== null)
        return {
          status: 'loaded',
          archive: validateArchive(concurrent),
          migrated: false,
        };
      throw error;
    }
    return { status: 'loaded', archive, migrated: true };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Browser storage unavailable.',
    };
  }
}
export const readLegacyDraft = () => localStorage.getItem(DRAFT_KEY);
