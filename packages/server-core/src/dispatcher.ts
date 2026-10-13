import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import {
  ComputationReportSchema,
  ExecutionInputSchema,
  MAX_COMPUTATION_BYTES,
  type ExecutionInput,
} from '@swiftbuild/computation-contracts';
import { createJobStore, digest, boundedComputation } from './jobs';
const url = process.env.SWIFTBUILD_COMPUTATION_URL;
const token = process.env.SWIFTBUILD_COMPUTATION_TOKEN;
if (!process.env.DATABASE_URL || !url || !token || token.length < 32)
  throw new Error('Configure the database, computation URL and private token.');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
const store = createJobStore(pool);
const workerId = randomUUID();
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
};
let stopping = false;
let activeAbort: AbortController | undefined;
process.on('SIGTERM', () => {
  stopping = true;
  activeAbort?.abort();
});
process.on('SIGINT', () => {
  stopping = true;
  activeAbort?.abort();
});
async function remote(path: string, init: RequestInit = {}) {
  return fetch(new URL(path, url), {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(5000),
  });
}
async function sweep(
  document: unknown,
  input: ExecutionInput,
  signal: AbortSignal,
) {
  return new Promise<NonNullable<ExecutionInput['capacitySamples']>>(
    (resolve, reject) => {
      const child = fork(
        fileURLToPath(new URL('./sweep-child.ts', import.meta.url)),
        [],
        {
          execArgv: ['--import', import.meta.resolve('tsx')],
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: {
            ...process.env,
            SWIFTBUILD_SWEEP_CHILD: '1',
            NODE_OPTIONS: '--v8-pool-size=2 --max-old-space-size=384',
            UV_THREADPOOL_SIZE: '2',
            GOMAXPROCS: '2',
          },
        },
      );
      const abort = () => {
        child.kill('SIGKILL');
        reject(new Error('EXECUTION_ABORTED'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      child.once(
        'message',
        (message: {
          samples?: NonNullable<ExecutionInput['capacitySamples']>;
          error?: string;
        }) => {
          signal.removeEventListener('abort', abort);
          if (message.samples) resolve(message.samples);
          else reject(new Error('SWEEP_FAILED'));
        },
      );
      child.once('error', () => {
        signal.removeEventListener('abort', abort);
        reject(new Error('SWEEP_FAILED'));
      });
      child.once('exit', (code) => {
        signal.removeEventListener('abort', abort);
        if (code !== 0) reject(new Error('SWEEP_FAILED'));
      });
      child.send({ document, input });
    },
  );
}
async function runJob(
  job: NonNullable<Awaited<ReturnType<typeof store.claim>>>,
) {
  const abort = new AbortController();
  activeAbort = abort;
  const started = Date.now();
  let cancelled = false,
    timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, job.input.deadlineMs);
  let beating = true;
  const heartbeat = (async () => {
    while (beating) {
      await delay(3000);
      if (!beating) break;
      try {
        await pool.query(
          'UPDATE sb_worker_heartbeats SET updated_at=now() WHERE id=$1',
          [workerId],
        );
        if (!(await store.heartbeat(job.id, job.attemptId))) {
          cancelled = true;
          abort.abort();
          break;
        }
      } catch {
        abort.abort();
        break;
      }
    }
  })();
  try {
    const input = structuredClone(job.input);
    if (input.definition.kind === 'capacity-sensitivity')
      input.capacitySamples = await sweep(job.document, input, abort.signal);
    input.deadlineMs = Math.max(
      100,
      job.input.deadlineMs - (Date.now() - started),
    );
    ExecutionInputSchema.parse(input);
    boundedComputation(input);
    await store.setExecution(job.id, job.attemptId, input);
    const response = await remote('/v1/executions', {
      method: 'POST',
      body: JSON.stringify({
        attemptId: job.attemptId,
        digest: digest(input),
        input,
      }),
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > MAX_COMPUTATION_BYTES) {
        await reader.cancel();
        throw new Error('OUTPUT_LIMIT');
      }
      chunks.push(part.value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) {
      const allowed = [
        'MEMORY_EXHAUSTED',
        'RESOURCE_EXHAUSTED_OR_KILLED',
        'OUTPUT_LIMIT',
        'EXECUTION_CANCELLED',
        'EXECUTION_TIMEOUT',
      ];
      throw new Error(
        response.status === 504
          ? 'EXECUTION_TIMEOUT'
          : allowed.includes(body.detail)
            ? body.detail
            : 'COMPUTATION_FAILED',
      );
    }
    const report = ComputationReportSchema.parse(body);
    await store.finish(
      job.id,
      job.attemptId,
      report.status === 'complete' ? 'completed' : 'partial',
      report,
      null,
    );
    console.log(
      JSON.stringify({
        event: 'analysis.finished',
        jobId: job.id,
        attemptId: job.attemptId,
        status: report.status,
      }),
    );
  } catch (error) {
    const code =
      timedOut ||
      (error instanceof Error && error.message === 'EXECUTION_TIMEOUT')
        ? 'EXECUTION_TIMEOUT'
        : cancelled || stopping
          ? 'CANCELLED'
          : error instanceof Error &&
              [
                'MEMORY_EXHAUSTED',
                'RESOURCE_EXHAUSTED_OR_KILLED',
                'OUTPUT_LIMIT',
              ].includes(error.message)
            ? error.message
            : 'EXECUTION_FAILED';
    await remote(`/v1/executions/${job.attemptId}`, { method: 'DELETE' }).catch(
      () => {},
    );
    await store.finish(
      job.id,
      job.attemptId,
      code === 'EXECUTION_TIMEOUT'
        ? 'timed-out'
        : code === 'CANCELLED'
          ? 'cancelled'
          : 'failed',
      null,
      code,
    );
    console.error(
      JSON.stringify({
        event: 'analysis.failed',
        jobId: job.id,
        attemptId: job.attemptId,
        code,
      }),
    );
  } finally {
    beating = false;
    clearTimeout(deadline);
    await heartbeat;
    activeAbort = undefined;
  }
}
try {
  const schemaDigest = createHash('sha256')
    .update(
      await readFile(
        new URL(
          '../../../services/computation/contracts.json',
          import.meta.url,
        ),
      ),
    )
    .digest('hex');
  while (!stopping) {
    try {
      const ready = await remote('/v1/ready');
      const compatibility = (await ready.json()) as {
        contractVersion: string;
        schemaDigest: string;
        active: number;
      };
      if (
        !ready.ok ||
        compatibility.contractVersion !== '1.0' ||
        compatibility.schemaDigest !== schemaDigest
      )
        throw new Error('Computation contract incompatibility.');
      await pool.query(
        'INSERT INTO sb_worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET updated_at=now()',
        [workerId],
      );
      if (compatibility.active === 0) {
        const job = await store.claim();
        if (job) await runJob(job);
      }
    } catch {
      console.error(
        JSON.stringify({ event: 'dispatcher.unavailable', workerId }),
      );
    }
    if (!stopping) await delay(1000);
  }
} finally {
  await pool
    .query('DELETE FROM sb_worker_heartbeats WHERE id=$1', [workerId])
    .catch(() => {});
  await pool.end();
}
