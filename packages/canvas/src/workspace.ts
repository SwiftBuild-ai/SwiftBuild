import { z } from 'zod';
import {
  ArchitectureDocumentSchema,
  EngineeringSettingsSchema,
} from '@swiftbuild/architecture-schema';
import { validateDocument } from '@swiftbuild/graph-engine';
import type { Checkpoint } from '@swiftbuild/architecture-model';
import type { CapacityReport } from '@swiftbuild/capacity-engine';
import { DRAFT_KEY } from './storage';

const finite = z.number().finite();
const MetricSchema = z.object({
  id: z.string(),
  name: z.string(),
  value: finite.optional(),
  unit: z.string(),
  status: z.enum(['known', 'unknown', 'unstable']),
  formula: z.string(),
  inputs: z.record(z.string(), finite),
  assumptions: z.array(z.string()),
  limitations: z.array(z.string()),
  sources: z.array(z.string()),
  interval: z
    .object({
      lower: finite,
      upper: finite,
      level: finite.min(0).max(1),
      replications: z.number().int().positive(),
    })
    .optional(),
});
export const CapacityReportSchema = z.object({
  origin: z.enum(['computed', 'imported']).optional(),
  engineVersion: z.string(),
  modelVersion: z.string(),
  fingerprint: z.string(),
  scenarioId: z.string(),
  scenarioName: z.string().optional(),
  runSettings: EngineeringSettingsSchema.unwrap()
    .shape.simulation.unwrap()
    .optional(),
  kind: z.enum(['estimate', 'analytical', 'simulation']),
  status: z.enum(['complete', 'partial', 'cancelled']),
  metrics: z.array(MetricSchema),
  nodes: z.array(
    z.object({
      nodeId: z.string(),
      metrics: z.array(MetricSchema),
      bottleneck: z.boolean(),
    }),
  ),
  coverage: z.array(
    z.object({
      nodeId: z.string().optional(),
      edgeId: z.string().optional(),
      message: z.string(),
    }),
  ),
  assumptions: z.array(z.string()),
  accounting: z
    .object({
      offered: finite.nonnegative(),
      admitted: finite.nonnegative(),
      completed: finite.nonnegative(),
      failed: finite.nonnegative(),
      dropped: finite.nonnegative(),
      outstanding: finite.nonnegative(),
    })
    .optional(),
  series: z
    .array(
      z.object({
        seconds: finite,
        completed: finite,
        outstanding: finite,
        queueDepth: finite,
        dropped: finite,
      }),
    )
    .max(1000)
    .optional(),
  replications: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  traffic: z
    .array(
      z.object({ trafficClassId: z.string(), metrics: z.array(MetricSchema) }),
    )
    .optional(),
  processedEvents: z.number().int().nonnegative().optional(),
});
const CheckpointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  document: ArchitectureDocumentSchema,
});
export const ProjectArchiveSchema = z.object({
  format: z.literal('swiftbuild-project'),
  archiveVersion: z.literal('1.0'),
  document: ArchitectureDocumentSchema,
  checkpoints: z.array(CheckpointSchema),
  runs: z.array(CapacityReportSchema),
  exportedAt: z.string().datetime(),
});
export type ProjectArchive = {
  format: 'swiftbuild-project';
  archiveVersion: '1.0';
  document: z.infer<typeof ArchitectureDocumentSchema>;
  checkpoints: Checkpoint[];
  runs: CapacityReport[];
  exportedAt: string;
};
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export function workspaceFor(
  document: ProjectArchive['document'],
): ProjectArchive {
  return {
    format: 'swiftbuild-project',
    archiveVersion: '1.0',
    document,
    checkpoints: [],
    runs: [],
    exportedAt: new Date().toISOString(),
  };
}
export function validateArchive(input: unknown): ProjectArchive {
  // Migrations are explicit at every native document boundary.
  const shell = z
    .object({
      format: z.literal('swiftbuild-project'),
      archiveVersion: z.literal('1.0'),
      document: z.unknown(),
      checkpoints: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          createdAt: z.string(),
          document: z.unknown(),
        }),
      ),
      runs: z.array(z.unknown()),
      exportedAt: z.string(),
    })
    .parse(input);
  const archive = ProjectArchiveSchema.parse({
    ...shell,
    document: validateDocument(shell.document),
    checkpoints: shell.checkpoints.map((c) => ({
      ...c,
      document: validateDocument(c.document),
    })),
  });
  const ids = new Set<string>();
  for (const c of archive.checkpoints) {
    if (ids.has(c.id)) throw new Error(`Duplicate checkpoint ${c.id}.`);
    ids.add(c.id);
  }
  return archive;
}
export function serializeArchive(archive: ProjectArchive): string {
  const raw = JSON.stringify(validateArchive(archive), null, 2);
  if (new TextEncoder().encode(raw).length > MAX_ARCHIVE_BYTES)
    throw new Error(
      'Project archive exceeds 50 MB. Export individual architectures or remove historical runs explicitly.',
    );
  return raw;
}
export function importArchive(raw: string, size: number): ProjectArchive {
  if (
    size > MAX_ARCHIVE_BYTES ||
    new TextEncoder().encode(raw).length > MAX_ARCHIVE_BYTES
  )
    throw new Error('Project archive must be no larger than 50 MB.');
  const archive = validateArchive(JSON.parse(raw));
  archive.runs = archive.runs.map((run) => ({ ...run, origin: 'imported' }));
  return archive;
}
export interface WorkspaceAdapter {
  read(): Promise<unknown | null>;
  write(archive: ProjectArchive): Promise<void>;
}
export class IndexedWorkspace implements WorkspaceAdapter {
  private connection?: Promise<IDBDatabase>;
  private revision = 0;
  constructor(private factory: IDBFactory = indexedDB) {}
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
      const request = transaction.objectStore('workspace').get('current');
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
      const read = store.get('current');
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
          store.put({ ...valid, storageRevision: nextRevision }, 'current');
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
