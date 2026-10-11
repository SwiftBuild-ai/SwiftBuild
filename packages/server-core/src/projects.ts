import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  validateArchive,
  serializeArchive,
  type ProjectArchive,
} from '@swiftbuild/project-format';
import { transaction } from './migrate';
const id = z.uuid();
const actor = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(120);
const revision = z.number().int().min(1).max(2147483646);
type Role = 'owner' | 'editor' | 'viewer';
export class ProjectError extends Error {
  readonly status: 403 | 404 | 409;
  constructor(status: 403 | 404 | 409, message: string) {
    super(message);
    this.name = 'ProjectError';
    this.status = status;
  }
}
export type StoredProject = {
  id: string;
  workspaceId: string;
  revision: number;
  archive: ProjectArchive;
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
function checked(input: unknown) {
  const archive = validateArchive(input);
  // Apply the portable archive byte limit even for in-process service callers.
  serializeArchive(archive);
  const { exportedAt: _timestamp, ...persistent } = archive;
  return {
    archive,
    digest: createHash('sha256')
      .update(JSON.stringify(canonical(persistent)))
      .digest('hex'),
  };
}
async function access(
  client: PoolClient,
  userId: string,
  workspaceId: string,
  write = false,
): Promise<Role> {
  const result = await client.query<{ role: Role }>(
    'SELECT role FROM sb_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE',
    [workspaceId, userId],
  );
  const role = result.rows[0]?.role;
  if (!role) throw new ProjectError(404, 'Workspace or project not found.');
  if (write && role === 'viewer')
    throw new ProjectError(403, 'Editing permission is required.');
  return role;
}
async function audit(
  client: PoolClient,
  userId: string,
  workspaceId: string,
  action: string,
  projectId: string | null = null,
  version: number | null = null,
) {
  await client.query(
    'INSERT INTO sb_audit_events (id, workspace_id, actor_id, action, project_id, revision) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), workspaceId, userId, action, projectId, version],
  );
}
async function projectAccess(
  client: PoolClient,
  userId: string,
  projectId: string,
  write = false,
) {
  const scope = await client.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM sb_projects WHERE id = $1',
    [projectId],
  );
  const workspaceId = scope.rows[0]?.workspace_id;
  if (!workspaceId)
    throw new ProjectError(404, 'Workspace or project not found.');
  await access(client, userId, workspaceId, write);
  const locked = await client.query<{ current_revision: number }>(
    'SELECT current_revision FROM sb_projects WHERE id = $1 FOR UPDATE',
    [projectId],
  );
  if (!locked.rows[0])
    throw new ProjectError(404, 'Workspace or project not found.');
  return { workspaceId, current: locked.rows[0].current_revision };
}
async function snapshot(
  client: PoolClient,
  projectId: string,
  workspaceId: string,
  version: number,
): Promise<StoredProject> {
  const result = await client.query<{ archive: unknown }>(
    'SELECT archive FROM sb_revisions WHERE project_id = $1 AND revision = $2',
    [projectId, version],
  );
  if (!result.rows[0]) throw new ProjectError(404, 'Revision not found.');
  return {
    id: projectId,
    workspaceId,
    revision: version,
    archive: validateArchive(result.rows[0].archive),
  };
}

/** Server-only service: userId must come from a verified session, never a request body. */
export function createProjectStore(pool: Pool) {
  return {
    async createWorkspace(userId: string, label: string) {
      actor.parse(userId);
      const labelValue = name.parse(label);
      const workspaceId = randomUUID();
      await transaction(pool, async (client) => {
        await client.query(
          'INSERT INTO sb_workspaces (id, name) VALUES ($1,$2)',
          [workspaceId, labelValue],
        );
        await client.query(
          "INSERT INTO sb_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')",
          [workspaceId, userId],
        );
        await audit(client, userId, workspaceId, 'workspace.created');
      });
      return { id: workspaceId, name: labelValue };
    },
    async createProject(
      userId: string,
      workspaceId: string,
      input: unknown,
      operationId: string,
    ) {
      actor.parse(userId);
      id.parse(workspaceId);
      id.parse(operationId);
      const { archive, digest } = checked(input);
      const projectId = randomUUID();
      return transaction(pool, async (client) => {
        await access(client, userId, workspaceId, true);
        const inserted = await client.query<{ id: string }>(
          'INSERT INTO sb_projects (id, workspace_id, name, created_by, creation_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id, creation_key) DO NOTHING RETURNING id',
          [
            projectId,
            workspaceId,
            name.parse(archive.document.project.name),
            userId,
            operationId,
          ],
        );
        if (!inserted.rows[0]) {
          const previous = await client.query<{
            id: string;
            digest: string;
            created_by: string;
          }>(
            'SELECT p.id, r.digest, p.created_by FROM sb_projects p JOIN sb_revisions r ON r.project_id=p.id AND r.revision=1 WHERE p.workspace_id=$1 AND p.creation_key=$2',
            [workspaceId, operationId],
          );
          const row = previous.rows[0];
          if (!row || row.created_by !== userId || row.digest !== digest)
            throw new ProjectError(
              409,
              'Creation key was already used for another request.',
            );
          return snapshot(client, row.id, workspaceId, 1);
        }
        await client.query(
          'INSERT INTO sb_revisions (project_id, revision, operation_id, archive, digest, created_by) VALUES ($1,1,$2,$3,$4,$5)',
          [projectId, operationId, JSON.stringify(archive), digest, userId],
        );
        await client.query(
          'UPDATE sb_projects SET current_revision=1 WHERE id=$1',
          [projectId],
        );
        await audit(
          client,
          userId,
          workspaceId,
          'project.created',
          projectId,
          1,
        );
        return { id: projectId, workspaceId, revision: 1, archive };
      });
    },
    async readProject(userId: string, projectId: string, version?: number) {
      actor.parse(userId);
      id.parse(projectId);
      if (version !== undefined) revision.parse(version);
      return transaction(pool, async (client) => {
        const { workspaceId, current } = await projectAccess(
          client,
          userId,
          projectId,
        );
        return snapshot(client, projectId, workspaceId, version ?? current);
      });
    },
    async saveProject(
      userId: string,
      projectId: string,
      expectedRevision: number,
      input: unknown,
      operationId: string,
    ) {
      actor.parse(userId);
      id.parse(projectId);
      id.parse(operationId);
      revision.parse(expectedRevision);
      const { archive, digest } = checked(input);
      return transaction(pool, async (client) => {
        const { workspaceId, current } = await projectAccess(
          client,
          userId,
          projectId,
          true,
        );
        const previous = await client.query<{
          revision: number;
          digest: string;
          created_by: string;
        }>(
          'SELECT revision, digest, created_by FROM sb_revisions WHERE project_id=$1 AND operation_id=$2',
          [projectId, operationId],
        );
        const prior = previous.rows[0];
        if (prior) {
          if (prior.created_by !== userId || prior.digest !== digest)
            throw new ProjectError(
              409,
              'Save key was already used for another request.',
            );
          return snapshot(client, projectId, workspaceId, prior.revision);
        }
        if (current !== expectedRevision)
          throw new ProjectError(
            409,
            'Project changed. Preserve your work before reopening the current revision.',
          );
        const latest = await client.query<{ digest: string }>(
          'SELECT digest FROM sb_revisions WHERE project_id=$1 AND revision=$2',
          [projectId, current],
        );
        if (latest.rows[0]?.digest === digest)
          return snapshot(client, projectId, workspaceId, current);
        const next = current + 1;
        await client.query(
          'INSERT INTO sb_revisions (project_id, revision, operation_id, archive, digest, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            projectId,
            next,
            operationId,
            JSON.stringify(archive),
            digest,
            userId,
          ],
        );
        await client.query(
          'UPDATE sb_projects SET current_revision=$2, name=$3, updated_at=now() WHERE id=$1',
          [projectId, next, name.parse(archive.document.project.name)],
        );
        await audit(
          client,
          userId,
          workspaceId,
          'project.saved',
          projectId,
          next,
        );
        return { id: projectId, workspaceId, revision: next, archive };
      });
    },
    async listProjects(userId: string, workspaceId: string) {
      actor.parse(userId);
      id.parse(workspaceId);
      return transaction(pool, async (client) => {
        await access(client, userId, workspaceId);
        const result = await client.query<{
          id: string;
          name: string;
          current_revision: number;
          updated_at: Date;
        }>(
          'SELECT id, name, current_revision, updated_at FROM sb_projects WHERE workspace_id=$1 ORDER BY updated_at DESC, id LIMIT 100',
          [workspaceId],
        );
        return result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          revision: row.current_revision,
          updatedAt: row.updated_at.toISOString(),
        }));
      });
    },
    async listRevisions(userId: string, projectId: string, before?: number) {
      actor.parse(userId);
      id.parse(projectId);
      if (before !== undefined) revision.parse(before);
      return transaction(pool, async (client) => {
        await projectAccess(client, userId, projectId);
        const result = await client.query<{
          revision: number;
          created_by: string;
          created_at: Date;
        }>(
          'SELECT revision, created_by, created_at FROM sb_revisions WHERE project_id=$1 AND ($2::integer IS NULL OR revision < $2) ORDER BY revision DESC LIMIT 100',
          [projectId, before ?? null],
        );
        return result.rows.map((row) => ({
          revision: row.revision,
          actorId: row.created_by,
          createdAt: row.created_at.toISOString(),
        }));
      });
    },
  };
}
