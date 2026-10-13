import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createIdentity, issueInvitation, migrate } from './index';
const database = process.env.SWIFTBUILD_TEST_DATABASE_URL;
const base = 'http://localhost:3300';
const cookieHeader = (...responses: Response[]) =>
  responses
    .flatMap((r) => r.headers.getSetCookie().map((s) => s.split(';')[0]))
    .join('; ');
describe.skipIf(!database)('organizational OIDC protocol and admission', () => {
  let pool: Pool;
  let admin: Pool;
  let provider: Server;
  let issuer: string;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let profile = {
    email: 'owner@example.test',
    verified: true,
    audience: 'swiftbuild-test-client',
  };
  let verifiedChallenges = 0;
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const schema = 'swiftbuild_test_' + randomUUID().replaceAll('-', '');
  beforeAll(async () => {
    admin = new Pool({ connectionString: database });
    if (
      !(
        await admin.query('SELECT current_database() AS name')
      ).rows[0].name.endsWith('_test')
    )
      throw new Error('An isolated _test database is required.');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: database,
      options: `-c search_path=${schema}`,
      max: 6,
    });
    await migrate(pool);
    keys = await generateKeyPair('RS256', { extractable: true });
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 'swiftbuild-test-key',
      alg: 'RS256',
      use: 'sig',
    };
    provider = createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, issuer);
        const json = (value: object) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(value));
        };
        if (url.pathname === '/discovery')
          return json({
            issuer,
            authorization_endpoint: issuer + '/authorize',
            token_endpoint: issuer + '/token',
            userinfo_endpoint: issuer + '/userinfo',
            jwks_uri: issuer + '/jwks',
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            token_endpoint_auth_methods_supported: ['client_secret_post'],
            code_challenge_methods_supported: ['S256'],
          });
        if (url.pathname === '/jwks') return json({ keys: [jwk] });
        if (url.pathname === '/authorize') {
          const code = randomUUID();
          codes.set(code, {
            nonce: url.searchParams.get('nonce')!,
            challenge: url.searchParams.get('code_challenge')!,
          });
          const callback = new URL(url.searchParams.get('redirect_uri')!);
          callback.searchParams.set('code', code);
          callback.searchParams.set('state', url.searchParams.get('state')!);
          res.writeHead(302, { location: callback.toString() });
          res.end();
          return;
        }
        if (url.pathname === '/token') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const params = new URLSearchParams(Buffer.concat(chunks).toString());
          const record = codes.get(params.get('code')!);
          codes.delete(params.get('code')!);
          if (
            !record ||
            !record.challenge ||
            createHash('sha256')
              .update(params.get('code_verifier') ?? '')
              .digest('base64url') !== record.challenge
          ) {
            res.statusCode = 400;
            return json({ error: 'invalid_grant' });
          }
          verifiedChallenges++;
          const token = await new SignJWT({
            sub: 'swiftbuild-test-user',
            email: profile.email,
            email_verified: profile.verified,
            name: 'Engineer',
            nonce: record.nonce,
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'swiftbuild-test-key' })
            .setIssuer(issuer)
            .setAudience(profile.audience)
            .setIssuedAt()
            .setExpirationTime('2m')
            .sign(keys.privateKey);
          return json({
            access_token: 'swiftbuild-test-access',
            token_type: 'Bearer',
            expires_in: 120,
            id_token: token,
          });
        }
        if (url.pathname === '/userinfo')
          return json({
            sub: 'swiftbuild-test-user',
            email: profile.email,
            email_verified: profile.verified,
            name: 'Engineer',
          });
        res.statusCode = 404;
        res.end();
      } catch {
        res.statusCode = 500;
        res.end('Fixture failed.');
      }
    });
    await new Promise<void>((resolve, reject) => {
      provider.once('error', reject);
      provider.listen(0, '127.0.0.1', resolve);
    });
    const address = provider.address();
    if (!address || typeof address === 'string')
      throw new Error('Provider fixture did not bind.');
    issuer = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE sb_jobs, sb_job_attempts, sb_worker_heartbeats, sb_auth_users, sb_auth_sessions, sb_auth_accounts, sb_auth_verifications, sb_auth_limits, sb_admitted_users, sb_invitations, sb_instance, sb_workspaces, sb_members, sb_projects, sb_revisions, sb_audit_events',
    );
    profile = {
      email: 'owner@example.test',
      verified: true,
      audience: 'swiftbuild-test-client',
    };
    codes.clear();
    verifiedChallenges = 0;
  });
  afterAll(async () => {
    if (provider)
      await new Promise<void>((resolve, reject) =>
        provider.close((err) => (err ? reject(err) : resolve())),
      );
    await pool?.end();
    if (admin) {
      if (/^swiftbuild_test_[a-f0-9]{32}$/.test(schema))
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
  async function signIn() {
    const identity = createIdentity(pool, {
      url: base,
      secret: 's'.repeat(64),
      allowLocalHttp: true,
      oidc: {
        discoveryUrl: issuer + '/discovery',
        clientId: 'swiftbuild-test-client',
        clientSecret: 'swiftbuild-test-secret',
      },
    });
    const initial = await identity.handler(
      new Request(base + '/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({
          provider: 'organization',
          callbackURL: base + '/projects',
        }),
      }),
    );
    expect(initial.status).toBe(200);
    const data = await initial.json();
    const authorized = await fetch(data.url, { redirect: 'manual' });
    const callback = await identity.handler(
      new Request(authorized.headers.get('location')!, {
        headers: { cookie: cookieHeader(initial) },
      }),
    );
    return { identity, initial, callback };
  }
  it('completes PKCE, state, nonce and signed-token verification before admitting an invited identity', async () => {
    await issueInvitation(pool, profile.email, { bootstrap: true });
    const { identity, initial, callback } = await signIn();
    expect(callback.status).toBe(302);
    const session = await identity.session(
      new Headers({ cookie: cookieHeader(initial, callback) }),
    );
    expect(session?.user.email).toBe(profile.email);
    expect(session?.user.emailVerified).toBe(true);
    expect(verifiedChallenges).toBe(1);
    expect((await pool.query('SELECT role FROM sb_members')).rows[0].role).toBe(
      'owner',
    );
  });
  it('rejects wrong token audience before creating an account or server membership', async () => {
    await issueInvitation(pool, profile.email, { bootstrap: true });
    profile.audience = 'different-client';
    const { identity, initial, callback } = await signIn();
    expect(
      await identity.session(
        new Headers({ cookie: cookieHeader(initial, callback) }),
      ),
    ).toBeNull();
    expect(
      (await pool.query('SELECT id FROM sb_auth_users')).rows,
    ).toHaveLength(0);
    expect(
      (await pool.query('SELECT user_id FROM sb_members')).rows,
    ).toHaveLength(0);
  });
  it('rejects unverified or uninvited organizational identities', async () => {
    await issueInvitation(pool, profile.email, { bootstrap: true });
    profile.verified = false;
    const { identity, initial, callback } = await signIn();
    expect(
      await identity.session(
        new Headers({ cookie: cookieHeader(initial, callback) }),
      ),
    ).toBeNull();
    expect(
      (await pool.query('SELECT id FROM sb_auth_users')).rows,
    ).toHaveLength(0);
    profile.verified = true;
    profile.email = 'uninvited@example.test';
    const next = await signIn();
    expect(
      await next.identity.session(
        new Headers({ cookie: cookieHeader(next.initial, next.callback) }),
      ),
    ).toBeNull();
    expect(
      (await pool.query('SELECT id FROM sb_auth_users')).rows,
    ).toHaveLength(0);
  });
});
