import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  issueInvitation,
  rotateBootstrapInvitation,
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
    it('delivers a replacement only through the private operator CLI', async () => {
      const original = await issueInvitation(pool, 'owner@example.test', {
        bootstrap: true,
      });
      const database = new URL(url!);
      database.searchParams.set('options', `-c search_path=${schema}`);
      const result = await promisify(execFile)(
        process.execPath,
        [
          '--import',
          pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
          fileURLToPath(new URL('./cli.ts', import.meta.url)),
          'bootstrap-rotate',
          '--email',
          original.email,
        ],
        {
          env: {
            ...process.env,
            DATABASE_URL: database.toString(),
            SWIFTBUILD_URL: base,
            SWIFTBUILD_AUTH_SECRET: config.secret,
            SWIFTBUILD_ALLOW_LOCAL_HTTP: '1',
          },
        },
      );
      const link = new URL(result.stdout.trim());
      expect(link.origin).toBe(base);
      expect(link.pathname).toBe('/invite');
      expect(link.searchParams.get('email')).toBe(original.email);
      expect(link.searchParams.get('token')).toHaveLength(43);
      expect(result.stderr).toBe('');
      expect((await signup(original.email, original.token)).status).toBe(403);
      expect(
        (await signup(original.email, link.searchParams.get('token')!)).status,
      ).toBe(200);
    });
    it('rotates expired or lost bootstrap links and refuses rotation after consumption', async () => {
      await expect(
        rotateBootstrapInvitation(pool, 'owner@example.test'),
      ).rejects.toThrow('initial bootstrap');
      const original = await issueInvitation(pool, 'owner@example.test', {
        bootstrap: true,
      });
      await pool.query(
        "UPDATE sb_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
        [original.id],
      );
      const replacement = await rotateBootstrapInvitation(pool, original.email);
      const newest = await rotateBootstrapInvitation(pool, original.email);
      expect((await signup(original.email, original.token)).status).toBe(403);
      expect((await signup(replacement.email, replacement.token)).status).toBe(
        403,
      );
      expect((await signup(newest.email, newest.token)).status).toBe(200);
      expect(
        (
          await pool.query(
            'SELECT user_id FROM sb_admitted_users WHERE administrator',
          )
        ).rowCount,
      ).toBe(1);
      await pool.query(
        'UPDATE sb_admitted_users SET active=false,administrator=false',
      );
      await expect(
        rotateBootstrapInvitation(pool, 'other@example.test'),
      ).rejects.toThrow('admission is complete');
      const stored = (
        await pool.query(
          'SELECT token_hash,revoked FROM sb_invitations WHERE id=$1',
          [newest.id],
        )
      ).rows[0];
      expect(stored.token_hash).not.toBe(newest.token);
    });
    it('serializes competing rotations so exactly one replacement remains eligible', async () => {
      await issueInvitation(pool, 'owner@example.test', { bootstrap: true });
      const links = await Promise.all([
        rotateBootstrapInvitation(pool, 'owner@example.test'),
        rotateBootstrapInvitation(pool, 'owner@example.test'),
      ]);
      const live = (
        await pool.query(
          'SELECT id FROM sb_invitations WHERE bootstrap AND NOT revoked AND used_by IS NULL',
        )
      ).rows;
      expect(live).toHaveLength(1);
      const winner = links.find((link) => link.id === live[0].id)!;
      const loser = links.find((link) => link.id !== live[0].id)!;
      expect((await signup(loser.email, loser.token)).status).toBe(403);
      expect((await signup(winner.email, winner.token)).status).toBe(200);
      await expect(
        rotateBootstrapInvitation(pool, winner.email),
      ).rejects.toThrow('admission is complete');
    });
    it('fences admission racing bootstrap rotation with the same advisory lock', async () => {
      const original = await issueInvitation(pool, 'owner@example.test', {
        bootstrap: true,
      });
      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock($1)', [1398233415]);
      const rotation = rotateBootstrapInvitation(pool, original.email);
      const admission = signup(original.email, original.token);
      // Both can pass preliminary checks while the authoritative admission transaction is blocked.
      try {
        for (let n = 0; n < 100; n++) {
          const waiting = await pool.query(
            "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted",
            [1398233415],
          );
          if (waiting.rows[0].n >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        await blocker.query('COMMIT');
        blocker.release();
      }
      const [rotated, admitted] = await Promise.allSettled([
        rotation,
        admission,
      ]);
      if (rotated.status === 'fulfilled') {
        expect(admitted.status === 'fulfilled' && admitted.value.status).toBe(
          403,
        );
        expect(
          (
            await pool.query(
              'SELECT user_id FROM sb_admitted_users WHERE administrator',
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await pool.query('SELECT revoked FROM sb_invitations WHERE id=$1', [
              original.id,
            ])
          ).rows[0].revoked,
        ).toBe(true);
      } else {
        expect(admitted.status === 'fulfilled' && admitted.value.status).toBe(
          200,
        );
        expect(
          (
            await pool.query(
              'SELECT user_id FROM sb_admitted_users WHERE administrator',
            )
          ).rowCount,
        ).toBe(1);
      }
    });
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
