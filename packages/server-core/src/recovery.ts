import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  chmod,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { migrations } from './migrate';

export const RECOVERY_TABLES = [
  'sb_migrations',
  'sb_workspaces',
  'sb_members',
  'sb_projects',
  'sb_revisions',
  'sb_audit_events',
  'sb_auth_users',
  'sb_auth_sessions',
  'sb_auth_accounts',
  'sb_auth_verifications',
  'sb_auth_limits',
  'sb_admitted_users',
  'sb_instance',
  'sb_invitations',
  'sb_jobs',
  'sb_job_attempts',
  'sb_worker_heartbeats',
] as const;
const tables = RECOVERY_TABLES;
const ManifestSchema = z.strictObject({
  format: z.literal('swiftbuild-database-backup'),
  version: z.literal('1.0'),
  id: z.uuid(),
  snapshotAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  database: z.string().min(1).max(63),
  serverVersion: z.number().int().positive(),
  dumpVersion: z.string().max(256),
  release: z.string().min(1).max(256),
  file: z.literal('database.dump'),
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  migrations: z
    .array(
      z.strictObject({
        id: z.string(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(1000),
  rows: z.record(z.string(), z.string().regex(/^\d+$/)),
});
export type BackupManifest = z.infer<typeof ManifestSchema>;
const timeout = 600000;
async function pgTool(
  name: 'pg_dump' | 'pg_restore',
  args: string[],
  connection: string,
) {
  const url = new URL(connection);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username
  )
    throw new Error(
      'Configure an explicit PostgreSQL connection for recovery.',
    );
  const settings: Record<string, string> = {
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    options: 'PGOPTIONS',
    connect_timeout: 'PGCONNECT_TIMEOUT',
    application_name: 'PGAPPNAME',
  };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGOPTIONS: '',
  };
  for (const [key, value] of url.searchParams) {
    if (!settings[key])
      throw new Error(
        'Unsupported database connection parameter for recovery tools.',
      );
    env[settings[key]!] = value;
  }
  try {
    return await promisify(execFile)(name, args, {
      env,
      timeout,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error(
      'PostgreSQL recovery tool failed. Check tool availability, database access, timeout and disk space.',
    );
  }
}
async function fileDigest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function inventory(client: PoolClient) {
  const applied = (
    await client.query<{ id: string; checksum: string }>(
      'SELECT id,checksum FROM public.sb_migrations ORDER BY id',
    )
  ).rows;
  const expected = migrations.map((m) => ({
    id: m.id,
    checksum: createHash('sha256').update(m.sql).digest('hex'),
  }));
  if (JSON.stringify(applied) !== JSON.stringify(expected))
    throw new Error(
      'Recovery requires the release matching the exact applied migrations.',
    );
  const rows: Record<string, string> = {};
  for (const table of tables)
    rows[table] = (
      await client.query(`SELECT count(*)::text AS n FROM public.${table}`)
    ).rows[0].n;
  return { migrations: applied, rows };
}
/** Private operator backup. A shared exported snapshot ties the manifest to the dump. */
export async function backupDatabase(
  connection: string,
  directory: string,
  release = 'unrecorded',
) {
  const root = resolve(directory);
  await mkdir(root, { mode: 0o700 }); // Never overwrite or reuse an existing backup directory.
  const pool = new Pool({
    connectionString: connection,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotAt = new Date().toISOString();
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id'))
      .rows[0].id;
    const state = await inventory(client);
    const database = (await client.query('SELECT current_database() AS name'))
      .rows[0].name;
    const serverVersion = Number(
      (await client.query('SHOW server_version_num')).rows[0]
        .server_version_num,
    );
    const version = await pgTool('pg_dump', ['--version'], connection);
    const file = join(root, 'database.dump');
    await writeFile(file, '', { flag: 'wx', mode: 0o600 });
    const dumped = await pgTool(
      'pg_dump',
      [
        '--format=custom',
        '--schema=public',
        '--no-acl',
        '--snapshot',
        snapshot,
        '--file',
        file,
      ],
      connection,
    );
    if (dumped.stderr.trim())
      throw new Error(
        'Backup tool reported warnings; review the database with private operator tooling before accepting this backup.',
      );
    await chmod(file, 0o600);
    const manifest = ManifestSchema.parse({
      format: 'swiftbuild-database-backup',
      version: '1.0',
      id: randomUUID(),
      snapshotAt,
      createdAt: new Date().toISOString(),
      database,
      serverVersion,
      dumpVersion: version.stdout.trim(),
      release,
      file: 'database.dump',
      bytes: (await lstat(file)).size,
      sha256: await fileDigest(file),
      ...state,
    });
    await writeFile(
      join(root, 'manifest.tmp'),
      JSON.stringify(manifest, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    await rename(join(root, 'manifest.tmp'), join(root, 'manifest.json'));
    await client.query('COMMIT');
    return manifest;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
}
export async function verifyBackup(directory: string) {
  const root = resolve(directory),
    path = join(root, 'manifest.json');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65536)
    throw new Error('Backup manifest must be a bounded regular file.');
  const manifest = ManifestSchema.parse(
    JSON.parse(await readFile(path, 'utf8')),
  );
  const dump = join(root, manifest.file),
    stat = await lstat(dump);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size !== manifest.bytes ||
    (await fileDigest(dump)) !== manifest.sha256
  )
    throw new Error('Backup integrity verification failed.');
  const expected = migrations.map((m) => ({
    id: m.id,
    checksum: createHash('sha256').update(m.sql).digest('hex'),
  }));
  if (
    JSON.stringify(manifest.migrations) !== JSON.stringify(expected) ||
    Object.keys(manifest.rows).sort().join(',') !== [...tables].sort().join(',')
  )
    throw new Error('Backup manifest is incompatible with this release.');
  return manifest;
}
export function restoreTarget(input: string) {
  if (!/^swiftbuild_restore_[a-z0-9_]{1,35}_test$/.test(input))
    throw new Error(
      'Recovery drills require a new swiftbuild_restore_NAME_test database.',
    );
  return input;
}
/** Restore trusted operator archives only. No overwrites, automatic migrations or target deletion. */
export async function restoreDatabase(
  connection: string,
  directory: string,
  target: string,
) {
  restoreTarget(target);
  const manifest = await verifyBackup(directory);
  const pool = new Pool({
    connectionString: connection,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    if (
      (await pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [target]))
        .rowCount
    )
      throw new Error(
        'Recovery target already exists; it will not be overwritten.',
      );
    const major = Math.floor(
      Number(
        (await pool.query('SHOW server_version_num')).rows[0]
          .server_version_num,
      ) / 10000,
    );
    if (major !== Math.floor(manifest.serverVersion / 10000))
      throw new Error(
        'Recovery drill requires the recorded PostgreSQL major version.',
      );
    await pool.query(`CREATE DATABASE "${target}" TEMPLATE template0`);
  } finally {
    await pool.end();
  }
  const restored = new URL(connection);
  restored.pathname = '/' + target;
  await pgTool(
    'pg_restore',
    [
      '--dbname',
      target,
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      join(resolve(directory), 'database.dump'),
    ],
    restored.toString(),
  );
  const restoredPool = new Pool({
    connectionString: restored.toString(),
    max: 1,
  });
  const client = await restoredPool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const state = await inventory(client);
    if (tables.some((table) => state.rows[table] !== manifest.rows[table]))
      throw new Error(
        'Restored row inventory differs from the backup snapshot.',
      );
    await client.query('COMMIT');
    await client.query('ANALYZE');
    return { database: target, backupId: manifest.id, rows: state.rows };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await restoredPool.end();
  }
}
/** Existing role provisioning, repeated after restore; never rotate its password here. */
export async function grantRestoredRuntime(pool: Pool, database: string) {
  restoreTarget(database);
  if (
    (await pool.query('SELECT current_database() AS name')).rows[0].name !==
    database
  )
    throw new Error(
      'Runtime grants require a connection to the isolated restore target.',
    );
  const role = (
    await pool.query(
      "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='swiftbuild_runtime'",
    )
  ).rows[0];
  if (!role || Object.values(role).some(Boolean))
    throw new Error(
      'A non-privileged existing swiftbuild_runtime role is required.',
    );
  await pool.query(
    `GRANT CONNECT ON DATABASE "${database}" TO swiftbuild_runtime`,
  );
  await pool.query('GRANT USAGE ON SCHEMA public TO swiftbuild_runtime');
  for (const table of tables)
    await pool.query(
      `GRANT ${table === 'sb_migrations' ? 'SELECT' : 'SELECT,INSERT,UPDATE,DELETE'} ON public.${table} TO swiftbuild_runtime`,
    );
  await pool.query(
    'REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.sb_migrations FROM swiftbuild_runtime',
  );
}
