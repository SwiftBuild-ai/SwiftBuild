import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { blankDocument } from '@swiftbuild/components-core';
import { workspaceFor } from '@swiftbuild/project-format';
import { migrate, migrations, createProjectStore } from './index';

const url = process.env.SWIFTBUILD_TEST_DATABASE_URL;
// Local unit-only runs report these as skipped. CI supplies an isolated real database.
describe.skipIf(!url)(
  'transactional server projects against a real test database',
  () => {
    let pool: Pool;
    let admin: Pool;
    const schema = 'swiftbuild_test_' + randomUUID().replaceAll('-', '');
    const options = {
      connectionString: url,
      options: `-c search_path=${schema}`,
      max: 4,
    };
    const archive = () => {
      const result = workspaceFor(blankDocument());
      result.document.metadata = { provenance: { retained: true } };
      result.checkpoints.push({
        id: 'checkpoint',
        name: 'Before',
        createdAt: '2026-10-12T00:00:00Z',
        document: structuredClone(result.document),
      });
      return result;
    };
    beforeAll(async () => {
      admin = new Pool({ connectionString: url });
      const db = await admin.query<{ name: string }>(
        'SELECT current_database() AS name',
      );
      if (!db.rows[0]?.name.endsWith('_test'))
        throw new Error(
          'Integration tests require a dedicated database name ending in _test.',
        );
      if (!/^swiftbuild_test_[a-f0-9]{32}$/.test(schema))
        throw new Error('Invalid test schema.');
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new Pool(options);
      await Promise.all([migrate(pool), migrate(pool)]);
    });
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        if (/^swiftbuild_test_[a-f0-9]{32}$/.test(schema))
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
      }
    });
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO sb_auth_users (id,name,email,"emailVerified") SELECT label,label,label||'@example.test',false FROM unnest(ARRAY['owner','reader','writer','outsider']) label ON CONFLICT (id) DO NOTHING`,
      );
      await pool.query(
        'INSERT INTO sb_admitted_users (user_id) SELECT id FROM sb_auth_users ON CONFLICT (user_id) DO UPDATE SET active=true',
      );
      await pool.query(
        'TRUNCATE sb_jobs, sb_job_attempts, sb_worker_heartbeats, sb_audit_events, sb_revisions, sb_projects, sb_members, sb_invitations, sb_workspaces',
      );
    });

    it('retains archives, checkpoint bodies and native identities after reconnecting the server pool', async () => {
      const store = createProjectStore(pool);
      const workspace = await store.createWorkspace('owner', 'Engineering');
      const original = archive();
      const project = await store.createProject(
        'owner',
        workspace.id,
        original,
        randomUUID(),
      );
      await pool.end();
      pool = new Pool(options);
      const reopened = await createProjectStore(pool).readProject(
        'owner',
        project.id,
      );
      expect(reopened.revision).toBe(1);
      expect(reopened.archive).toEqual(original);
      expect(reopened.archive.document.project.id).toBe(
        original.document.project.id,
      );
      expect(reopened.id).not.toBe(original.document.project.id);
    });

    it('allows exactly one concurrent writer for a revision and keeps the original immutable', async () => {
      const store = createProjectStore(pool);
      const workspace = await store.createWorkspace('owner', 'Engineering');
      const original = archive();
      const project = await store.createProject(
        'owner',
        workspace.id,
        original,
        randomUUID(),
      );
      const first = structuredClone(original);
      first.document.architecture.name = 'First';
      const second = structuredClone(original);
      second.document.architecture.name = 'Second';
      const results = await Promise.allSettled([
        store.saveProject('owner', project.id, 1, first, randomUUID()),
        store.saveProject('owner', project.id, 1, second, randomUUID()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected');
      expect(
        failed && failed.status === 'rejected' && failed.reason.status,
      ).toBe(409);
      expect((await store.readProject('owner', project.id)).revision).toBe(2);
      expect((await store.readProject('owner', project.id, 1)).archive).toEqual(
        original,
      );
      expect(
        (await store.listRevisions('owner', project.id)).map((r) => r.revision),
      ).toEqual([2, 1]);
    });

    it('enforces viewer/editor boundaries, workspace isolation and revoked membership', async () => {
      const store = createProjectStore(pool);
      const workspace = await store.createWorkspace('owner', 'Engineering');
      const project = await store.createProject(
        'owner',
        workspace.id,
        archive(),
        randomUUID(),
      );
      await pool.query(
        "INSERT INTO sb_members VALUES ($1,'reader','viewer'),($1,'writer','editor')",
        [workspace.id],
      );
      expect((await store.readProject('reader', project.id)).revision).toBe(1);
      await expect(
        store.saveProject('reader', project.id, 1, archive(), randomUUID()),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        store.readProject('outsider', project.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        store.listProjects('outsider', workspace.id),
      ).rejects.toMatchObject({ status: 404 });
      const next = structuredClone(project.archive);
      next.document.architecture.name = 'Changed';
      await store.saveProject('writer', project.id, 1, next, randomUUID());
      await pool.query(
        "DELETE FROM sb_members WHERE workspace_id=$1 AND user_id='writer'",
        [workspace.id],
      );
      await expect(
        store.readProject('writer', project.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        store.saveProject('writer', project.id, 2, next, randomUUID()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('makes retried creation and save requests idempotent without permitting key reuse', async () => {
      const store = createProjectStore(pool);
      const workspace = await store.createWorkspace('owner', 'Engineering');
      const original = archive();
      const createKey = randomUUID();
      const project = await store.createProject(
        'owner',
        workspace.id,
        original,
        createKey,
      );
      expect(
        (await store.createProject('owner', workspace.id, original, createKey))
          .id,
      ).toBe(project.id);
      const changed = structuredClone(original);
      changed.document.architecture.name = 'Changed';
      await expect(
        store.createProject('owner', workspace.id, changed, createKey),
      ).rejects.toMatchObject({ status: 409 });
      const saveKey = randomUUID();
      await store.saveProject('owner', project.id, 1, changed, saveKey);
      expect(
        (await store.saveProject('owner', project.id, 1, changed, saveKey))
          .revision,
      ).toBe(2);
      await expect(
        store.saveProject('owner', project.id, 2, original, saveKey),
      ).rejects.toMatchObject({ status: 409 });
      expect(await store.listProjects('owner', workspace.id)).toHaveLength(1);
      expect(await store.listRevisions('owner', project.id)).toHaveLength(2);
    });

    it('preserves current work after invalid saves and ignores export-timestamp-only autosaves', async () => {
      const store = createProjectStore(pool);
      const workspace = await store.createWorkspace('owner', 'Engineering');
      const original = archive();
      const project = await store.createProject(
        'owner',
        workspace.id,
        original,
        randomUUID(),
      );
      await expect(
        store.saveProject(
          'owner',
          project.id,
          1,
          { ...original, archiveVersion: '2.0' },
          randomUUID(),
        ),
      ).rejects.toThrow();
      await store.saveProject(
        'owner',
        project.id,
        1,
        { ...original, exportedAt: '2026-10-13T00:00:00Z' },
        randomUUID(),
      );
      expect(await store.listRevisions('owner', project.id)).toHaveLength(1);
      expect((await store.readProject('owner', project.id)).archive).toEqual(
        original,
      );
    });

    it('rolls back the document and revision if durable audit insertion fails', async () => {
      const store = createProjectStore(pool);
      const workspace = await store.createWorkspace('owner', 'Engineering');
      const original = archive();
      const project = await store.createProject(
        'owner',
        workspace.id,
        original,
        randomUUID(),
      );
      await pool.query(
        "CREATE FUNCTION sb_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit interruption'; END $$; CREATE TRIGGER sb_reject_audit BEFORE INSERT ON sb_audit_events FOR EACH ROW EXECUTE FUNCTION sb_reject_audit()",
      );
      try {
        const changed = structuredClone(original);
        changed.document.architecture.name = 'Interrupted';
        await expect(
          store.saveProject('owner', project.id, 1, changed, randomUUID()),
        ).rejects.toThrow('test audit interruption');
        expect((await store.readProject('owner', project.id)).archive).toEqual(
          original,
        );
        expect(await store.listRevisions('owner', project.id)).toHaveLength(1);
      } finally {
        await pool.query(
          'DROP TRIGGER sb_reject_audit ON sb_audit_events; DROP FUNCTION sb_reject_audit()',
        );
      }
    });

    it('rejects edited migration history and rolls back interrupted schema changes', async () => {
      await expect(
        migrate(pool, [
          { ...migrations[0]!, sql: migrations[0]!.sql + '-- modified' },
        ]),
      ).rejects.toThrow('do not edit migration history');
      await expect(
        migrate(pool, [
          ...migrations,
          {
            id: '0003-interrupted',
            sql: 'CREATE TABLE sb_interrupted (id integer); SELECT 1/0;',
          },
        ]),
      ).rejects.toThrow();
      const state = await pool.query(
        "SELECT to_regclass('sb_interrupted') AS leftover",
      );
      expect(state.rows[0].leftover).toBeNull();
      expect(
        (await pool.query('SELECT id FROM sb_migrations')).rows,
      ).toHaveLength(migrations.length);
    });
  },
);
