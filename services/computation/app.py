"""Private computation supervisor. Durable scheduling belongs to TypeScript."""
import asyncio
import hashlib
import json
import logging
import os
import secrets
import signal
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from jsonschema import Draft202012Validator

from engine import canonical_digest
from generated.ExecutionRequest import ExecutionRequest

logging.basicConfig(level=logging.INFO, format='%(message)s')

ROOT = Path(__file__).parent
SCHEMAS = json.loads((ROOT / 'contracts.json').read_text(encoding='utf-8'))
LIMIT = 8 * 1024 * 1024
TOKEN = os.environ.get('SWIFTBUILD_COMPUTATION_TOKEN', '')
active = {}
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def authorize(request):
    if len(TOKEN) < 32:
        raise HTTPException(503, 'Computation authentication is not configured')
    if not secrets.compare_digest(request.headers.get('authorization', ''), f'Bearer {TOKEN}'):
        raise HTTPException(401, 'Unauthorized')


def bounds():
    # Linux child-only limits. Container limits remain necessary for aggregate RSS.
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (120, 121))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT, LIMIT))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


async def stop(process):
    if process is None:
        return
    if process.returncode is None:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), 1)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()


@app.get('/health')
async def health():
    return {'status': 'alive'}


@app.get('/v1/ready')
async def ready(request: Request):
    authorize(request)
    return {'contractVersion': '1.0', 'schemaDigest': hashlib.sha256((ROOT / 'contracts.json').read_bytes()).hexdigest(), 'active': len(active)}


@app.delete('/v1/executions/{attempt_id}')
async def cancel(attempt_id: str, request: Request):
    authorize(request)
    entry = active.get(attempt_id)
    if entry:
        entry['cancelled'] = True
        await stop(entry['process'])
    return {'status': 'cancelled'}


@app.post('/v1/executions')
async def execute(request: Request):
    authorize(request)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > LIMIT:
            raise HTTPException(413, 'Input exceeds limit')
    try:
        data = json.loads(raw)
        Draft202012Validator(SCHEMAS['ExecutionRequest']).validate(data)
        ExecutionRequest.model_validate(data)
        if canonical_digest(data['input']) != data['digest']:
            raise ValueError('digest')
    except Exception:
        raise HTTPException(400, 'Invalid computation input') from None
    attempt_id = data['attemptId']
    if active:
        raise HTTPException(409, 'Computation worker is busy')
    # Reserve before awaiting spawn, so concurrent requests cannot exceed limits.
    active[attempt_id] = {'process': None, 'cancelled': False}
    try:
        with tempfile.TemporaryDirectory(prefix='swiftbuild-compute-') as directory:
            source, output = Path(directory) / 'input.json', Path(directory) / 'result.json'
            source.write_text(json.dumps(data, allow_nan=False), encoding='utf-8')
            env = dict(os.environ, OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', MKL_NUM_THREADS='1', NUMEXPR_NUM_THREADS='1')
            process = await asyncio.create_subprocess_exec(sys.executable, str(ROOT / 'engine.py'), str(source), str(output), env=env, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, preexec_fn=bounds if sys.platform == 'linux' else None)
            active[attempt_id]['process'] = process
            if active[attempt_id]['cancelled']:
                await stop(process)
            try:
                await asyncio.wait_for(process.wait(), data['input']['deadlineMs'] / 1000)
            except asyncio.TimeoutError:
                await stop(process)
                raise HTTPException(504, 'EXECUTION_TIMEOUT') from None
            if active[attempt_id]['cancelled']:
                raise HTTPException(409, 'EXECUTION_CANCELLED')
            if process.returncode:
                # SIGKILL can also be external; do not claim every kill is OOM.
                code = 'MEMORY_EXHAUSTED' if process.returncode == 75 else 'RESOURCE_EXHAUSTED_OR_KILLED' if process.returncode == -signal.SIGKILL else 'COMPUTATION_FAILED'
                raise HTTPException(422, code)
            if not output.exists() or output.stat().st_size > LIMIT:
                raise HTTPException(422, 'OUTPUT_LIMIT')
            try:
                result = json.loads(output.read_text(encoding='utf-8'))
                Draft202012Validator(SCHEMAS['ComputationReport']).validate(result)
            except Exception:
                raise HTTPException(422, 'OUTPUT_SCHEMA_INVALID') from None
            logging.info(json.dumps({'event': 'computation.completed', 'attemptId': attempt_id, 'status': result['status']}))
            return result
    except HTTPException as failure:
        logging.warning(json.dumps({'event': 'computation.failed', 'attemptId': attempt_id, 'status': failure.status_code}))
        raise
    finally:
        entry = active.pop(attempt_id, None)
        if entry and entry['process']:
            await stop(entry['process'])
