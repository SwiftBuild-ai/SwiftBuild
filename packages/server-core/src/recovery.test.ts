import { describe, it, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations } from './migrate';
import {
  backupDatabase,
  verifyBackup,
  restoreDatabase,
  restoreTarget,
  RECOVERY_TABLES,
} from './recovery';

async function fixture(
  run: (directory: string, manifest: Record<string, unknown>) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'swiftbuild-recovery-'));
  const body = Buffer.from('trusted-test-dump');
  const manifest = {
    format: 'swiftbuild-database-backup',
    version: '1.0',
    id: randomUUID(),
    snapshotAt: '2026-10-13T00:00:00Z',
    createdAt: '2026-10-13T00:00:01Z',
    database: 'swiftbuild',
    serverVersion: 180000,
    dumpVersion: 'pg_dump 18',
    release: 'test',
    file: 'database.dump',
    bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    migrations: migrations.map((m) => ({
      id: m.id,
      checksum: createHash('sha256').update(m.sql).digest('hex'),
    })),
    rows: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, '0'])),
  };
  await writeFile(join(directory, 'database.dump'), body);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  try {
    await run(directory, manifest);
  } finally {
    await unlink(join(directory, 'database.dump')).catch(() => {});
    await unlink(join(directory, 'manifest.json')).catch(() => {});
    await rmdir(directory);
  }
}
describe('operator recovery integrity and target safety', () => {
  it('verifies a complete artifact without database access', async () =>
    fixture(async (directory, manifest) => {
      expect(await verifyBackup(directory)).toEqual(manifest);
    }));
  it('rejects modified or truncated dump bytes', async () =>
    fixture(async (directory) => {
      const path = join(directory, 'database.dump'),
        original = await readFile(path);
      original[0] = original[0]! ^ 1;
      await writeFile(path, original);
      await expect(verifyBackup(directory)).rejects.toThrow('integrity');
      await writeFile(path, '');
      await expect(verifyBackup(directory)).rejects.toThrow('integrity');
    }));
  it('rejects unsupported versions, path traversal, migration drift and missing inventory tables', async () =>
    fixture(async (directory, manifest) => {
      for (const patch of [
        { version: '2.0' },
        { file: '../database.dump' },
        { migrations: [] },
        { rows: { sb_projects: '0' } },
      ]) {
        await writeFile(
          join(directory, 'manifest.json'),
          JSON.stringify({ ...manifest, ...patch }),
        );
        await expect(verifyBackup(directory)).rejects.toThrow();
      }
      await writeFile(join(directory, 'manifest.json'), ' '.repeat(65537));
      await expect(verifyBackup(directory)).rejects.toThrow(
        'bounded regular file',
      );
    }));
  it('rejects unsafe restore targets and corruption before connecting', async () =>
    fixture(async (directory) => {
      for (const name of [
        'swiftbuild',
        'production_test',
        'swiftbuild_restore_x_test;DROP DATABASE swiftbuild',
        'swiftbuild_restore_' + 'a'.repeat(36) + '_test',
      ])
        expect(() => restoreTarget(name)).toThrow();
      expect(restoreTarget('swiftbuild_restore_drill_test')).toBe(
        'swiftbuild_restore_drill_test',
      );
      await expect(
        restoreDatabase('invalid', directory, 'swiftbuild'),
      ).rejects.toThrow('Recovery drills');
      await writeFile(join(directory, 'database.dump'), 'damaged');
      await expect(
        restoreDatabase('invalid', directory, 'swiftbuild_restore_drill_test'),
      ).rejects.toThrow('integrity');
    }));
  it('never overwrites an existing backup directory', async () =>
    fixture(async (directory, manifest) => {
      await expect(backupDatabase('invalid', directory)).rejects.toThrow();
      expect(await verifyBackup(directory)).toEqual(manifest);
    }));
});
