from uuid import UUID, uuid4
import re

from psycopg.types.json import Jsonb

from .database import all_rows, one, transaction
from .domain import validate_archive
from .errors import ServiceError, conflict
from .serialization import project_digest, utf16


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(
        r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', value
    ):
        raise ValueError('Invalid identifier.')
    UUID(value)
    return value


def revision(value):
    if type(value) is not int or not 1 <= value <= 2147483646:
        raise ValueError('Invalid revision.')
    return value


def actor(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        raise ValueError('Invalid actor.')
    return value


def name(value):
    if not isinstance(value, str) or not 1 <= len(utf16(value.strip())) // 2 <= 120:
        raise ValueError('Invalid name.')
    return value.strip()


async def access(c, user_id, workspace_id, write=False):
    row = await one(
        c,
        'SELECT m.role FROM sb_members m JOIN sb_admitted_users u ON u.user_id=m.user_id AND u.active WHERE m.workspace_id=%s AND m.user_id=%s FOR SHARE OF m,u',
        (workspace_id, user_id),
    )
    if not row:
        raise ServiceError(404, 'Workspace or project not found.')
    if write and row['role'] == 'viewer':
        raise ServiceError(403, 'Editing permission is required.')
    return row['role']


async def audit(c, user_id, workspace_id, action, project_id=None, version=None):
    await c.execute(
        'INSERT INTO sb_audit_events (id,workspace_id,actor_id,action,project_id,revision) VALUES (%s,%s,%s,%s,%s,%s)',
        (uuid4(), workspace_id, user_id, action, project_id, version),
    )


async def project_access(c, user_id, project_id, write=False):
    row = await one(c, 'SELECT workspace_id FROM sb_projects WHERE id=%s', (project_id,))
    if not row:
        raise ServiceError(404, 'Workspace or project not found.')
    workspace_id = str(row['workspace_id'])
    role = await access(c, user_id, workspace_id, write)
    row = await one(
        c, 'SELECT current_revision FROM sb_projects WHERE id=%s FOR UPDATE', (project_id,)
    )
    if not row:
        raise ServiceError(404, 'Workspace or project not found.')
    return workspace_id, row['current_revision'], role


async def snapshot(c, project_id, workspace_id, version):
    row = await one(
        c,
        'SELECT archive FROM sb_revisions WHERE project_id=%s AND revision=%s',
        (project_id, version),
    )
    if not row:
        raise ServiceError(404, 'Revision not found.')
    return {
        'id': str(project_id),
        'workspaceId': str(workspace_id),
        'revision': version,
        'archive': validate_archive(row['archive']),
    }


class Projects:
    def __init__(self, pool):
        self.pool = pool

    async def create_workspace(self, user_id, label):
        actor(user_id)
        label, workspace_id = name(label), str(uuid4())
        async with transaction(self.pool) as c:
            if not await one(
                c,
                'SELECT user_id FROM sb_admitted_users WHERE user_id=%s AND active FOR SHARE',
                (user_id,),
            ):
                raise ServiceError(403, 'Active server admission is required.')
            await c.execute(
                'INSERT INTO sb_workspaces(id,name) VALUES (%s,%s)', (workspace_id, label)
            )
            await c.execute(
                "INSERT INTO sb_members(workspace_id,user_id,role) VALUES (%s,%s,'owner')",
                (workspace_id, user_id),
            )
            await audit(c, user_id, workspace_id, 'workspace.created')
        return {'id': workspace_id, 'name': label}

    async def create_project(self, user_id, workspace_id, value, operation_id):
        actor(user_id)
        identifier(workspace_id)
        identifier(operation_id)
        archive = validate_archive(value)
        digest, project_id = project_digest(archive), str(uuid4())
        async with transaction(self.pool) as c:
            await access(c, user_id, workspace_id, True)
            inserted = await one(
                c,
                'INSERT INTO sb_projects(id,workspace_id,name,created_by,creation_key) VALUES (%s,%s,%s,%s,%s) ON CONFLICT(workspace_id,creation_key) DO NOTHING RETURNING id',
                (
                    project_id,
                    workspace_id,
                    name(archive['document']['project']['name']),
                    user_id,
                    operation_id,
                ),
            )
            if not inserted:
                prior = await one(
                    c,
                    'SELECT p.id,r.digest,p.created_by FROM sb_projects p JOIN sb_revisions r ON r.project_id=p.id AND r.revision=1 WHERE p.workspace_id=%s AND p.creation_key=%s',
                    (workspace_id, operation_id),
                )
                if not prior or prior['created_by'] != user_id or prior['digest'] != digest:
                    raise ServiceError(409, 'Creation key was already used for another request.')
                return await snapshot(c, prior['id'], workspace_id, 1)
            await c.execute(
                "INSERT INTO sb_revisions(project_id,revision,operation_id,archive,digest,created_by,operation_kind) VALUES (%s,1,%s,%s,%s,%s,'create')",
                (project_id, operation_id, Jsonb(archive), digest, user_id),
            )
            await c.execute('UPDATE sb_projects SET current_revision=1 WHERE id=%s', (project_id,))
            await audit(c, user_id, workspace_id, 'project.created', project_id, 1)
            return {
                'id': project_id,
                'workspaceId': workspace_id,
                'revision': 1,
                'archive': archive,
            }

    async def read_project(self, user_id, project_id, version=None):
        actor(user_id)
        identifier(project_id)
        if version is not None:
            revision(version)
        async with transaction(self.pool) as c:
            workspace_id, current, role = await project_access(c, user_id, project_id)
            return {
                **await snapshot(
                    c, project_id, workspace_id, version if version is not None else current
                ),
                'role': role,
            }

    async def save_project(self, user_id, project_id, expected, value, operation_id):
        actor(user_id)
        identifier(project_id)
        identifier(operation_id)
        revision(expected)
        archive = validate_archive(value)
        digest = project_digest(archive)
        async with transaction(self.pool) as c:
            workspace_id, current, _ = await project_access(c, user_id, project_id, True)
            prior = await one(
                c,
                'SELECT revision,digest,created_by,operation_kind FROM sb_revisions WHERE project_id=%s AND operation_id=%s',
                (project_id, operation_id),
            )
            if prior:
                if (
                    prior['operation_kind'] == 'restore'
                    or prior['created_by'] != user_id
                    or prior['digest'] != digest
                ):
                    raise ServiceError(409, 'Save key was already used for another request.')
                return await snapshot(c, project_id, workspace_id, prior['revision'])
            if current != expected:
                raise conflict()
            latest = await one(
                c,
                'SELECT digest FROM sb_revisions WHERE project_id=%s AND revision=%s',
                (project_id, current),
            )
            if latest['digest'] == digest:
                return await snapshot(c, project_id, workspace_id, current)
            next_ = current + 1
            await c.execute(
                'INSERT INTO sb_revisions(project_id,revision,operation_id,archive,digest,created_by) VALUES (%s,%s,%s,%s,%s,%s)',
                (project_id, next_, operation_id, Jsonb(archive), digest, user_id),
            )
            await c.execute(
                'UPDATE sb_projects SET current_revision=%s,name=%s,updated_at=now() WHERE id=%s',
                (next_, name(archive['document']['project']['name']), project_id),
            )
            await audit(c, user_id, workspace_id, 'project.saved', project_id, next_)
            return {
                'id': project_id,
                'workspaceId': workspace_id,
                'revision': next_,
                'archive': archive,
            }

    async def restore_project(self, user_id, project_id, expected, source, operation_id):
        actor(user_id)
        identifier(project_id)
        identifier(operation_id)
        revision(expected)
        revision(source)
        async with transaction(self.pool) as c:
            workspace_id, current, _ = await project_access(c, user_id, project_id, True)
            prior = await one(
                c,
                'SELECT revision,created_by,operation_kind,source_revision,expected_revision FROM sb_revisions WHERE project_id=%s AND operation_id=%s',
                (project_id, operation_id),
            )
            if prior:
                if (
                    prior['created_by'] != user_id
                    or prior['operation_kind'] != 'restore'
                    or prior['source_revision'] != source
                    or prior['expected_revision'] != expected
                ):
                    raise ServiceError(409, 'Restore key was already used for another request.')
                return await snapshot(c, project_id, workspace_id, prior['revision'])
            if current != expected:
                raise conflict()
            archive = (await snapshot(c, project_id, workspace_id, source))['archive']
            next_ = current + 1
            await c.execute(
                "INSERT INTO sb_revisions(project_id,revision,operation_id,archive,digest,created_by,operation_kind,source_revision,expected_revision) VALUES (%s,%s,%s,%s,%s,%s,'restore',%s,%s)",
                (
                    project_id,
                    next_,
                    operation_id,
                    Jsonb(archive),
                    project_digest(archive),
                    user_id,
                    source,
                    expected,
                ),
            )
            await c.execute(
                'UPDATE sb_projects SET current_revision=%s,name=%s,updated_at=now() WHERE id=%s',
                (next_, name(archive['document']['project']['name']), project_id),
            )
            await audit(c, user_id, workspace_id, 'project.restored', project_id, next_)
            return {
                'id': project_id,
                'workspaceId': workspace_id,
                'revision': next_,
                'archive': archive,
            }

    async def list_workspaces(self, user_id, after=None):
        actor(user_id)
        if after:
            identifier(after)
        async with self.pool.connection() as c:
            rows = await all_rows(
                c,
                'SELECT w.id,w.name,m.role FROM sb_workspaces w JOIN sb_members m ON m.workspace_id=w.id JOIN sb_admitted_users u ON u.user_id=m.user_id AND u.active WHERE m.user_id=%s AND (%s::uuid IS NULL OR w.id>%s) ORDER BY w.id LIMIT 100',
                (user_id, after, after),
            )
            return [{**r, 'id': str(r['id'])} for r in rows]

    async def list_projects(self, user_id, workspace_id, before=None):
        actor(user_id)
        identifier(workspace_id)
        if before:
            identifier(before['id'])
        async with transaction(self.pool) as c:
            await access(c, user_id, workspace_id)
            timestamp, last_id = (before['updatedAt'], before['id']) if before else (None, None)
            rows = await all_rows(
                c,
                'SELECT id,name,current_revision,to_char(updated_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at FROM sb_projects WHERE workspace_id=%s AND (%s::timestamptz IS NULL OR (updated_at,id)<(%s::timestamptz,%s::uuid)) ORDER BY updated_at DESC,id DESC LIMIT 100',
                (workspace_id, timestamp, timestamp, last_id),
            )
            return [
                {
                    'id': str(r['id']),
                    'name': r['name'],
                    'revision': r['current_revision'],
                    'updatedAt': r['updated_at'],
                }
                for r in rows
            ]

    async def list_revisions(self, user_id, project_id, before=None):
        actor(user_id)
        identifier(project_id)
        if before is not None:
            revision(before)
        async with transaction(self.pool) as c:
            await project_access(c, user_id, project_id)
            rows = await all_rows(
                c,
                'SELECT revision,created_by,created_at,source_revision FROM sb_revisions WHERE project_id=%s AND (%s::integer IS NULL OR revision<%s) ORDER BY revision DESC LIMIT 100',
                (project_id, before, before),
            )
            return [
                {
                    'revision': r['revision'],
                    'actorId': r['created_by'],
                    'sourceRevision': r['source_revision'],
                    'createdAt': r['created_at']
                    .isoformat(timespec='milliseconds')
                    .replace('+00:00', 'Z'),
                }
                for r in rows
            ]
