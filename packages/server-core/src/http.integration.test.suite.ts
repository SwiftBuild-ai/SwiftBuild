import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { blankDocument, sampleDocument } from '@swiftbuild/components-core';
import { workspaceFor } from '@swiftbuild/project-format';
import {
  createIdentity,
  issueInvitation,
  migrate,
  createApi,
  createProjectStore,
  boundedJson,
} from './index';
const database = process.env.SWIFTBUILD_TEST_DATABASE_URL;
const base = 'http://localhost:3300';
const config = { url: base, secret: 's'.repeat(64), allowLocalHttp: true };
const password = 'swiftbuild-test-password!';
describe.skipIf(!database)('authenticated project HTTP boundary', () => {
  let admin: Pool;
  let pool: Pool;
  let identity: ReturnType<typeof createIdentity>;
  let api: ReturnType<typeof createApi>;
  let ownerCookie: string;
  let ownerId: string;
  let workspaceId: string;
  const schema = 'swiftbuild_test_' + randomUUID().replaceAll('-', '');
  const options = {
    connectionString: database,
    options: `-c search_path=${schema}`,
    max: 6,
  };
  const rebuild = () => {
    identity = createIdentity(pool, config);
    api = createApi({
      pool,
      identity,
      projects: createProjectStore(pool),
      origin: base,
      oidc: false,
    });
  };
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    cookie = ownerCookie,
    headers: Record<string, string> = {},
  ) =>
    api(
      new Request(base + '/api/v1/' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: base,
          cookie,
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  async function enroll(email: string, token: string) {
    const registered = await identity.handler(
      new Request(base + '/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: base,
          'x-swiftbuild-invitation': token,
        },
        body: JSON.stringify({ name: 'Engineer', email, password }),
      }),
    );
    expect(registered.status).toBe(200);
    const response = await identity.handler(
      new Request(base + '/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; ');
  }
  beforeAll(async () => {
    admin = new Pool({ connectionString: database });
    if (
      !(
        await admin.query('SELECT current_database() AS name')
      ).rows[0].name.endsWith('_test')
    )
      throw new Error('Isolated test database required.');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool(options);
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE sb_jobs,sb_job_attempts,sb_worker_heartbeats,sb_auth_users,sb_auth_sessions,sb_auth_accounts,sb_auth_verifications,sb_auth_limits,sb_admitted_users,sb_invitations,sb_instance,sb_workspaces,sb_members,sb_projects,sb_revisions,sb_audit_events',
    );
    rebuild();
    const invite = await issueInvitation(pool, 'owner@example.test', {
      bootstrap: true,
    });
    ownerCookie = await enroll(invite.email, invite.token);
    ownerId = (await identity.session(new Headers({ cookie: ownerCookie })))!
      .user.id;
    workspaceId = (await createProjectStore(pool).listWorkspaces(ownerId))[0]!
      .id;
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (/^swiftbuild_test_[a-f0-9]{32}$/.test(schema))
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
  async function create() {
    const archive = workspaceFor(blankDocument());
    const response = await request('projects', 'POST', {
      workspaceId,
      operationId: randomUUID(),
      archive,
    });
    expect(response.status).toBe(201);
    return { project: await response.json(), archive };
  }
  it('creates, saves, reconnects and reopens a project with immutable revisions and ETags', async () => {
    const { project, archive } = await create();
    const changed = structuredClone(archive);
    changed.document.architecture.name = 'Saved architecture';
    const operationId = randomUUID();
    const saved = await request(
      'projects/' + project.id,
      'PUT',
      { archive: changed, operationId },
      ownerCookie,
      { 'if-match': '"1"' },
    );
    expect(saved.status).toBe(200);
    expect(saved.headers.get('etag')).toBe('"2"');
    expect(
      (
        await request(
          'projects/' + project.id,
          'PUT',
          { archive: changed, operationId },
          ownerCookie,
          { 'if-match': '"1"' },
        )
      ).status,
    ).toBe(200);
    await pool.end();
    pool = new Pool(options);
    rebuild();
    const reopened = await request('projects/' + project.id);
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).archive).toEqual(changed);
    expect(
      (await (await request('projects/' + project.id + '?revision=1')).json())
        .archive,
    ).toEqual(archive);
    expect(
      (
        await (await request('projects/' + project.id + '/revisions')).json()
      ).items.map((r: { revision: number }) => r.revision),
    ).toEqual([2, 1]);
    const exported = await request('projects/' + project.id + '/export');
    expect(await exported.json()).toEqual(changed);
    expect(exported.headers.get('content-disposition')).toContain(project.id);
  });
  it('rejects missing/stale revisions, invalid archives, forged actors and untrusted origins without overwriting work', async () => {
    const { project, archive } = await create();
    expect(
      (
        await request('projects/' + project.id, 'PUT', {
          archive,
          operationId: randomUUID(),
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await request(
          'projects/' + project.id,
          'PUT',
          { archive, operationId: randomUUID() },
          ownerCookie,
          { 'if-match': '"2"' },
        )
      ).status,
    ).toBe(412);
    expect(
      (
        await request(
          'projects/' + project.id,
          'PUT',
          {
            archive: { ...archive, archiveVersion: '2.0' },
            operationId: randomUUID(),
          },
          ownerCookie,
          { 'if-match': '"1"' },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request('projects', 'POST', {
          workspaceId,
          operationId: randomUUID(),
          archive,
          userId: 'forged',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          'projects',
          'POST',
          { workspaceId, operationId: randomUUID(), archive },
          ownerCookie,
          { origin: 'https://other.example.test' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await (await request('projects/' + project.id)).json()).revision,
    ).toBe(1);
    expect(
      (await request('projects/' + project.id, 'GET', undefined, '')).status,
    ).toBe(401);
  });
  it('enforces viewer read-only access, cross-workspace isolation and disabled admission at the storage transaction', async () => {
    const { project, archive } = await create();
    const invite = await issueInvitation(pool, 'viewer@example.test', {
      workspaceId,
      role: 'viewer',
    });
    const cookie = await enroll(invite.email, invite.token);
    expect(
      (await request('projects/' + project.id, 'GET', undefined, cookie))
        .status,
    ).toBe(200);
    expect(
      (
        await request(
          'projects/' + project.id,
          'PUT',
          { archive, operationId: randomUUID() },
          cookie,
          { 'if-match': '"1"' },
        )
      ).status,
    ).toBe(403);
    const privateWorkspace = await createProjectStore(pool).createWorkspace(
      ownerId,
      'Private',
    );
    const privateProject = await createProjectStore(pool).createProject(
      ownerId,
      privateWorkspace.id,
      archive,
      randomUUID(),
    );
    expect(
      (await request('projects/' + privateProject.id, 'GET', undefined, cookie))
        .status,
    ).toBe(404);
    await pool.query(
      'UPDATE sb_admitted_users SET active=false WHERE user_id=$1',
      [ownerId],
    );
    await expect(
      createProjectStore(pool).saveProject(
        ownerId,
        project.id,
        1,
        archive,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect((await request('projects/' + project.id)).status).toBe(401);
  });
  it('paginates project metadata without losing timestamp precision and reports migration readiness', async () => {
    const store = createProjectStore(pool);
    const archive = workspaceFor(blankDocument());
    for (let i = 0; i < 101; i++)
      await store.createProject(ownerId, workspaceId, archive, randomUUID());
    const first = await (
      await request('projects?workspaceId=' + workspaceId)
    ).json();
    expect(first.items).toHaveLength(100);
    const last = first.nextCursor;
    const next = await (
      await request(
        'projects?workspaceId=' +
          workspaceId +
          '&afterId=' +
          last.id +
          '&beforeUpdatedAt=' +
          encodeURIComponent(last.updatedAt),
      )
    ).json();
    expect(next.items).toHaveLength(1);
    expect(
      new Set(
        [...first.items, ...next.items].map((item: { id: string }) => item.id),
      ).size,
    ).toBe(101);
    expect((await request('ready', 'GET', undefined, '')).status).toBe(200);
  });
  it('enforces actual streamed byte limits, valid JSON and content types', async () => {
    await expect(
      boundedJson(
        new Request(base, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': '0',
          },
          body: 'x'.repeat(200),
        }),
        100,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      boundedJson(
        new Request(base, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: '{}',
        }),
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      boundedJson(
        new Request(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{bad',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('authenticates engineering job endpoints and preserves idempotent submission and cancellation', async () => {
    const d = sampleDocument();
    const p = await (
      await request('projects', 'POST', {
        workspaceId,
        operationId: randomUUID(),
        archive: workspaceFor(d),
      })
    ).json();
    const node = d.nodes[0]!.id;
    const body = {
      operationId: randomUUID(),
      input: {
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
                  context: 'HTTP test',
                  recordedAt: '2026-10-13T00:00:00Z',
                },
              },
            ],
            groups: [],
            gates: [],
            root: node,
          },
          ranges: [],
        },
      },
    };
    const path = `projects/${p.id}/jobs`;
    expect((await request(path, 'POST', body, ownerCookie)).status).toBe(428);
    expect(
      (await request(path, 'POST', body, '', { 'if-match': '"1"' })).status,
    ).toBe(401);
    const response = await request(path, 'POST', body, ownerCookie, {
      'if-match': '"1"',
    });
    expect(response.status).toBe(202);
    const job = await response.json();
    expect(
      (
        await (
          await request(path, 'POST', body, ownerCookie, { 'if-match': '"1"' })
        ).json()
      ).id,
    ).toBe(job.id);
    expect(
      (await (await request(`${path}/${job.id}/export`)).json()).format,
    ).toBe('swiftbuild-analysis');
    expect((await request(`${path}/${job.id}/cancel`, 'POST')).status).toBe(
      200,
    );
    expect((await (await request(`${path}/${job.id}`)).json()).state).toBe(
      'cancelled',
    );
  });
});
