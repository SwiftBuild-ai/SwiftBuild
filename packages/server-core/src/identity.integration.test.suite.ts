import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  issueInvitation,
  migrate,
  createProjectStore,
} from './index';
const url = process.env.SWIFTBUILD_TEST_DATABASE_URL;
const base = 'http://localhost:3300';
const config = { url: base, secret: 's'.repeat(64), allowLocalHttp: true };
const password = 'swiftbuild-test-password!';
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((s) => s.split(';')[0])
    .join('; ');
describe.skipIf(!url)(
  'invite-only server identity against a real test database',
  () => {
    let pool: Pool;
    let admin: Pool;
    let identity: ReturnType<typeof createIdentity>;
    const schema = 'swiftbuild_test_' + randomUUID().replaceAll('-', '');
    const call = (
      path: string,
      body?: object,
      extra: Record<string, string> = {},
    ) =>
      identity.handler(
        new Request(base + '/api/auth' + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            'content-type': 'application/json',
            origin: base,
            ...extra,
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    beforeAll(async () => {
      admin = new Pool({ connectionString: url });
      if (
        !(
          await admin.query('SELECT current_database() AS name')
        ).rows[0].name.endsWith('_test')
      )
        throw new Error('An isolated _test database is required.');
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new Pool({
        connectionString: url,
        options: `-c search_path=${schema}`,
        max: 6,
      });
      await migrate(pool);
    });
    beforeEach(async () => {
      await pool.query(
        'TRUNCATE sb_jobs, sb_job_attempts, sb_worker_heartbeats, sb_auth_users, sb_auth_sessions, sb_auth_accounts, sb_auth_verifications, sb_auth_limits, sb_admitted_users, sb_invitations, sb_instance, sb_workspaces, sb_members, sb_projects, sb_revisions, sb_audit_events',
      );
      identity = createIdentity(pool, config);
    });
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        if (/^swiftbuild_test_[a-f0-9]{32}$/.test(schema))
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
      }
    });
    async function signup(email: string, token: string) {
      return call(
        '/sign-up/email',
        { name: 'Engineer', email, password },
        { 'x-swiftbuild-invitation': token },
      );
    }
    async function bootstrap() {
      const invite = await issueInvitation(pool, 'owner@example.test', {
        bootstrap: true,
      });
      const registered = await signup(invite.email, invite.token);
      expect(registered.status).toBe(200);
      const loggedIn = await call('/sign-in/email', {
        email: invite.email,
        password,
      });
      expect(loggedIn.status).toBe(200);
      return { invite, headers: new Headers({ cookie: cookies(loggedIn) }) };
    }
    it('blocks open registration, token email substitution and expired/revoked invites', async () => {
      expect(
        (
          await call('/sign-up/email', {
            name: 'Engineer',
            email: 'outsider@example.test',
            password,
          })
        ).status,
      ).toBe(403);
      const invite = await issueInvitation(pool, 'owner@example.test', {
        bootstrap: true,
      });
      expect((await signup('other@example.test', invite.token)).status).toBe(
        403,
      );
      await pool.query(
        "UPDATE sb_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
        [invite.id],
      );
      expect((await signup(invite.email, invite.token)).status).toBe(403);
      expect(
        (await pool.query('SELECT id FROM sb_auth_users')).rows,
      ).toHaveLength(0);
    });
    it('bootstraps through a one-time invitation and creates secure database-backed sessions', async () => {
      const { invite, headers } = await bootstrap();
      const session = await identity.session(headers);
      expect(session?.user.email).toBe(invite.email);
      expect(
        (await pool.query('SELECT administrator FROM sb_admitted_users'))
          .rows[0].administrator,
      ).toBe(true);
      expect(
        (await pool.query('SELECT role FROM sb_members')).rows[0].role,
      ).toBe('owner');
      expect(
        (await pool.query('SELECT token_hash FROM sb_invitations')).rows[0]
          .token_hash,
      ).not.toBe(invite.token);
      const credential = (
        await pool.query('SELECT password FROM sb_auth_accounts')
      ).rows[0].password;
      expect(credential).not.toBe(password);
      await expect(
        issueInvitation(pool, 'second@example.test', { bootstrap: true }),
      ).rejects.toThrow('already bootstrapped');
      expect((await signup(invite.email, invite.token)).status).toBe(403);
      const loggedIn = await call('/sign-in/email', {
        email: invite.email,
        password,
      });
      expect(loggedIn.headers.getSetCookie().join(';')).toContain('HttpOnly');
      expect(loggedIn.headers.getSetCookie().join(';')).toContain(
        'SameSite=Lax',
      );
      expect(
        await createIdentity(pool, config).session(headers),
      ).not.toBeNull();
      await pool.query('UPDATE sb_admitted_users SET active=false');
      expect(await identity.session(headers)).toBeNull();
      expect(
        (await call('/sign-in/email', { email: invite.email, password }))
          .status,
      ).toBe(401);
    });
    it('admits invited members with the stored role and rejects reused invitation claims', async () => {
      const owner = await bootstrap();
      const session = await identity.session(owner.headers);
      const workspace = await createProjectStore(pool).createWorkspace(
        session!.user.id,
        'Team',
      );
      const invite = await issueInvitation(pool, 'reader@example.test', {
        workspaceId: workspace.id,
        role: 'viewer',
      });
      expect((await signup(invite.email, invite.token)).status).toBe(200);
      const member = await call('/sign-in/email', {
        email: invite.email,
        password,
      });
      const headers = new Headers({ cookie: cookies(member) });
      const user = await identity.session(headers);
      expect(
        (
          await pool.query(
            'SELECT role FROM sb_members WHERE workspace_id=$1 AND user_id=$2',
            [workspace.id, user!.user.id],
          )
        ).rows[0].role,
      ).toBe('viewer');
      await expect(
        identity.acceptInvitation(headers, invite.token),
      ).rejects.toThrow('already used');
      expect(
        await createProjectStore(pool).listProjects(
          user!.user.id,
          workspace.id,
        ),
      ).toEqual([]);
    });
    it('requires an authenticated matching identity to accept an additional workspace invite', async () => {
      const owner = await bootstrap();
      const session = await identity.session(owner.headers);
      const workspace = await createProjectStore(pool).createWorkspace(
        session!.user.id,
        'Additional',
      );
      const invite = await issueInvitation(pool, session!.user.email, {
        workspaceId: workspace.id,
        role: 'editor',
      });
      await expect(
        identity.acceptInvitation(new Headers(), invite.token),
      ).rejects.toThrow('Sign in');
      await identity.acceptInvitation(owner.headers, invite.token);
      expect(
        (
          await pool.query('SELECT used_by FROM sb_invitations WHERE id=$1', [
            invite.id,
          ])
        ).rows[0].used_by,
      ).toBe(session!.user.id);
    });
    it('issues operator recovery links without mail and revokes old sessions after reset', async () => {
      const { headers } = await bootstrap();
      let recovery = '';
      const operator = createIdentity(pool, {
        ...config,
        deliverRecovery: async (link) => {
          recovery = link;
        },
      });
      await operator.auth.api.requestPasswordReset({
        body: {
          email: 'owner@example.test',
          redirectTo: base + '/reset-password',
        },
      });
      expect(recovery.startsWith(base)).toBe(true);
      const link = await operator.handler(new Request(recovery));
      expect(link.status).toBe(302);
      expect(new URL(link.headers.get('location')!).pathname).toBe(
        '/reset-password',
      );
      const token = new URL(link.headers.get('location')!).searchParams.get(
        'token',
      )!;
      const reset = await operator.handler(
        new Request(base + '/api/auth/reset-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: base },
          body: JSON.stringify({ token, newPassword: password + 'new' }),
        }),
      );
      expect(reset.status).toBe(200);
      expect(await operator.session(headers)).toBeNull();
      expect(
        (
          await call('/sign-in/email', {
            email: 'owner@example.test',
            password: password + 'new',
          })
        ).status,
      ).toBe(200);
      expect(
        (await call('/request-password-reset', { email: 'owner@example.test' }))
          .status,
      ).toBe(404);
    });
    it('rejects insecure remote identity URLs, short secrets, cross-origin requests and brute-force attempts', async () => {
      expect(() =>
        createIdentity(pool, { ...config, url: 'http://remote.example.test' }),
      ).toThrow('HTTPS');
      expect(() =>
        createIdentity(pool, { ...config, secret: 'short' }),
      ).toThrow('32');
      expect(() =>
        createIdentity(pool, {
          ...config,
          oidc: {
            discoveryUrl: 'http://remote.example.test/discovery',
            clientId: 'test',
            clientSecret: 'test',
          },
        }),
      ).toThrow('HTTPS');
      const { invite } = await bootstrap();
      expect(
        (
          await call(
            '/sign-in/email',
            { email: invite.email, password },
            { origin: 'https://untrusted.example.test' },
          )
        ).status,
      ).toBe(403);
      const attempts = [];
      for (let i = 0; i < 7; i++)
        attempts.push(
          (
            await call('/sign-in/email', {
              email: invite.email,
              password: 'incorrect',
            })
          ).status,
        );
      expect(attempts).toContain(429);
      const oversized = await call('/sign-up/email', {
        name: 'x'.repeat(17000),
        email: 'oversized@example.test',
        password,
      });
      expect(oversized.status).toBe(413);
    });
  },
);
