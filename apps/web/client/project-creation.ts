import {
  validateArchive,
  serializeArchive,
  type ProjectArchive,
} from '@swiftbuild/canvas/workspace';
import { createProject } from './project-api';

export type CreationIntent = {
  version: 1;
  userId: string;
  workspaceId: string;
  operationId: string;
  archive: ProjectArchive;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checked(input: CreationIntent): CreationIntent {
  if (
    input.version !== 1 ||
    !input.userId ||
    !uuid.test(input.workspaceId) ||
    !uuid.test(input.operationId)
  )
    throw new Error(
      'Creation recovery is invalid. Preserve stored work before replacing it.',
    );
  const archive = validateArchive(input.archive);
  serializeArchive(archive);
  return { ...input, archive };
}
/** Host-owned browser recovery, scoped to the signed-in actor; server permissions still apply. */
export class ProjectCreation {
  constructor(
    private userId: string,
    private factory?: IDBFactory,
  ) {}
  private async open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = (this.factory ?? indexedDB).open(
        'swiftbuild-server-creation',
        1,
      );
      request.onupgradeneeded = () =>
        request.result.createObjectStore('intents');
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error(
            'Close older project tabs before opening creation recovery.',
          ),
        );
    });
  }
  private async transaction<T>(
    workspaceId: string,
    write: boolean,
    action: (
      store: IDBObjectStore,
      key: string,
      done: (value: T) => void,
    ) => void,
  ): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction('intents', write ? 'readwrite' : 'readonly', {
            durability: 'strict',
          });
        } catch (error) {
          if (!(error instanceof TypeError)) {
            reject(error);
            return;
          }
          tx = db.transaction('intents', write ? 'readwrite' : 'readonly');
        }
        let value: T;
        let failure: unknown;
        const store = tx.objectStore('intents');
        try {
          action(
            store,
            JSON.stringify([this.userId, workspaceId]),
            (result) => {
              value = result;
            },
          );
        } catch (error) {
          failure = error;
          tx.abort();
        }
        tx.oncomplete = () => resolve(value);
        tx.onabort = tx.onerror = () =>
          reject(
            failure ??
              tx.error ??
              new Error('Creation recovery transaction failed.'),
          );
      });
    } finally {
      db.close();
    }
  }
  read(workspaceId: string) {
    return this.transaction<CreationIntent | null>(
      workspaceId,
      false,
      (store, key, done) => {
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const value = request.result ? checked(request.result) : null;
            if (
              value &&
              (value.userId !== this.userId ||
                value.workspaceId !== workspaceId)
            )
              throw new Error('Creation recovery scope is invalid.');
            done(value);
          } catch {
            store.transaction.abort();
          }
        };
      },
    );
  }
  async prepare(workspaceId: string, archive: ProjectArchive) {
    const intent = checked({
      version: 1,
      userId: this.userId,
      workspaceId,
      operationId: crypto.randomUUID(),
      archive,
    });
    await this.transaction<void>(workspaceId, true, (store, key, done) => {
      store.add(intent, key);
      done(undefined);
    });
    return intent;
  }
  async submit(intent: CreationIntent) {
    if (intent.userId !== this.userId)
      throw new Error('Creation recovery belongs to another account.');
    const stored = await this.read(intent.workspaceId);
    if (!stored || stored.operationId !== intent.operationId)
      throw new Error(
        'Creation recovery changed in another tab. Reopen projects before retrying.',
      );
    const result = await createProject(
      stored.workspaceId,
      stored.archive,
      stored.operationId,
      this.userId,
    );
    await this.transaction<void>(
      stored.workspaceId,
      true,
      (store, key, done) => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result?.operationId === stored.operationId)
            store.delete(key);
          done(undefined);
        };
      },
    );
    return result;
  }
}
