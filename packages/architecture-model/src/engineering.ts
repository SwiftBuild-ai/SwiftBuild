import {
  parseDocument,
  VersionSchema,
  type ArchitectureDocument,
} from '@swiftbuild/architecture-schema';
import { editDocument, commit, type History } from './index';

export type Checkpoint = {
  id: string;
  name: string;
  createdAt: string;
  document: ArchitectureDocument;
};
export function createCheckpoint(
  document: ArchitectureDocument,
  name: string,
  id: string,
  createdAt: string,
): Checkpoint {
  if (!name.trim()) throw new Error('Checkpoint name is required.');
  VersionSchema.parse({ id, name: name.trim(), createdAt });
  return {
    id,
    name: name.trim(),
    createdAt,
    document: structuredClone(parseDocument(document)),
  };
}
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map(canonical);
    return mapped.every((v) => v && typeof v === 'object' && 'id' in v)
      ? mapped.sort((a, b) =>
          compareKeys(
            String((a as { id: string }).id),
            String((b as { id: string }).id),
          ),
        )
      : mapped.sort((a, b) =>
          compareKeys(JSON.stringify(a), JSON.stringify(b)),
        );
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compareKeys(a, b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function inputFingerprint(document: ArchitectureDocument): string {
  const {
    views: _views,
    findings: _findings,
    versions: _versions,
    estimates: _estimates,
    assessments: _assessments,
    ...input
  } = document;
  // Retain the canonical input rather than a collision-prone short hash.
  return JSON.stringify(canonical(input));
}
export function compareCheckpoints(
  before: ArchitectureDocument,
  after: ArchitectureDocument,
) {
  const collections = [
    'components',
    'environments',
    'deployments',
    'annotations',
    'assessments',
    'nodes',
    'edges',
    'requirements',
    'nonFunctionalRequirements',
    'decisions',
    'scenarios',
    'performanceProfiles',
    'flowPolicies',
  ] as const;
  const changes: {
    collection: string;
    id: string;
    kind: 'added' | 'removed' | 'changed';
  }[] = [];
  for (const collection of collections) {
    const old = new Map(before[collection].map((v) => [v.id, v] as const));
    const next = new Map(after[collection].map((v) => [v.id, v] as const));
    for (const [id, v] of old)
      if (!next.has(id)) changes.push({ collection, id, kind: 'removed' });
      else if (
        JSON.stringify(canonical(v)) !== JSON.stringify(canonical(next.get(id)))
      )
        changes.push({ collection, id, kind: 'changed' });
    for (const id of next.keys())
      if (!old.has(id)) changes.push({ collection, id, kind: 'added' });
  }
  for (const collection of [
    'project',
    'architecture',
    'engineering',
    'metadata',
  ] as const)
    if (
      JSON.stringify(canonical(before[collection])) !==
      JSON.stringify(canonical(after[collection]))
    )
      changes.push({
        collection,
        id:
          collection === 'project' || collection === 'architecture'
            ? after[collection].id
            : collection,
        kind: 'changed',
      });
  return {
    semanticChanged: inputFingerprint(before) !== inputFingerprint(after),
    changes,
    layoutChanged:
      JSON.stringify(canonical(before.views)) !==
      JSON.stringify(canonical(after.views)),
  };
}
export function restoreCheckpoint(
  history: History,
  checkpoint: Checkpoint,
  recoveryId: string,
  now: string,
) {
  const recovery = createCheckpoint(
    history.present,
    `Before restoring ${checkpoint.name}`,
    recoveryId,
    now,
  );
  return {
    history: commit(
      history,
      structuredClone(parseDocument(checkpoint.document)),
    ),
    recovery,
  };
}
export function removeRequirement(document: ArchitectureDocument, id: string) {
  return editDocument(document, (d) => {
    d.requirements = d.requirements.filter((r) => r.id !== id);
    d.nonFunctionalRequirements = d.nonFunctionalRequirements.filter(
      (r) => r.id !== id,
    );
    d.assessments = d.assessments.filter((a) => a.requirementId !== id);
    for (const decision of d.decisions)
      decision.requirementIds = decision.requirementIds.filter((r) => r !== id);
  });
}
export function configureNode(
  document: ArchitectureDocument,
  id: string,
  name: string,
  configuration: ArchitectureDocument['nodes'][number]['configuration'],
) {
  return editDocument(document, (d) => {
    const node = d.nodes.find((n) => n.id === id);
    if (!node) throw new Error('Architecture object no longer exists.');
    node.name = name.trim();
    node.configuration = structuredClone(configuration);
    const definition = d.components.find((c) => c.id === node.componentId)!;
    const profile = d.performanceProfiles.find((p) => p.nodeId === id);
    if (!profile) return;
    const originalBounds = JSON.stringify(profile);
    for (const [target, binding] of Object.entries(
      definition.catalog?.resourceBindings ?? {},
    )) {
      const value = configuration[binding.field];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (
        target === 'queueBufferMessages' ||
        target === 'queueRetentionSeconds'
      ) {
        if (profile.model === 'queue' && profile.queue)
          Object.assign(profile.queue, {
            [target === 'queueBufferMessages'
              ? 'bufferMessages'
              : 'retentionSeconds']: value * binding.multiplier,
          });
      } else Object.assign(profile, { [target]: value * binding.multiplier });
    }
    const note =
      'Resource bounds reflect explicit component configuration; measured service-time applicability must be checked against this deployment.';
    const boundsChanged = originalBounds !== JSON.stringify(profile);
    if (boundsChanged && profile.provenance.kind === 'measured') {
      profile.provenance.kind = 'assumed';
      profile.provenance.limitations +=
        ' Original evidence classification: measured; deployment changes require recalibration.';
    }
    if (
      boundsChanged &&
      definition.catalog &&
      !profile.provenance.limitations.includes(note)
    )
      profile.provenance.limitations = [profile.provenance.limitations, note]
        .filter(Boolean)
        .join(' ');
  });
}
