import asyncio
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from psycopg.conninfo import make_conninfo

from swiftbuild_backend.config import Settings
from swiftbuild_backend.database import one
from swiftbuild_backend.identity import Identity


async def test_native_operator_without_node_runtime(pool, tmp_path):
    async with pool.connection() as c:
        schema = (await one(c, 'SHOW search_path'))['search_path']
    env = {
        **os.environ,
        'DATABASE_URL': make_conninfo(
            os.environ['SWIFTBUILD_TEST_DATABASE_URL'], options='-c search_path=' + schema
        ),
        'SWIFTBUILD_URL': 'http://localhost:3000',
        'SWIFTBUILD_ALLOW_LOCAL_HTTP': '1',
        'SWIFTBUILD_AUTH_SECRET': 'synthetic-test-secret-' * 3,
        'PATH': str(tmp_path),
    }
    root = Path(__file__).resolve().parents[1]

    async def run(*args):
        result = await asyncio.to_thread(
            subprocess.run,
            [sys.executable, '-m', 'swiftbuild_backend.cli', *args],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    assert 'migrations applied' in await run('migrate')
    original = await run('bootstrap', '--email', 'owner@example.test')
    replacement = await run('bootstrap-rotate', '--email', 'owner@example.test')
    assert original != replacement
    token = parse_qs(urlsplit(replacement).query)['token'][0]
    identity = Identity(
        pool, Settings('', env['SWIFTBUILD_URL'], env['SWIFTBUILD_AUTH_SECRET'], True)
    )
    await identity.create_account(
        'owner@example.test', 'synthetic password for tests', 'Owner', token
    )
    output = await run('recover', '--email', 'owner@example.test')
    recovery = urlsplit(output.splitlines()[0]).path.split('/')[-1]
    await identity.reset_password(recovery, 'replacement synthetic password')
    assert await identity.sign_in('owner@example.test', 'replacement synthetic password')


async def test_native_worker_health_requires_a_fresh_heartbeat(pool, tmp_path):
    async with pool.connection() as c:
        schema = (await one(c, 'SHOW search_path'))['search_path']
    env = {
        **os.environ,
        'DATABASE_URL': make_conninfo(
            os.environ['SWIFTBUILD_TEST_DATABASE_URL'], options='-c search_path=' + schema
        ),
        'PATH': str(tmp_path),
    }

    async def health():
        result = await asyncio.to_thread(
            subprocess.run,
            [sys.executable, '-m', 'swiftbuild_backend.worker_health'],
            cwd=Path(__file__).resolve().parents[1],
            env=env,
            capture_output=True,
            timeout=15,
        )
        assert result.stdout == b'' and result.stderr == b''
        return result.returncode

    assert await health() == 1
    async with pool.connection() as c:
        await c.execute(
            "INSERT INTO sb_worker_heartbeats(id,updated_at) VALUES ('00000000-0000-4000-8000-000000000001',now())"
        )
    assert await health() == 0
    async with pool.connection() as c:
        await c.execute("UPDATE sb_worker_heartbeats SET updated_at=now()-interval '31 seconds'")
    assert await health() == 1
