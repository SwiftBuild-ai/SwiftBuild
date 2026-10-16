"""Durable PostgreSQL dispatcher with fenced attempts and isolated computations."""

import asyncio
import contextlib
import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import httpx

from .config import Settings
from .database import check_migrations, pool_for
from .domain import MAX_COMPUTATION_BYTES, validate_contract
from .jobs import Jobs, bounded
from .serialization import computation_digest

log = logging.getLogger('swiftbuild')
SCHEMA_DIGEST = json.loads(
    (Path(__file__).parent / 'contracts/computation.json').read_text('utf-8')
)['schemaDigest']


async def stop_process(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            await asyncio.to_thread(process.wait, timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            await asyncio.to_thread(process.wait)


async def sweep(document, execution):
    process = None
    try:
        with tempfile.TemporaryDirectory(prefix='swiftbuild-sweep-') as directory:
            source, output = Path(directory) / 'input.json', Path(directory) / 'result.json'
            source.write_text(
                json.dumps({'document': document, 'input': execution}, allow_nan=False),
                encoding='utf-8',
            )
            # Only platform/Python essentials enter the child. In particular no database,
            # session secret, provider credentials, or computation bearer token enter it.
            env = {
                k: os.environ[k]
                for k in ('PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG')
                if k in os.environ
            }
            env['PYTHONPATH'] = str(Path(__file__).parent.parent)
            process = subprocess.Popen(
                [sys.executable, '-m', 'swiftbuild_backend.sweep', str(source), str(output)],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            await asyncio.to_thread(process.wait)
            if (
                process.returncode != 0
                or not output.is_file()
                or output.stat().st_size > MAX_COMPUTATION_BYTES
            ):
                raise ValueError('SWEEP_FAILED')
            return json.loads(output.read_text('utf-8'))
    finally:
        await stop_process(process)


class Worker:
    def __init__(self, pool, settings, client=None):
        self.pool, self.settings, self.jobs = pool, settings, Jobs(pool)
        self.id, self.stopping = str(uuid4()), asyncio.Event()
        self.client = client or httpx.AsyncClient(
            base_url=settings.computation_url,
            headers={'authorization': 'Bearer ' + settings.computation_token},
            timeout=5,
        )
        self.owns_client = client is None

    async def stamp(self):
        async with self.pool.connection() as c:
            await c.execute(
                'INSERT INTO sb_worker_heartbeats(id,updated_at) VALUES (%s,now()) ON CONFLICT(id) DO UPDATE SET updated_at=now()',
                (self.id,),
            )

    async def execute(self, job):
        started = time.monotonic()

        async def compute():
            execution = dict(job['input'])
            if execution['definition']['kind'] == 'capacity-sensitivity':
                execution['capacitySamples'] = await sweep(job['document'], execution)
            execution['deadlineMs'] = max(
                100, execution['deadlineMs'] - math_floor_ms(time.monotonic() - started)
            )
            validate_contract('ExecutionInput', execution)
            bounded(execution)
            await self.jobs.set_execution(job['id'], job['attemptId'], execution)
            async with self.client.stream(
                'POST',
                '/v1/executions',
                json={
                    'attemptId': job['attemptId'],
                    'digest': computation_digest(execution),
                    'input': execution,
                },
                timeout=execution['deadlineMs'] / 1000 + 5,
            ) as response:
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_COMPUTATION_BYTES:
                        raise ValueError('OUTPUT_LIMIT')
                result = json.loads(data)
                if not response.is_success:
                    allowed = (
                        'MEMORY_EXHAUSTED',
                        'RESOURCE_EXHAUSTED_OR_KILLED',
                        'OUTPUT_LIMIT',
                        'EXECUTION_CANCELLED',
                        'EXECUTION_TIMEOUT',
                    )
                    raise ValueError(
                        'EXECUTION_TIMEOUT'
                        if response.status_code == 504
                        else result.get('detail')
                        if result.get('detail') in allowed
                        else 'COMPUTATION_FAILED'
                    )
            report = validate_contract('ComputationReport', result)
            await self.jobs.finish(
                job['id'],
                job['attemptId'],
                'completed' if report['status'] == 'complete' else 'partial',
                report,
            )
            log.info(
                json.dumps(
                    {
                        'event': 'analysis.finished',
                        'jobId': job['id'],
                        'attemptId': job['attemptId'],
                        'status': report['status'],
                    }
                )
            )

        async def heartbeat(task):
            while not task.done():
                try:
                    await asyncio.sleep(3)
                    await self.stamp()
                    if self.stopping.is_set() or not await self.jobs.heartbeat(
                        job['id'], job['attemptId']
                    ):
                        task.cancel()
                        return
                except asyncio.CancelledError:
                    raise
                except Exception:
                    task.cancel()
                    return

        task = asyncio.create_task(compute())
        beat = asyncio.create_task(heartbeat(task))
        try:
            await asyncio.wait_for(task, job['input']['deadlineMs'] / 1000)
        except (Exception, asyncio.CancelledError) as error:
            if isinstance(error, TimeoutError) or str(error) == 'EXECUTION_TIMEOUT':
                code, state = 'EXECUTION_TIMEOUT', 'timed-out'
            elif isinstance(error, asyncio.CancelledError):
                code, state = 'CANCELLED', 'cancelled'
            else:
                code = (
                    str(error)
                    if str(error)
                    in ('MEMORY_EXHAUSTED', 'RESOURCE_EXHAUSTED_OR_KILLED', 'OUTPUT_LIMIT')
                    else 'EXECUTION_FAILED'
                )
                state = 'failed'
            with contextlib.suppress(Exception):
                await self.client.delete('/v1/executions/' + job['attemptId'])
            await self.jobs.finish(job['id'], job['attemptId'], state, None, code)
            log.warning(
                json.dumps(
                    {
                        'event': 'analysis.failed',
                        'jobId': job['id'],
                        'attemptId': job['attemptId'],
                        'code': code,
                    }
                )
            )
        finally:
            beat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beat

    async def run(self):
        try:
            if len(self.settings.computation_token) < 32 or not self.settings.computation_url:
                raise ValueError('Configure the private computation URL and token.')
            async with self.pool.connection() as c:
                await check_migrations(c)
            ready = await self.client.get('/v1/ready')
            if (
                not ready.is_success
                or ready.json().get('contractVersion') != '1.0'
                or ready.json().get('schemaDigest') != SCHEMA_DIGEST
            ):
                raise ValueError(
                    'Computation supervisor is not ready or has incompatible contracts.'
                )
            while not self.stopping.is_set():
                await self.stamp()
                job = await self.jobs.claim()
                if job:
                    await self.execute(job)
                else:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(self.stopping.wait(), 1)
        finally:
            try:
                async with self.pool.connection() as c:
                    await c.execute('DELETE FROM sb_worker_heartbeats WHERE id=%s', (self.id,))
            finally:
                if self.owns_client:
                    await self.client.aclose()


def math_floor_ms(seconds):
    return int(seconds * 1000)


async def async_main():
    settings = Settings.from_env()
    pool = pool_for(settings.database_url, maximum=4)
    await pool.open()
    worker = Worker(pool, settings)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, worker.stopping.set)
        except NotImplementedError:
            signal.signal(sig, lambda *_: loop.call_soon_threadsafe(worker.stopping.set))
    try:
        await worker.run()
    finally:
        await pool.close()


def main():
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(async_main())


if __name__ == '__main__':
    main()
