from uuid import uuid4

import jcs
from psycopg.types.json import Jsonb

from .analysis import validate_analysis
from .database import all_rows, one, transaction
from .domain import MAX_COMPUTATION_BYTES, validate_archive, validate_contract
from .errors import ServiceError, conflict
from .projects import audit, identifier
from .serialization import computation_digest


def bounded(value):
    try:
        length = len(jcs.canonicalize(value))
    except (ValueError, UnicodeError, OverflowError):
        raise ServiceError(
            409,
            'Computation input must contain finite JSON and valid Unicode.',
            'INVALID_COMPUTATION_JSON',
        ) from None
    if length > MAX_COMPUTATION_BYTES:
        raise ServiceError(409, 'Computation byte limit exceeded.', 'INPUT_LIMIT')


def job(row):
    return {
        'id': str(row['id']),
        'projectId': str(row['project_id']),
        'revision': row['revision'],
        'state': row['state'],
        'input': validate_contract('ExecutionInput', row['input']),
        'report': validate_contract('ComputationReport', row['report']) if row['report'] else None,
        'error': row['error'],
        'origin': row['origin'],
    }


async def authorize(c, actor, project_id, write=False):
    identifier(project_id)
    row = await one(
        c,
        'SELECT p.workspace_id,p.current_revision,m.role FROM sb_projects p JOIN sb_members m ON m.workspace_id=p.workspace_id AND m.user_id=%s JOIN sb_admitted_users u ON u.user_id=m.user_id AND u.active WHERE p.id=%s FOR SHARE OF m,u,p',
        (actor, project_id),
    )
    if not row:
        raise ServiceError(404, 'Project not found.')
    if write and row['role'] == 'viewer':
        raise ServiceError(403, 'Editing permission is required.')
    return row


async def admitted(c, row):
    return bool(
        await one(
            c,
            "SELECT 1 FROM sb_members m JOIN sb_admitted_users u ON u.user_id=m.user_id AND u.active WHERE m.workspace_id=%s AND m.user_id=%s AND m.role IN ('owner','editor') FOR SHARE OF m,u",
            (row['workspace_id'], row['actor_id']),
        )
    )


async def job_audit(c, row, action):
    await audit(c, row['actor_id'], row['workspace_id'], action, row['project_id'], row['revision'])


class Jobs:
    def __init__(self, pool):
        self.pool = pool

    async def submit(self, actor, project_id, revision, operation_id, value, imported=False):
        identifier(project_id)
        identifier(operation_id)
        bounded(value)
        async with transaction(self.pool) as c:
            await c.execute('SELECT pg_advisory_xact_lock(1398233415)')
            scope = await authorize(c, actor, project_id, True)
            request_digest = computation_digest(
                {'revision': revision, 'input': value, 'imported': imported}
            )
            existing = await one(
                c,
                'SELECT * FROM sb_jobs WHERE project_id=%s AND actor_id=%s AND operation_id=%s',
                (project_id, actor, operation_id),
            )
            if existing:
                if existing['request_digest'] != request_digest:
                    raise ServiceError(409, 'Operation ID was reused with different input.')
                return job(existing)
            if scope['current_revision'] != revision:
                raise conflict()
            bundle = validate_contract('AnalysisBundle', value) if imported else None
            target_revision = bundle['input']['revision'] if bundle else revision
            stored = await one(
                c,
                'SELECT archive FROM sb_revisions WHERE project_id=%s AND revision=%s',
                (project_id, target_revision),
            )
            if not stored:
                raise ServiceError(404, 'Analysis revision not found.')
            document = validate_archive(stored['archive'])['document']
            if bundle:
                execution, report = bundle['input'], bundle['report']
                if execution['projectId'] != project_id:
                    raise ServiceError(409, 'Bundle belongs to another project or revision.')
                if report and report['digest'] != computation_digest(execution):
                    raise ServiceError(409, 'Bundle report digest does not match its input.')
            else:
                if not isinstance(value, dict) or set(value) - {
                    'definition',
                    'seed',
                    'samples',
                    'deadlineMs',
                }:
                    raise ValueError('Invalid analysis input fields.')
                execution = validate_contract(
                    'ExecutionInput',
                    {
                        'contractVersion': '1.0',
                        'projectId': project_id,
                        'revision': revision,
                        'seed': 42,
                        'samples': 10000,
                        'deadlineMs': 120000,
                        **value,
                    },
                )
                report = None
            try:
                validate_analysis(execution['definition'], document)
            except ValueError as error:
                raise ServiceError(409, str(error)) from None
            if not imported:
                queued = await one(
                    c,
                    "SELECT count(*) AS n FROM sb_jobs WHERE workspace_id=%s AND state='queued'",
                    (scope['workspace_id'],),
                )
                if queued['n'] >= 10:
                    raise ServiceError(409, 'Workspace queue is full.', 'QUEUE_LIMIT')
            row = await one(
                c,
                'INSERT INTO sb_jobs(id,project_id,revision,workspace_id,actor_id,operation_id,request_digest,input,state,origin,report) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *',
                (
                    uuid4(),
                    project_id,
                    target_revision,
                    scope['workspace_id'],
                    actor,
                    operation_id,
                    request_digest,
                    Jsonb(execution),
                    ('completed' if report and report['status'] == 'complete' else 'partial')
                    if imported
                    else 'queued',
                    'imported' if imported else 'computed',
                    Jsonb(report) if report else None,
                ),
            )
            await job_audit(c, row, 'analysis.imported' if imported else 'analysis.queued')
            return job(row)

    async def list(self, actor, project_id, before=None):
        if before:
            identifier(before)
        async with transaction(self.pool) as c:
            await authorize(c, actor, project_id)
            rows = await all_rows(
                c,
                "SELECT id,project_id,revision,state,error,origin,input->'definition'->>'kind' AS kind FROM sb_jobs WHERE project_id=%s AND (%s::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM sb_jobs WHERE id=%s AND project_id=%s)) ORDER BY created_at DESC,id DESC LIMIT 100",
                (project_id, before, before, project_id),
            )
            return [
                {
                    'id': str(r['id']),
                    'projectId': str(r['project_id']),
                    **{k: r[k] for k in ('revision', 'state', 'error', 'origin', 'kind')},
                }
                for r in rows
            ]

    async def read(self, actor, project_id, job_id):
        identifier(job_id)
        async with transaction(self.pool) as c:
            await authorize(c, actor, project_id)
            row = await one(
                c, 'SELECT * FROM sb_jobs WHERE id=%s AND project_id=%s', (job_id, project_id)
            )
            if not row:
                raise ServiceError(404, 'Job not found.')
            return job(row)

    async def export(self, actor, project_id, job_id):
        identifier(job_id)
        async with transaction(self.pool) as c:
            await authorize(c, actor, project_id)
            row = await one(
                c, 'SELECT * FROM sb_jobs WHERE id=%s AND project_id=%s', (job_id, project_id)
            )
            if not row:
                raise ServiceError(404, 'Job not found.')
            attempt = (
                await one(c, 'SELECT input FROM sb_job_attempts WHERE id=%s', (row['attempt_id'],))
                if row['report']
                else None
            )
            bundle = validate_contract(
                'AnalysisBundle',
                {
                    'format': 'swiftbuild-analysis',
                    'bundleVersion': '1.0',
                    'input': attempt['input'] if attempt else row['input'],
                    'report': row['report'],
                    'origin': row['origin'],
                },
            )
            bounded(bundle)
            return bundle

    async def cancel(self, actor, project_id, job_id):
        identifier(job_id)
        async with transaction(self.pool) as c:
            await authorize(c, actor, project_id, True)
            row = await one(
                c,
                'SELECT * FROM sb_jobs WHERE id=%s AND project_id=%s FOR UPDATE',
                (job_id, project_id),
            )
            if not row:
                raise ServiceError(404, 'Job not found.')
            if row['state'] in ('queued', 'running'):
                await c.execute(
                    "UPDATE sb_jobs SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE 'cancelling' END WHERE id=%s",
                    (job_id,),
                )
                await job_audit(c, row, 'analysis.cancelled')

    async def claim(self):
        async with transaction(self.pool) as c:
            await c.execute('SELECT pg_advisory_xact_lock(1398233415)')
            await c.execute(
                "UPDATE sb_job_attempts a SET finished_at=now(),outcome='lease-expired' FROM sb_jobs j WHERE j.attempt_id=a.id AND j.lease_until<now() AND j.state IN ('running','cancelling')"
            )
            await c.execute(
                "UPDATE sb_jobs SET state=CASE WHEN state='cancelling' THEN 'cancelled' WHEN attempts<2 THEN 'queued' ELSE 'failed' END,error='LEASE_EXPIRED',attempt_id=NULL,lease_until=NULL WHERE state IN ('running','cancelling') AND lease_until<now()"
            )
            row = await one(
                c,
                "SELECT * FROM sb_jobs j WHERE state='queued' AND NOT EXISTS(SELECT 1 FROM sb_jobs active WHERE active.workspace_id=j.workspace_id AND active.state IN ('running','cancelling')) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
            )
            if not row:
                return None
            if not await admitted(c, row):
                await c.execute(
                    "UPDATE sb_jobs SET state='cancelled',error='ACCESS_REVOKED' WHERE id=%s",
                    (row['id'],),
                )
                await job_audit(c, row, 'analysis.access-revoked')
                return None
            attempt_id = str(uuid4())
            await c.execute(
                "UPDATE sb_jobs SET state='running',attempt_id=%s,attempts=attempts+1,started_at=now(),lease_until=now()+interval '15 seconds' WHERE id=%s",
                (attempt_id, row['id']),
            )
            await c.execute(
                'INSERT INTO sb_job_attempts(id,job_id,input,digest) VALUES (%s,%s,%s,%s)',
                (attempt_id, row['id'], Jsonb(row['input']), computation_digest(row['input'])),
            )
            stored = await one(
                c,
                'SELECT archive FROM sb_revisions WHERE project_id=%s AND revision=%s',
                (row['project_id'], row['revision']),
            )
            await job_audit(c, row, 'analysis.started')
            return {
                **job(row),
                'state': 'running',
                'attemptId': attempt_id,
                'document': validate_archive(stored['archive'])['document'],
            }

    async def heartbeat(self, job_id, attempt_id):
        async with transaction(self.pool) as c:
            row = await one(
                c,
                'SELECT * FROM sb_jobs WHERE id=%s AND attempt_id=%s AND lease_until>now() FOR UPDATE',
                (job_id, attempt_id),
            )
            if not row or row['state'] != 'running':
                return False
            if not await admitted(c, row):
                await c.execute(
                    "UPDATE sb_jobs SET state='cancelling',error='ACCESS_REVOKED' WHERE id=%s",
                    (job_id,),
                )
                return False
            await c.execute(
                "UPDATE sb_jobs SET lease_until=now()+interval '15 seconds' WHERE id=%s", (job_id,)
            )
            return True

    async def set_execution(self, job_id, attempt_id, execution):
        bounded(execution)
        execution = validate_contract('ExecutionInput', execution)
        async with self.pool.connection() as c:
            cursor = await c.execute(
                "UPDATE sb_job_attempts a SET input=%s,digest=%s,prepared_at=now() FROM sb_jobs j WHERE a.id=%s AND a.prepared_at IS NULL AND j.id=%s AND j.attempt_id=a.id AND j.state='running' AND j.lease_until>now()",
                (Jsonb(execution), computation_digest(execution), attempt_id, job_id),
            )
            if not cursor.rowcount:
                raise ValueError('Attempt is no longer active.')

    async def finish(self, job_id, attempt_id, state, report=None, error=None):
        if state not in ('completed', 'partial', 'failed', 'timed-out', 'cancelled'):
            raise ValueError('Invalid terminal state.')
        if report:
            report = validate_contract('ComputationReport', report)
            bounded(report)
        async with transaction(self.pool) as c:
            row = await one(
                c,
                'SELECT * FROM sb_jobs WHERE id=%s AND attempt_id=%s AND lease_until>now() FOR UPDATE',
                (job_id, attempt_id),
            )
            if not row or row['state'] not in ('running', 'cancelling'):
                return False
            if row['state'] == 'cancelling' or not await admitted(c, row):
                state, report, error = 'cancelled', None, row['error'] or 'CANCELLED'
            if report:
                if (state == 'completed') != (report['status'] == 'complete'):
                    raise ValueError('Result status mismatch.')
                attempt = await one(
                    c, 'SELECT digest,prepared_at FROM sb_job_attempts WHERE id=%s', (attempt_id,)
                )
                if not attempt['prepared_at'] or report['digest'] != attempt['digest']:
                    raise ValueError('Result digest mismatch.')
            if state in ('completed', 'partial') and not report:
                raise ValueError('A successful result requires a report.')
            await c.execute(
                'UPDATE sb_jobs SET state=%s,report=%s,error=%s,lease_until=NULL WHERE id=%s AND attempt_id=%s',
                (state, Jsonb(report) if report else None, error, job_id, attempt_id),
            )
            await c.execute(
                'UPDATE sb_job_attempts SET finished_at=now(),outcome=%s WHERE id=%s',
                (state, attempt_id),
            )
            await job_audit(c, row, 'analysis.' + state)
            return True
