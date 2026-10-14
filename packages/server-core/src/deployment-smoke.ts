import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { unlink, readFile, rmdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { connectBackend } from './backend';
import { issueInvitation } from './identity';
import { createIdentity } from './identity';
import { identityConfig } from './config';
import { createProjectStore } from './projects';
import { createJobStore } from './jobs';
import { verifyBackup, restoreDatabase } from './recovery';
import { parseDocument } from '@swiftbuild/architecture-schema';
import { workspaceFor } from '@swiftbuild/project-format';
const backend = connectBackend();
const endpoint = process.env.SWIFTBUILD_SMOKE_WEB_URL ?? 'http://web:3000';
const origin = new URL(process.env.SWIFTBUILD_URL!).origin;
const database = (await backend.pool.query('SELECT current_database() AS name'))
  .rows[0].name as string;
if (!database.endsWith('_test')) {
  await backend.pool.end();
  throw new Error('Deployment smoke requires an isolated _test database.');
}
let cookie = '';
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const response = await fetch(endpoint + path, {
    method,
    headers: { origin, cookie, 'content-type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`Smoke request failed with status ${response.status}.`);
  return response;
}
const restore =
  'swiftbuild_restore_' + randomUUID().replaceAll('-', '') + '_test';
const backup = '/tmp/swiftbuild-' + randomUUID();
let restorePool: Pool | undefined;
let replayWorker: ReturnType<typeof spawn> | undefined;
try {
  const fixtureId = process.env.SWIFTBUILD_SMOKE_RESTART_ID ?? randomUUID();
  const email = 'smoke-' + fixtureId + '@example.test';
  const invitation = await issueInvitation(backend.pool, email, {
    bootstrap: true,
  });
  const password =
    process.env.SWIFTBUILD_SMOKE_RESTART_PASSWORD ?? randomUUID() + '!';
  await request(
    '/api/auth/sign-up/email',
    'POST',
    { name: 'Engineering smoke', email, password },
    { 'x-swiftbuild-invitation': invitation.token },
  );
  const signed = await request('/api/auth/sign-in/email', 'POST', {
    email,
    password,
  });
  cookie = signed.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const workspace = await (
    await request('/api/v1/workspaces', 'POST', { name: 'Engineering smoke' })
  ).json();
  const d = parseDocument(
    JSON.parse(
      await readFile(
        new URL('../../../examples/commerce.swiftbuild.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const creationOperation = randomUUID();
  const project = await (
    await request('/api/v1/projects', 'POST', {
      workspaceId: workspace.id,
      operationId: creationOperation,
      archive: workspaceFor(d),
    })
  ).json();
  const node = d.nodes[0]!.id;
  const definition = {
    kind: 'reliability',
    reliability: {
      components: [
        {
          nodeId: node,
          meanUpSeconds: 80,
          meanRepairSeconds: 20,
          provenance: {
            kind: 'assumed',
            source: 'Deployment reference',
            context: 'Isolated test',
            recordedAt: '2026-10-13T00:00:00Z',
          },
        },
      ],
      groups: [],
      gates: [],
      root: node,
    },
    ranges: [],
  };
  const job = await (
    await request(
      `/api/v1/projects/${project.id}/jobs`,
      'POST',
      { operationId: randomUUID(), input: { definition } },
      { 'if-match': '"1"' },
    )
  ).json();
  let result;
  for (let i = 0; i < 300; i++) {
    result = await (
      await request(`/api/v1/projects/${project.id}/jobs/${job.id}`)
    ).json();
    if (!['queued', 'running', 'cancelling'].includes(result.state)) break;
    await delay(100);
  }
  if (
    result.state !== 'completed' ||
    Math.abs(result.report.availability - 0.8) > 1e-12
  )
    throw new Error('Deployment computation did not complete.');
  const bundle = await (
    await request(`/api/v1/projects/${project.id}/jobs/${job.id}/export`)
  ).json();
  if (bundle.report.digest !== result.report.digest)
    throw new Error('Bundle evidence differs.');
  const restoreOperation = randomUUID();
  const revisionRestored = await (
    await request(
      `/api/v1/projects/${project.id}/restore`,
      'POST',
      { sourceRevision: 1, operationId: restoreOperation },
      { 'if-match': '"1"' },
    )
  ).json();
  if (revisionRestored.revision !== 2)
    throw new Error('Revision restoration failed.');
  const before = await backend.pool.query(
    'SELECT digest FROM sb_revisions WHERE project_id=$1',
    [project.id],
  );
  const connection = new URL(process.env.DATABASE_URL!);
  const operator = (command: string, flags: string[], offline = false) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GOMAXPROCS: '2',
      UV_THREADPOOL_SIZE: '2',
    };
    if (offline) delete env.DATABASE_URL;
    const output = execFileSync(
      process.execPath,
      [
        '--v8-pool-size=2',
        '--max-old-space-size=256',
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('./cli.ts', import.meta.url)),
        command,
        ...flags,
      ],
      { env, stdio: 'pipe', timeout: 60000 },
    ).toString();
    return JSON.parse(output);
  };
  if (operator('backup', ['--directory', backup]).event !== 'backup.created')
    throw new Error('Operator backup failed.');
  const manifest = await verifyBackup(backup);
  if (
    operator('verify-backup', ['--directory', backup], true).event !==
    'backup.verified'
  )
    throw new Error('Offline backup verification failed.');
  if (
    operator('recovery-drill', ['--directory', backup, '--database', restore])
      .event !== 'recovery.drill.passed'
  )
    throw new Error('Operator recovery drill failed.');
  let refused = false;
  try {
    await restoreDatabase(connection.toString(), backup, restore);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('Recovery target already exists')
    )
      throw error;
    refused = true;
  }
  if (!refused) throw new Error('Existing restore target was overwritten.');
  connection.pathname = '/' + restore;
  connection.username = 'swiftbuild_runtime';
  connection.password = process.env.SWIFTBUILD_DB_RUNTIME_PASSWORD!;
  restorePool = new Pool({ connectionString: connection.toString() });
  const permissions = (
    await restorePool.query(
      "SELECT has_schema_privilege(current_user,'public','CREATE') AS ddl,has_table_privilege(current_user,'public.sb_migrations','UPDATE') AS migration_write",
    )
  ).rows[0];
  if (permissions.ddl || permissions.migration_write)
    throw new Error('Restored runtime has excessive privileges.');
  if (!manifest.sha256 || manifest.bytes <= 0)
    throw new Error('Backup integrity evidence missing.');
  const restored = await restorePool.query(
    'SELECT digest FROM sb_revisions WHERE project_id=$1',
    [project.id],
  );
  const restoredJob = await restorePool.query(
    'SELECT state,report FROM sb_jobs WHERE id=$1',
    [job.id],
  );
  if (
    restored.rows[0]?.digest !== before.rows[0]?.digest ||
    restoredJob.rows[0]?.state !== 'completed' ||
    restoredJob.rows[0]?.report.digest !== result.report.digest
  )
    throw new Error('Backup/restore evidence mismatch.');
  const restoredIdentity = createIdentity(restorePool, identityConfig());
  const session = await restoredIdentity.session(new Headers({ cookie }));
  if (!session)
    throw new Error('Restored admission/session verification failed.');
  const restoredProjects = createProjectStore(restorePool);
  const recoveredCreation = await restoredProjects.createProject(
    session.user.id,
    workspace.id,
    project.archive,
    creationOperation,
  );
  const recoveredRestore = await restoredProjects.restoreProject(
    session.user.id,
    project.id,
    1,
    1,
    restoreOperation,
  );
  if (
    recoveredCreation.id !== project.id ||
    recoveredRestore.revision !== 2 ||
    (await restoredProjects.listRevisions(session.user.id, project.id))
      .length !== 2
  )
    throw new Error('Restored creation/restoration operation replay failed.');
  const restoredJobs = createJobStore(restorePool);
  await restoredJobs.read(session.user.id, project.id, job.id);
  const replay = await restoredJobs.submit(
    session.user.id,
    project.id,
    2,
    randomUUID(),
    {
      definition: bundle.input.definition,
      seed: bundle.input.seed,
      samples: bundle.input.samples,
    },
  );
  replayWorker = spawn(
    process.execPath,
    [
      '--v8-pool-size=2',
      '--import',
      import.meta.resolve('tsx'),
      fileURLToPath(new URL('./dispatcher.ts', import.meta.url)),
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: connection.toString(),
        SWIFTBUILD_COMPUTATION_URL: 'http://computation:8000',
        GOMAXPROCS: '2',
        UV_THREADPOOL_SIZE: '2',
      },
      stdio: 'ignore',
    },
  );
  let replayResult;
  for (let i = 0; i < 300; i++) {
    replayResult = await restoredJobs.read(
      session.user.id,
      project.id,
      replay.id,
    );
    if (!['queued', 'running', 'cancelling'].includes(replayResult.state))
      break;
    await delay(100);
  }
  if (
    replayResult?.state !== 'completed' ||
    Math.abs(replayResult.report!.availability! - result.report.availability) >
      1e-12
  )
    throw new Error('Restored numerical replay failed.');
  console.log(
    JSON.stringify({
      event: 'deployment.smoke.passed',
      checks: [
        'authenticated-http',
        'durable-job',
        'python-child',
        'analysis-bundle',
        'database-backup-restore',
        'snapshot-manifest-integrity',
        'restored-runtime-role',
        'restored-admission-and-replay',
      ],
    }),
  );
} finally {
  if (
    replayWorker &&
    replayWorker.exitCode === null &&
    replayWorker.signalCode === null
  )
    await new Promise<void>((resolve) => {
      replayWorker!.once('exit', () => resolve());
      replayWorker!.kill();
    });
  await restorePool?.end();
  await backend.pool.query(`DROP DATABASE IF EXISTS "${restore}"`);
  for (const file of ['database.dump', 'manifest.json', 'manifest.tmp'])
    await unlink(backup + '/' + file).catch(() => {});
  await rmdir(backup).catch(() => {});
  await backend.pool.end();
}
