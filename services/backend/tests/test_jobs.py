import asyncio
import os
import socket
import shutil
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from psycopg.conninfo import make_conninfo

from swiftbuild_backend.config import Settings
from swiftbuild_backend.database import one
from swiftbuild_backend.errors import ServiceError
from swiftbuild_backend.jobs import Jobs
from swiftbuild_backend.serialization import computation_digest
from swiftbuild_backend.worker import Worker, stop_process
from test_compatibility import fixture
from test_storage import owner


@pytest_asyncio.fixture
async def numerical_supervisor():
    source = Path(__file__).resolve().parents[2] / 'computation'
    with socket.socket() as port:
        port.bind(('127.0.0.1', 0))
        address = 'http://127.0.0.1:' + str(port.getsockname()[1])
        number = port.getsockname()[1]
    token = 'synthetic-computation-token-' * 3
    env = {
        k: os.environ[k]
        for k in ('PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG')
        if k in os.environ
    }
    env.update(SWIFTBUILD_COMPUTATION_TOKEN=token, OPENBLAS_NUM_THREADS='1')
    process = subprocess.Popen(
        [
            sys.executable,
            '-m',
            'uvicorn',
            'app:app',
            '--host',
            '127.0.0.1',
            '--port',
            str(number),
            '--no-access-log',
        ],
        cwd=source,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        async with httpx.AsyncClient(
            base_url=address,
            headers={'authorization': 'Bearer ' + token},
            timeout=2,
        ) as client:
            ready = False
            for _ in range(100):
                assert process.poll() is None, 'Private numerical supervisor exited during startup.'
                try:
                    ready = (await client.get('/v1/ready')).is_success
                except httpx.HTTPError:
                    pass
                if ready:
                    break
                await asyncio.sleep(0.1)
            assert ready, 'Private numerical supervisor did not become ready.'
            yield client, token
    finally:
        await stop_process(process)


def reliability():
    return {
        'definition': {
            'kind': 'reliability',
            'reliability': {
                'components': [
                    {
                        'nodeId': 'service',
                        'meanUpSeconds': 80,
                        'meanRepairSeconds': 20,
                        'provenance': {
                            'kind': 'assumed',
                            'source': 'Reference',
                            'context': 'Synthetic test',
                            'recordedAt': '2026-10-13T00:00:00Z',
                            'limitations': '',
                        },
                    }
                ],
                'groups': [],
                'gates': [],
                'root': 'service',
            },
            'ranges': [],
        }
    }


async def project(pool, capacity=False):
    _, projects, user, workspace = await owner(pool)
    archive = fixture('archive')['archive']
    if capacity:
        archive['document'] = next(
            c['document'] for c in fixture('capacity') if c['name'] == 'poisson'
        )
    saved = await projects.create_project(user, workspace, archive, str(uuid4()))
    return Jobs(pool), user, saved['id'], workspace


def report(execution):
    return {
        'contractVersion': '1.0',
        'modelVersion': '1.0',
        'digest': computation_digest(execution),
        'status': 'complete',
        'method': 'exact',
        'availability': 0.8,
        'impacts': [],
        'sensitivity': [],
        'coverage': [],
        'assumptions': [],
        'runtime': {'python': '3.12', 'numpy': '2.2.3', 'image': 'test'},
    }


async def test_job_retry_and_queue_admission(pool):
    jobs, user, project_id, _ = await project(pool)
    operation = str(uuid4())
    first = await jobs.submit(user, project_id, 1, operation, reliability())
    assert first == await jobs.submit(user, project_id, 1, operation, reliability())
    with pytest.raises(ServiceError, match='reused'):
        await jobs.submit(user, project_id, 1, operation, {**reliability(), 'seed': 9})
    for _ in range(9):
        await jobs.submit(user, project_id, 1, str(uuid4()), reliability())
    with pytest.raises(ServiceError) as rejected:
        await jobs.submit(user, project_id, 1, str(uuid4()), reliability())
    assert rejected.value.code == 'QUEUE_LIMIT'
    await jobs.cancel(user, project_id, first['id'])
    assert (await jobs.read(user, project_id, first['id']))['state'] == 'cancelled'


async def test_competing_claims_lease_expiry_and_stale_attempt_fencing(pool):
    jobs, user, project_id, _ = await project(pool)
    submitted = await jobs.submit(user, project_id, 1, str(uuid4()), reliability())
    claims = await asyncio.gather(jobs.claim(), jobs.claim())
    assert sum(c is not None for c in claims) == 1
    claimed = next(c for c in claims if c)
    assert await jobs.heartbeat(claimed['id'], claimed['attemptId'])
    async with pool.connection() as c:
        await c.execute(
            "UPDATE sb_jobs SET lease_until=now()-interval '1 second' WHERE id=%s",
            (submitted['id'],),
        )
    retried = await jobs.claim()
    assert retried['attemptId'] != claimed['attemptId']
    assert not await jobs.finish(claimed['id'], claimed['attemptId'], 'failed', None, 'OBSOLETE')
    assert not await jobs.heartbeat(claimed['id'], claimed['attemptId'])


async def test_cancellation_and_revocation_win_over_completion(pool):
    jobs, user, project_id, workspace = await project(pool)
    await jobs.submit(user, project_id, 1, str(uuid4()), reliability())
    claimed = await jobs.claim()
    await jobs.set_execution(claimed['id'], claimed['attemptId'], claimed['input'])
    await jobs.cancel(user, project_id, claimed['id'])
    assert await jobs.finish(claimed['id'], claimed['attemptId'], 'failed', None, 'UNUSED')
    assert (await jobs.read(user, project_id, claimed['id']))['state'] == 'cancelled'
    await jobs.submit(user, project_id, 1, str(uuid4()), reliability())
    claimed = await jobs.claim()
    async with pool.connection() as c:
        await c.execute(
            "UPDATE sb_members SET role='viewer' WHERE workspace_id=%s AND user_id=%s",
            (workspace, user),
        )
    assert not await jobs.heartbeat(claimed['id'], claimed['attemptId'])
    await jobs.finish(claimed['id'], claimed['attemptId'], 'failed', None, 'UNUSED')
    cancelled = await jobs.read(user, project_id, claimed['id'])
    assert cancelled['state'] == 'cancelled' and cancelled['error'] == 'ACCESS_REVOKED'


@pytest.mark.parametrize('failure', ['deadline', 'oversized', 'wrong-digest'])
async def test_worker_rejects_late_oversized_or_mismatched_results(pool, failure):
    jobs, user, project_id, _ = await project(pool)
    value = reliability()
    if failure == 'deadline':
        value['deadlineMs'] = 100
    submitted = await jobs.submit(user, project_id, 1, str(uuid4()), value)
    claimed = await jobs.claim()
    cancelled = []

    async def handle(request):
        if request.method == 'DELETE':
            cancelled.append(request.url.path)
            return httpx.Response(200, json={'cancelled': True})
        if failure == 'deadline':
            await asyncio.sleep(2)
        if failure == 'oversized':
            return httpx.Response(200, content=b'x' * (8 * 1024 * 1024 + 1))
        result = report(claimed['input'])
        result['digest'] = '0' * 64
        return httpx.Response(200, json=result)

    settings = Settings(
        '',
        'http://localhost:3000',
        'synthetic-test-secret-' * 3,
        True,
        computation_url='http://computation',
        computation_token='synthetic-token-' * 3,
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handle), base_url=settings.computation_url
    ) as client:
        await Worker(pool, settings, client).execute(claimed)
    finished = await jobs.read(user, project_id, submitted['id'])
    assert finished['state'] == ('timed-out' if failure == 'deadline' else 'failed')
    assert finished['report'] is None
    assert len(cancelled) == 1


async def test_worker_rejects_supervisor_contract_drift_before_claiming(pool):
    settings = Settings(
        '',
        'http://localhost:3000',
        'synthetic-test-secret-' * 3,
        True,
        computation_url='http://computation',
        computation_token='synthetic-token-' * 3,
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={'contractVersion': '1.0', 'schemaDigest': '0' * 64})
        ),
        base_url=settings.computation_url,
    ) as client:
        with pytest.raises(ValueError, match='incompatible contracts'):
            await Worker(pool, settings, client).run()


async def test_running_worker_cancellation_reaches_private_supervisor(pool):
    jobs, user, project_id, _ = await project(pool)
    submitted = await jobs.submit(user, project_id, 1, str(uuid4()), reliability())
    claimed = await jobs.claim()
    started, stopped = asyncio.Event(), asyncio.Event()
    requests = []

    async def handle(request):
        requests.append((request.method, request.url.path))
        if request.method == 'DELETE':
            stopped.set()
            return httpx.Response(200, json={'cancelled': True})
        started.set()
        await asyncio.Event().wait()

    settings = Settings(
        '',
        'http://localhost:3000',
        'synthetic-test-secret-' * 3,
        True,
        computation_url='http://computation',
        computation_token='synthetic-token-' * 3,
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handle),
        base_url=settings.computation_url,
    ) as client:
        running = asyncio.create_task(Worker(pool, settings, client).execute(claimed))
        try:
            await asyncio.wait_for(started.wait(), 5)
            await jobs.cancel(user, project_id, submitted['id'])
            await asyncio.wait_for(stopped.wait(), 8)
            await asyncio.wait_for(running, 5)
        finally:
            if not running.done():
                running.cancel()
                await running
    finished = await jobs.read(user, project_id, submitted['id'])
    assert finished['state'] == 'cancelled' and finished['report'] is None
    assert requests == [
        ('POST', '/v1/executions'),
        ('DELETE', '/v1/executions/' + claimed['attemptId']),
    ]


@pytest.mark.parametrize('kind', ['reliability', 'analytical', 'simulation'])
async def test_real_python_worker_supervisor_and_bundle_export(pool, numerical_supervisor, kind):
    client, token = numerical_supervisor
    jobs, user, project_id, _ = await project(pool, capacity=kind != 'reliability')
    value = (
        reliability()
        if kind == 'reliability'
        else {
            'definition': {
                'kind': 'capacity-sensitivity',
                'scenarioId': 's',
                'engine': kind,
                'targetId': 't',
                'parameter': 'requestsPerSecond',
                'values': [10, 20],
                'metricId': 'mean-latency',
                'nodeId': 'service',
            }
        }
    )
    submitted = await jobs.submit(user, project_id, 1, str(uuid4()), value)
    claimed = await jobs.claim()
    settings = Settings(
        '',
        'http://localhost:3000',
        'synthetic-test-secret-' * 3,
        True,
        computation_url=str(client.base_url),
        computation_token=token,
    )
    await Worker(pool, settings, client).execute(claimed)
    finished = await jobs.read(user, project_id, submitted['id'])
    assert finished['state'] == 'completed', finished['error']
    bundle = await jobs.export(user, project_id, submitted['id'])
    assert bundle['report']['digest'] == computation_digest(bundle['input'])
    if kind == 'reliability':
        assert bundle['report']['availability'] == pytest.approx(0.8)
    else:
        assert len(bundle['input']['capacitySamples']) == 2
        assert bundle['input']['capacitySamples'][0]['engineVersion'] == '1.2.0-python.1'
    imported = await jobs.submit(user, project_id, 1, str(uuid4()), bundle, True)
    assert imported['origin'] == 'imported' and imported['state'] == 'completed'
    assert await jobs.claim() is None


async def test_native_api_and_worker_execute_without_node(pool, numerical_supervisor, tmp_path):
    numerical, token = numerical_supervisor
    jobs, user, project_id, _ = await project(pool)
    submitted = await jobs.submit(user, project_id, 1, str(uuid4()), reliability())
    async with pool.connection() as c:
        schema = (await one(c, 'SHOW search_path'))['search_path']
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    env = {
        **os.environ,
        'DATABASE_URL': make_conninfo(
            os.environ['SWIFTBUILD_TEST_DATABASE_URL'], options='-c search_path=' + schema
        ),
        'SWIFTBUILD_URL': 'http://localhost:3000',
        'SWIFTBUILD_AUTH_SECRET': 'synthetic-test-secret-' * 3,
        'SWIFTBUILD_ALLOW_LOCAL_HTTP': '1',
        'SWIFTBUILD_BACKEND_PORT': str(port),
        'SWIFTBUILD_COMPUTATION_ENABLED': '1',
        'SWIFTBUILD_COMPUTATION_URL': str(numerical.base_url),
        'SWIFTBUILD_COMPUTATION_TOKEN': token,
        'SWIFTBUILD_OIDC_DISCOVERY_URL': '',
        'SWIFTBUILD_OIDC_CLIENT_ID': '',
        'SWIFTBUILD_OIDC_CLIENT_SECRET': '',
        'PATH': str(tmp_path),
    }
    assert shutil.which('node', path=env['PATH']) is None
    children = []
    try:
        for module in ('swiftbuild_backend', 'swiftbuild_backend.worker'):
            children.append(
                subprocess.Popen(
                    [sys.executable, '-m', module],
                    cwd=Path(__file__).resolve().parents[1],
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            )
        async with httpx.AsyncClient(base_url='http://127.0.0.1:' + str(port), timeout=2) as client:
            ready = False
            for _ in range(100):
                assert all(child.poll() is None for child in children)
                try:
                    ready = (await client.get('/api/v1/ready')).is_success
                except httpx.HTTPError:
                    pass
                if ready:
                    break
                await asyncio.sleep(0.1)
            assert ready
            assert (await client.get('/api/health')).status_code == 200
        for _ in range(100):
            completed = await jobs.read(user, project_id, submitted['id'])
            if completed['state'] not in ('queued', 'running'):
                break
            await asyncio.sleep(0.1)
        assert completed['state'] == 'completed', completed['error']
        assert completed['report']['availability'] == pytest.approx(0.8)
    finally:
        for child in reversed(children):
            await stop_process(child)
