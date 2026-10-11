import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { initialProjects } from './migrations/0001-projects';
export type Migration = { id: string; sql: string };
export const migrations: readonly Migration[] = [initialProjects];

export async function transaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

/** Execute only maintainer-owned migrations, never uploaded SQL. */
export async function migrate(
  pool: Pool,
  plan: readonly Migration[] = migrations,
): Promise<void> {
  const ids = plan.map((m) => m.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some(
      (id, i) => !/^\d{4}-[a-z0-9-]+$/.test(id) || (i > 0 && id <= ids[i - 1]!),
    )
  )
    throw new Error('Migration IDs must be unique and ordered.');
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [1398233414]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS sb_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await client.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM sb_migrations ORDER BY id',
    );
    for (const [i, row] of applied.rows.entries()) {
      const expected = plan[i];
      if (
        !expected ||
        row.id !== expected.id ||
        row.checksum !== createHash('sha256').update(expected.sql).digest('hex')
      )
        throw new Error(
          'Applied migrations do not match this server version. Restore the matching release; do not edit migration history.',
        );
    }
    for (const m of plan.slice(applied.rows.length)) {
      await client.query(m.sql);
      await client.query(
        'INSERT INTO sb_migrations (id, checksum) VALUES ($1, $2)',
        [m.id, createHash('sha256').update(m.sql).digest('hex')],
      );
    }
  });
}
