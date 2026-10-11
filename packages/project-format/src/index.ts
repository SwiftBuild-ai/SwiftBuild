import { z } from 'zod';
import {
  ArchitectureDocumentSchema,
  EngineeringSettingsSchema,
} from '@swiftbuild/architecture-schema';
import { validateDocument } from '@swiftbuild/graph-engine';
import type { Checkpoint } from '@swiftbuild/architecture-model';
import type { CapacityReport } from '@swiftbuild/capacity-engine';

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
