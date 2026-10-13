import { Pool } from 'pg';
import {
  backupDatabase,
  verifyBackup,
  restoreDatabase,
  grantRestoredRuntime,
} from './recovery';

export async function runRecovery(command: string, flags: Map<string, string>) {
  const directory = flags.get('--directory');
  if (
    !directory ||
    [...flags.keys()].some(
      (key) =>
        key !== '--directory' &&
        !(command === 'recovery-drill' && key === '--database'),
    )
  )
    throw new Error(
      'Recovery commands require --directory; only recovery-drill accepts --database.',
    );
  if (command === 'verify-backup') {
    const manifest = await verifyBackup(directory);
    console.log(
      JSON.stringify({
        event: 'backup.verified',
        backupId: manifest.id,
        bytes: manifest.bytes,
      }),
    );
    return;
  }
  const connection = process.env.DATABASE_URL;
  if (!connection)
    throw new Error('Configure the private administrator DATABASE_URL.');
  if (command === 'backup') {
    const manifest = await backupDatabase(
      connection,
      directory,
      process.env.SWIFTBUILD_RELEASE_IMAGE ?? 'unrecorded',
    );
    console.log(
      JSON.stringify({
        event: 'backup.created',
        backupId: manifest.id,
        bytes: manifest.bytes,
      }),
    );
    return;
  }
  const target = flags.get('--database'),
    password = process.env.SWIFTBUILD_DB_RUNTIME_PASSWORD;
  if (!target || !password)
    throw new Error(
      'Recovery drill requires --database and the existing private runtime password.',
    );
  const started = Date.now();
  const report = await restoreDatabase(connection, directory, target);
  const adminUrl = new URL(connection);
  adminUrl.pathname = '/' + target;
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    await grantRestoredRuntime(admin, target);
  } finally {
    await admin.end();
  }
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = 'swiftbuild_runtime';
  runtimeUrl.password = password;
  const runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });
  try {
    await runtime.query('SELECT id FROM public.sb_migrations');
    await runtime.query('BEGIN');
    await runtime.query('UPDATE public.sb_projects SET name=name WHERE false');
    await runtime.query('ROLLBACK');
    const permissions = (
      await runtime.query(
        "SELECT has_schema_privilege(current_user,'public','CREATE') AS ddl,has_table_privilege(current_user,'public.sb_migrations','UPDATE') AS migration_write",
      )
    ).rows[0];
    if (permissions.ddl || permissions.migration_write)
      throw new Error('Restored runtime role has excessive privileges.');
  } finally {
    await runtime.end();
  }
  console.log(
    JSON.stringify({
      event: 'recovery.drill.passed',
      backupId: report.backupId,
      elapsedMs: Date.now() - started,
      checks: [
        'backup-integrity',
        'migration-compatibility',
        'snapshot-row-inventory',
        'runtime-read-write',
        'no-runtime-ddl-or-migration-write',
      ],
    }),
  );
}
