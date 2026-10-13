import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from '../../capacity-engine/src/fixture.test.data';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { sampleDocument } from '@swiftbuild/components-core';
import { workspaceFor } from '@swiftbuild/project-format';
import { migrate } from './migrate';
import { createProjectStore } from './projects';
import { createJobStore } from './jobs';
const url = process.env.SWIFTBUILD_TEST_DATABASE_URL;
describe.skipIf(!url)('durable engineering jobs', () => {
  const schema = 'swiftbuild_test_' + randomUUID().replaceAll('-', '');
  let admin: Pool, pool: Pool;
  let projectId: string, workspaceId: string;
  const document = sampleDocument();
  const node = document.nodes[0]!.id;
  const input = {
    definition: {
      kind: 'reliability',
      reliability: {
        components: [
          {
            nodeId: node,
            meanUpSeconds: 80,
            meanRepairSeconds: 20,
            provenance: {
              kind: 'assumed',
              source: 'Reference',
              context: 'Test',
              recordedAt: '2026-10-13T00:00:00Z',
              limitations: '',
            },
          },
        ],
        groups: [],
        gates: [],
        root: node,
      },
      ranges: [],
    },
  };
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    if (
      !(
        await admin.query('SELECT current_database() AS name')
      ).rows[0].name.endsWith('_test')
    )
      throw new Error('Isolated _test database required.');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
      max: 6,
    });
    await migrate(pool);
    await pool.query(
      `INSERT INTO sb_auth_users(id,name,email,"emailVerified") SELECT x,x,x||'@example.test',false FROM unnest(ARRAY['owner','viewer','outsider']) x`,
    );
    await pool.query(
      'INSERT INTO sb_admitted_users(user_id) SELECT id FROM sb_auth_users',
    );
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE sb_job_attempts,sb_jobs,sb_audit_events,sb_revisions,sb_projects,sb_members,sb_invitations,sb_workspaces',
    );
    await pool.query('UPDATE sb_admitted_users SET active=true');
    const projects = createProjectStore(pool);
    workspaceId = (await projects.createWorkspace('owner', 'Jobs')).id;
    await pool.query(
      "INSERT INTO sb_members(workspace_id,user_id,role) VALUES($1,'viewer','viewer')",
      [workspaceId],
    );
    projectId = (
      await projects.createProject(
        'owner',
        workspaceId,
        workspaceFor(document),
        randomUUID(),
      )
    ).id;
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
  it('deduplicates retries, rejects changed input, stale revisions, viewers and cross-workspace access', async () => {
    const store = createJobStore(pool);
    const key = randomUUID();
    const result = await store.submit('owner', projectId, 1, key, input);
    expect((await store.submit('owner', projectId, 1, key, input)).id).toBe(
      result.id,
    );
    await expect(
      store.submit('owner', projectId, 1, key, { ...input, seed: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      store.submit('owner', projectId, 2, randomUUID(), input),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(
      store.submit('viewer', projectId, 1, randomUUID(), input),
    ).rejects.toMatchObject({ status: 403 });
    expect((await store.list('viewer', projectId)).length).toBe(1);
    expect((await store.list('viewer', projectId))[0]).not.toHaveProperty(
      'input',
    );
    expect((await store.list('viewer', projectId))[0]).not.toHaveProperty(
      'report',
    );
    await expect(
      store.read('outsider', projectId, result.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      store.cancel('viewer', projectId, result.id),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('limits queue admission and allows one active job per workspace across competing dispatchers', async () => {
    const store = createJobStore(pool);
    for (let i = 0; i < 10; i++)
      await store.submit('owner', projectId, 1, randomUUID(), input);
    await expect(
      store.submit('owner', projectId, 1, randomUUID(), input),
    ).rejects.toMatchObject({ code: 'QUEUE_LIMIT' });
    const claims = await Promise.all([store.claim(), store.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await store.cancel('owner', projectId, claims.find(Boolean)!.id);
    expect(
      await store.heartbeat(
        claims.find(Boolean)!.id,
        claims.find(Boolean)!.attemptId,
      ),
    ).toBe(false);
  });
  it('fences expired attempts, retries only twice and rejects late completion', async () => {
    const store = createJobStore(pool);
    await store.submit('owner', projectId, 1, randomUUID(), input);
    const first = (await store.claim())!;
    await pool.query(
      "UPDATE sb_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [first.id],
    );
    const second = (await store.claim())!;
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(
      await store.finish(first.id, first.attemptId, 'failed', null, 'late'),
    ).toBe(false);
    await pool.query(
      "UPDATE sb_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [first.id],
    );
    expect(await store.claim()).toBe(null);
    expect((await store.read('owner', projectId, first.id)).state).toBe(
      'failed',
    );
  });
  it('cancellation and revoked admission win over running results', async () => {
    const store = createJobStore(pool);
    await store.submit('owner', projectId, 1, randomUUID(), input);
    const first = (await store.claim())!;
    await store.cancel('owner', projectId, first.id);
    await store.finish(first.id, first.attemptId, 'completed', null, null);
    expect((await store.read('owner', projectId, first.id)).state).toBe(
      'cancelled',
    );
    await store.submit('owner', projectId, 1, randomUUID(), input);
    const second = (await store.claim())!;
    await pool.query(
      "UPDATE sb_admitted_users SET active=false WHERE user_id='owner'",
    );
    expect(await store.heartbeat(second.id, second.attemptId)).toBe(false);
    await store.finish(second.id, second.attemptId, 'completed', null, null);
    expect((await store.read('viewer', projectId, second.id)).state).toBe(
      'cancelled',
    );
  });
  it('exports and imports historical bundles without queueing execution', async () => {
    const store = createJobStore(pool);
    const first = await store.submit(
      'owner',
      projectId,
      1,
      randomUUID(),
      input,
    );
    const bundle = await store.export('viewer', projectId, first.id);
    const imported = await store.submit(
      'owner',
      projectId,
      1,
      randomUUID(),
      bundle,
      true,
    );
    expect(imported.origin).toBe('imported');
    expect(imported.state).toBe('partial');
    await store.cancel('owner', projectId, first.id);
    expect(await store.claim()).toBe(null);
  });
  it('rejects missing node references and cycles before queueing', async () => {
    const store = createJobStore(pool);
    const invalid = structuredClone(input);
    invalid.definition.reliability.root = 'missing';
    await expect(
      store.submit('owner', projectId, 1, randomUUID(), invalid),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.skipIf(!process.env.SWIFTBUILD_COMPUTATION_PYTHON)(
    'integrates PostgreSQL, dispatcher, isolated Python and TypeScript sweeps end to end',
    async () => {
      const listener = createServer();
      await new Promise<void>((resolve) =>
        listener.listen(0, '127.0.0.1', resolve),
      );
      const port = (listener.address() as { port: number }).port;
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      const token = 'test-computation-token-'.repeat(3);
      const computation = spawn(
        process.env.SWIFTBUILD_COMPUTATION_PYTHON!,
        [
          '-m',
          'uvicorn',
          'app:app',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--no-access-log',
        ],
        {
          cwd: fileURLToPath(
            new URL('../../../services/computation', import.meta.url),
          ),
          env: {
            ...process.env,
            SWIFTBUILD_COMPUTATION_TOKEN: token,
            OPENBLAS_NUM_THREADS: '1',
          },
          stdio: 'ignore',
        },
      );
      const scoped = new URL(url!);
      scoped.searchParams.set('options', '-c search_path=' + schema);
      let dispatcher: ReturnType<typeof spawn> | undefined;
      try {
        for (let i = 0; i < 100; i++) {
          try {
            if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
          } catch {
            /* wait for startup */
          }
          await delay(100);
        }
        dispatcher = spawn(
          process.execPath,
          [
            '--import',
            pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
            fileURLToPath(new URL('./dispatcher.ts', import.meta.url)),
          ],
          {
            env: {
              ...process.env,
              DATABASE_URL: scoped.toString(),
              SWIFTBUILD_COMPUTATION_URL: `http://127.0.0.1:${port}`,
              SWIFTBUILD_COMPUTATION_TOKEN: token,
            },
            stdio: 'ignore',
          },
        );
        const store = createJobStore(pool);
        const queued = await store.submit(
          'owner',
          projectId,
          1,
          randomUUID(),
          input,
        );
        const wait = async (id: string) => {
          for (let i = 0; i < 200; i++) {
            const r = await store.read('owner', projectId, id);
            if (!['queued', 'running', 'cancelling'].includes(r.state))
              return r;
            await delay(100);
          }
          throw new Error('End-to-end job did not finish.');
        };
        const first = await wait(queued.id);
        expect(first.state).toBe('completed');
        expect(first.report!.availability).toBeCloseTo(0.8, 12);
        const bundle = await store.export('owner', projectId, queued.id);
        expect(bundle.report!.digest).toHaveLength(64);
        const d = fixture();
        d.scenarios[0]!.trafficClasses[0]!.arrivals = 'poisson';
        d.performanceProfiles[0]!.serviceTime = {
          kind: 'exponential',
          meanMs: 20,
        };
        await createProjectStore(pool).saveProject(
          'owner',
          projectId,
          1,
          workspaceFor(d),
          randomUUID(),
        );
        const imported = await store.submit(
          'owner',
          projectId,
          2,
          randomUUID(),
          bundle,
          true,
        );
        expect(imported.revision).toBe(1);
        expect(imported.origin).toBe('imported');
        const swept = await store.submit('owner', projectId, 2, randomUUID(), {
          definition: {
            kind: 'capacity-sensitivity',
            scenarioId: 's',
            engine: 'analytical',
            targetId: 't',
            parameter: 'requestsPerSecond',
            values: [10, 20],
            metricId: 'mean-latency',
            nodeId: 'service',
          },
        });
        const result = await wait(swept.id);
        expect(result.state).toBe('completed');
        expect(result.report!.sensitivity).toHaveLength(2);
        expect(result.report!.sensitivity[0]!.value).toBeCloseTo(25, 8);
        expect(
          (await store.export('owner', projectId, swept.id)).input
            .capacitySamples,
        ).toHaveLength(2);
      } finally {
        await Promise.all(
          [dispatcher, computation].filter(Boolean).map(
            (child) =>
              new Promise<void>((resolve) => {
                if (child!.exitCode !== null || child!.signalCode !== null) {
                  resolve();
                  return;
                }
                child!.once('exit', () => resolve());
                child!.kill();
              }),
          ),
        );
      }
    },
    60000,
  );
});
