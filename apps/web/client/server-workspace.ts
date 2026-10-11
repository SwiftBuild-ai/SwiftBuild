import {
  validateArchive,
  serializeArchive,
  type ProjectArchive,
  type WorkspaceAdapter,
} from '@swiftbuild/canvas/workspace';
import {
  checkedRecovery,
  type PendingSave,
  type Recovery,
  type RecoveryStore,
} from './project-recovery';
export type ServerProject = {
  id: string;
  workspaceId: string;
  revision: number;
  archive: ProjectArchive;
  role: 'owner' | 'editor' | 'viewer';
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function sameArchive(first: ProjectArchive, second: ProjectArchive) {
  const { exportedAt: _a, ...a } = first;
  const { exportedAt: _b, ...b } = second;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export class ServerWorkspace implements WorkspaceAdapter {
  private revision: number;
  private recovery?: Recovery;
  private initialized = false;
  private opened = false;
  private halted = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    readonly project: ServerProject,
    private store: RecoveryStore,
    private send: typeof fetch = fetch,
  ) {
    this.revision = project.revision;
  }
  async inspectRecovery(): Promise<Recovery | null> {
    if (!this.initialized) {
      const stored = await this.store.read();
      this.recovery = stored ? checkedRecovery(stored) : undefined;
      this.initialized = true;
    }
    return this.recovery?.dirty &&
      (!sameArchive(this.recovery.archive, this.project.archive) ||
        (this.recovery.pending &&
          !sameArchive(this.recovery.pending.archive, this.project.archive)))
      ? structuredClone(this.recovery)
      : null;
  }
  async openServerRevision(): Promise<void> {
    await this.inspectRecovery();
    const confirmed: Recovery = {
      version: 1,
      archive: this.project.archive,
      dirty: false,
    };
    await this.store.write(confirmed);
    this.recovery = confirmed;
  }
  async read(): Promise<ProjectArchive> {
    if (this.opened) return structuredClone(this.recovery!.archive);
    if (await this.inspectRecovery())
      throw new Error(
        'Unsaved recovery exists. Export it or save a separate project before opening the server revision.',
      );
    // The authorized snapshot establishes the starting revision; local cache never silently replaces it.
    this.recovery = { version: 1, archive: this.project.archive, dirty: false };
    this.opened = true;
    return structuredClone(this.project.archive);
  }
  write(input: ProjectArchive): Promise<void> {
    const next = this.queue.catch(() => {}).then(() => this.save(input));
    this.queue = next;
    return next;
  }
  private async flush(pending: PendingSave) {
    const response = await this.send(`/api/v1/projects/${this.project.id}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'if-match': `"${pending.revision}"`,
      },
      body: JSON.stringify({
        operationId: pending.operationId,
        archive: pending.archive,
      }),
    });
    if (!response.ok) {
      if ([401, 403, 404, 409, 412].includes(response.status))
        this.halted = true;
      throw new Error(
        response.status === 412 || response.status === 409
          ? 'The server project changed. Your recovery copy is preserved; export it or save a separate project.'
          : response.status === 401
            ? 'Your session expired. Recovery is preserved; sign in before reopening.'
            : response.status === 403 || response.status === 404
              ? 'Project access changed. Export your recovery copy before reopening.'
              : 'Server save failed. Recovery is preserved; retry or export your work.',
      );
    }
    const result = (await response.json()) as Partial<ServerProject>;
    if (
      result.id !== this.project.id ||
      result.workspaceId !== this.project.workspaceId ||
      !Number.isSafeInteger(result.revision) ||
      result.revision! < pending.revision ||
      result.revision! > pending.revision + 1 ||
      !sameArchive(validateArchive(result.archive), pending.archive)
    )
      throw new Error(
        'The server save could not be confirmed. Recovery and the retry operation are preserved.',
      );
    this.revision = result.revision!;
    this.recovery!.pending = undefined;
  }
  private async save(input: ProjectArchive) {
    if (!this.opened) await this.read();
    const archive = validateArchive(input);
    serializeArchive(archive);
    const oldPending = this.recovery?.pending;
    this.recovery = {
      version: 1,
      archive,
      dirty: true,
      ...(oldPending ? { pending: oldPending } : {}),
    };
    // Persist latest work before a network mutation. A failed local transaction stops the server save.
    await this.store.write(this.recovery);
    if (this.project.role === 'viewer') return;
    if (this.halted)
      throw new Error(
        'Saving is paused after a conflict or access change. Export recovery or save a separate project.',
      );
    if (oldPending) await this.flush(oldPending);
    if (!oldPending || !sameArchive(oldPending.archive, archive)) {
      const pending = {
        operationId: crypto.randomUUID(),
        revision: this.revision,
        archive,
      };
      this.recovery.pending = pending;
      await this.store.write(this.recovery);
      await this.flush(pending);
    }
    this.recovery.dirty = false;
    await this.store.write(this.recovery);
  }
}
