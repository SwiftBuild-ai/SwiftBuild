import {
  validateArchive,
  serializeArchive,
  type ProjectArchive,
} from '@swiftbuild/canvas/workspace';
export type PendingSave = {
  operationId: string;
  revision: number;
  archive: ProjectArchive;
};
export type Recovery = {
  version: 1;
  archive: ProjectArchive;
  dirty: boolean;
  pending?: PendingSave;
};
export interface RecoveryStore {
  read(): Promise<Recovery | null>;
  write(value: Recovery): Promise<void>;
}
export function checkedRecovery(input: unknown): Recovery {
  if (!input || typeof input !== 'object')
    throw new Error(
      'Recovery data is invalid. Export stored work before replacing it.',
    );
  const value = input as Partial<Recovery>;
  if (value.version !== 1 || typeof value.dirty !== 'boolean')
    throw new Error('Recovery format is unsupported.');
  const archive = validateArchive(value.archive);
  serializeArchive(archive);
  let pending: PendingSave | undefined;
  if (value.pending) {
    const p = value.pending;
    if (
      !value.dirty ||
      !Number.isSafeInteger(p.revision) ||
      p.revision < 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        p.operationId,
      )
    )
      throw new Error('Pending recovery operation is invalid.');
    pending = {
      operationId: p.operationId,
      revision: p.revision,
      archive: validateArchive(p.archive),
    };
    serializeArchive(pending.archive);
  }
  return {
    version: 1,
    archive,
    dirty: value.dirty,
    ...(pending ? { pending } : {}),
  };
}
/** Browser-only cache. Keys isolate users/projects; this is not an authorization boundary. */
export class BrowserProjectRecovery implements RecoveryStore {
  private connection?: Promise<IDBDatabase>;
  private revision = 0;
  constructor(
    private key: string,
    private factory: () => IDBFactory = () => indexedDB,
  ) {}
  private open() {
    if (!this.connection)
      this.connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory().open('swiftbuild-server-recovery', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('projects');
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () =>
          reject(
            request.error ?? new Error('Recovery storage is unavailable.'),
          );
        request.onblocked = () =>
          reject(
            new Error(
              'Close older project tabs before upgrading recovery storage.',
            ),
          );
      });
    return this.connection;
  }
  async read(): Promise<Recovery | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly');
      const read = tx.objectStore('projects').get(this.key);
      let result: Recovery | null = null;
      let failure: unknown;
      read.onsuccess = () => {
        try {
          if (read.result) {
            this.revision = read.result.storageRevision;
            if (!Number.isSafeInteger(this.revision) || this.revision < 1)
              throw new Error('Recovery storage revision is invalid.');
            result = checkedRecovery(read.result);
          }
        } catch (error) {
          failure = error;
        }
      };
      tx.oncomplete = () => (failure ? reject(failure) : resolve(result));
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? read.error ?? new Error('Recovery read failed.'));
    });
  }
  async write(input: Recovery): Promise<void> {
    const value = checkedRecovery(input);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      const store = tx.objectStore('projects');
      const read = store.get(this.key);
      const next = this.revision + 1;
      let failure: unknown;
      read.onsuccess = () => {
        if ((read.result?.storageRevision ?? 0) !== this.revision) {
          failure = new Error(
            'Recovery changed in another tab. Export your current work before reopening the project.',
          );
          tx.abort();
          return;
        }
        try {
          store.put({ ...value, storageRevision: next }, this.key);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        this.revision = next;
        resolve();
      };
      tx.onabort = tx.onerror = () =>
        reject(failure ?? tx.error ?? new Error('Recovery save failed.'));
    });
  }
}
