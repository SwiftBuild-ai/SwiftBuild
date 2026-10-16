"""Disposable full-server verification through the Python runtime and public HTTP."""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

import httpx
from psycopg import sql
from psycopg.conninfo import make_conninfo

from .config import Settings
from .database import all_rows, one, pool_for
from .domain import validate_document
from .identity import COOKIE, Identity, issue_invitation
from .jobs import Jobs
from .projects import Projects
from .recovery import restore_database, timestamp, verify_backup
from .worker import stop_process


def document():
    source = Path(__file__).resolve().parents[3] / 'examples/commerce.swiftbuild.json'
    return validate_document(json.loads(source.read_text('utf-8')))


async def operator(command, *flags, offline=False):
    env = dict(os.environ)
    if offline:
        env.pop('DATABASE_URL', None)
    result = await asyncio.to_thread(
        subprocess.run,
        [sys.executable, '-m', 'swiftbuild_backend.cli', command, *flags],
        env=env,
        capture_output=True,
        text=True,
        timeout=90,
    )
    if result.returncode:
        raise ValueError('Native operator failed: ' + command)
    return json.loads(result.stdout)


async def request(client, path, method='GET', body=None, headers=None):
    response = await client.request(method, path, json=body, headers=headers)
    if not response.is_success:
        raise ValueError('Deployment HTTP check failed with status ' + str(response.status_code))
    return response.json()


async def completed(read):
    for _ in range(300):
        result = await read()
        if result['state'] not in ('queued', 'running', 'cancelling'):
            if result['state'] != 'completed':
                raise ValueError('Deployment numerical execution failed.')
            return result
        await asyncio.sleep(0.1)
    raise ValueError('Deployment numerical execution exceeded its wait budget.')


async def initial(pool, settings, client, email, password):
    link = await issue_invitation(pool, email, bootstrap=True)
    await request(
        client,
        '/api/auth/sign-up/email',
        'POST',
        {'name': 'Engineering smoke', 'email': email, 'password': password},
        {'x-swiftbuild-invitation': link['token']},
    )
    await request(client, '/api/auth/sign-in/email', 'POST', {'email': email, 'password': password})
    workspace = await request(client, '/api/v1/workspaces', 'POST', {'name': 'Engineering smoke'})
    native = document()
    archive = {
        'format': 'swiftbuild-project',
        'archiveVersion': '1.0',
        'document': native,
        'checkpoints': [],
        'runs': [],
        'exportedAt': timestamp(),
    }
    creation_operation, restore_operation = str(uuid4()), str(uuid4())
    project = await request(
        client,
        '/api/v1/projects',
        'POST',
        {'workspaceId': workspace['id'], 'operationId': creation_operation, 'archive': archive},
    )
    path = '/api/v1/projects/' + project['id']
    node = native['nodes'][0]['id']
    definition = {
        'kind': 'reliability',
        'reliability': {
            'components': [
                {
                    'nodeId': node,
                    'meanUpSeconds': 80,
                    'meanRepairSeconds': 20,
                    'provenance': {
                        'kind': 'assumed',
                        'source': 'Deployment reference',
                        'context': 'Isolated test',
                        'recordedAt': '2026-10-13T00:00:00Z',
                    },
                }
            ],
            'groups': [],
            'gates': [],
            'root': node,
        },
        'ranges': [],
    }
    job = await request(
        client,
        path + '/jobs',
        'POST',
        {'operationId': str(uuid4()), 'input': {'definition': definition}},
        {'if-match': '"1"'},
    )
    result = await completed(lambda: request(client, path + '/jobs/' + job['id']))
    assert abs(result['report']['availability'] - 0.8) < 1e-12
    bundle = await request(client, path + '/jobs/' + job['id'] + '/export')
    assert bundle['report']['digest'] == result['report']['digest']
    restored_revision = await request(
        client,
        path + '/restore',
        'POST',
        {'sourceRevision': 1, 'operationId': restore_operation},
        {'if-match': '"1"'},
    )
    assert restored_revision['revision'] == 2
    async with pool.connection() as c:
        before = await all_rows(
            c,
            'SELECT revision,digest FROM sb_revisions WHERE project_id=%s ORDER BY revision',
            (project['id'],),
        )
    target = 'swiftbuild_restore_' + uuid4().hex + '_test'
    runtime, worker = None, None
    try:
        with tempfile.TemporaryDirectory(prefix='swiftbuild-deployment-') as root:
            backup = str(Path(root) / 'backup')
            assert (await operator('backup', '--directory', backup))['event'] == 'backup.created'
            manifest = verify_backup(backup)
            assert manifest['sha256'] and manifest['bytes'] > 0
            assert (await operator('verify-backup', '--directory', backup, offline=True))[
                'event'
            ] == 'backup.verified'
            assert (await operator('recovery-drill', '--directory', backup, '--database', target))[
                'event'
            ] == 'recovery.drill.passed'
            try:
                await restore_database(settings.database_url, backup, target)
            except ValueError as error:
                if 'already exists' not in str(error):
                    raise
            else:
                raise ValueError('Existing recovery target was overwritten.')
        connection = make_conninfo(
            settings.database_url,
            dbname=target,
            user='swiftbuild_runtime',
            password=os.environ['SWIFTBUILD_DB_RUNTIME_PASSWORD'],
        )
        runtime = pool_for(connection, maximum=4)
        await runtime.open()
        async with runtime.connection() as c:
            permissions = await one(
                c,
                "SELECT has_schema_privilege(current_user,'public','CREATE') AS ddl,has_table_privilege(current_user,'public.sb_migrations','UPDATE') AS migration_write",
            )
            assert not any(permissions.values())
            assert (
                await all_rows(
                    c,
                    'SELECT revision,digest FROM sb_revisions WHERE project_id=%s ORDER BY revision',
                    (project['id'],),
                )
                == before
            )
        session = await Identity(runtime, settings).session(client.cookies.get(COOKIE))
        assert session, 'Restored identity/session must remain admitted.'
        user = session['user']['id']
        projects, jobs = Projects(runtime), Jobs(runtime)
        recovered = await projects.create_project(
            user, workspace['id'], archive, creation_operation
        )
        assert recovered['id'] == project['id']
        assert (await projects.restore_project(user, project['id'], 1, 1, restore_operation))[
            'revision'
        ] == 2
        assert len(await projects.list_revisions(user, project['id'])) == 2
        historical = await jobs.read(user, project['id'], job['id'])
        assert (
            historical['state'] == 'completed'
            and historical['report']['digest'] == result['report']['digest']
        )
        replay = await jobs.submit(
            user,
            project['id'],
            2,
            str(uuid4()),
            {
                'definition': bundle['input']['definition'],
                'seed': bundle['input']['seed'],
                'samples': bundle['input']['samples'],
            },
        )
        worker = subprocess.Popen(
            [sys.executable, '-m', 'swiftbuild_backend.worker'],
            env={
                **os.environ,
                'DATABASE_URL': connection,
                'SWIFTBUILD_COMPUTATION_URL': os.getenv(
                    'SWIFTBUILD_COMPUTATION_URL', 'http://computation:8000'
                ),
            },
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        replayed = await completed(lambda: jobs.read(user, project['id'], replay['id']))
        assert abs(replayed['report']['availability'] - result['report']['availability']) < 1e-12
        print(
            json.dumps(
                {
                    'event': 'deployment.smoke.passed',
                    'checks': [
                        'authenticated-http',
                        'durable-job',
                        'python-child',
                        'analysis-bundle',
                        'database-backup-restore',
                        'snapshot-manifest-integrity',
                        'restored-runtime-role',
                        'restored-admission-and-replay',
                    ],
                }
            )
        )
    finally:
        await stop_process(worker)
        if runtime:
            await runtime.close()
        async with pool.connection() as c:
            await c.execute(sql.SQL('DROP DATABASE IF EXISTS {}').format(sql.Identifier(target)))


async def restart(client, email, password):
    await request(client, '/api/v1/ready')
    await request(client, '/api/auth/sign-in/email', 'POST', {'email': email, 'password': password})
    memberships = await request(client, '/api/v1/workspaces')
    workspace = next(w for w in memberships['items'] if w['name'] == 'Engineering smoke')
    projects = await request(client, '/api/v1/projects?workspaceId=' + workspace['id'])
    assert len(projects['items']) == 1
    path = '/api/v1/projects/' + projects['items'][0]['id']
    current = await request(client, path)
    assert current['revision'] == 2 and current['archive']['document'] == document()
    for version in (1, 2):
        assert (await request(client, path + '?revision=' + str(version)))['archive'][
            'document'
        ] == document()
    archive = current['archive']
    archive['document']['nodes'][0]['name'] = 'Saved after service recreation'
    saved = await request(
        client, path, 'PUT', {'archive': archive, 'operationId': str(uuid4())}, {'if-match': '"2"'}
    )
    assert saved['revision'] == 3 and (await request(client, path))['archive'] == archive
    print(
        json.dumps(
            {
                'event': 'deployment.restart-smoke.passed',
                'checks': [
                    'readiness',
                    'identity',
                    'membership',
                    'project-and-history',
                    'save-after-recreation',
                ],
            }
        )
    )


async def run(restarting):
    settings = Settings.from_env()
    fixture = os.environ['SWIFTBUILD_SMOKE_RESTART_ID']
    if len(fixture) != 32 or any(c not in '0123456789abcdef' for c in fixture):
        raise ValueError('Use the private generated restart fixture.')
    pool = pool_for(settings.database_url, maximum=4)
    await pool.open()
    try:
        async with pool.connection() as c:
            if not (await one(c, 'SELECT current_database() AS name'))['name'].endswith('_test'):
                raise ValueError('Deployment smoke requires an isolated _test database.')
        async with httpx.AsyncClient(
            base_url=os.getenv('SWIFTBUILD_SMOKE_WEB_URL', 'http://web:3000'),
            headers={'origin': settings.origin, 'content-type': 'application/json'},
            timeout=30,
        ) as client:
            email, password = (
                'smoke-' + fixture + '@example.test',
                os.environ['SWIFTBUILD_SMOKE_RESTART_PASSWORD'],
            )
            if restarting:
                await restart(client, email, password)
            else:
                await initial(pool, settings, client, email, password)
    finally:
        await pool.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--restart', action='store_true')
    args = parser.parse_args()
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run(args.restart))


if __name__ == '__main__':
    main()
