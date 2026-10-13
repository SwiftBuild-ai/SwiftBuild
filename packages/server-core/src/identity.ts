import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { genericOAuth } from 'better-auth/plugins';
import type { Pool } from 'pg';
import { z } from 'zod';
import { transaction } from './migrate';
const emailSchema = z.email().transform((s) => s.toLowerCase());
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const bootstrapLock = 1398233415;
type Invite = {
  id: string;
  email: string;
  workspace_id: string | null;
  role: 'owner' | 'editor' | 'viewer';
  bootstrap: boolean;
};
export type IdentityConfig = {
  url: string;
  secret: string;
  allowLocalHttp?: boolean;
  oidc?: { discoveryUrl: string; clientId: string; clientSecret: string };
  deliverRecovery?: (url: string) => Promise<void>;
};

function configuredUrl(input: string, allowLocalHttp = false) {
  const url = new URL(input);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        allowLocalHttp &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error(
      'Identity URLs require HTTPS; explicit local HTTP is allowed only for loopback development.',
    );
  return url;
}

/** Local operator API only. Do not expose invitation issuance without server authorization. */
export async function issueInvitation(
  pool: Pool,
  email: string,
  options: {
    bootstrap?: boolean;
    rotateBootstrap?: boolean;
    workspaceId?: string;
    role?: Invite['role'];
  } = {},
) {
  const normalized = emailSchema.parse(email);
  const role = z
    .enum(['owner', 'editor', 'viewer'])
    .parse(options.role ?? 'editor');
  if (options.workspaceId) z.uuid().parse(options.workspaceId);
  if (!options.bootstrap && !options.workspaceId)
    throw new Error('A workspace is required.');
  if (options.bootstrap && options.workspaceId)
    throw new Error('Bootstrap cannot target an existing workspace.');
  if (options.rotateBootstrap && !options.bootstrap)
    throw new Error('Rotation applies only to bootstrap invitations.');
  const token = randomBytes(32).toString('base64url');
  const inviteId = randomUUID();
  await transaction(pool, async (client) => {
    if (options.bootstrap) {
      await client.query('SELECT pg_advisory_xact_lock($1)', [bootstrapLock]);
      const issued = (await client.query('SELECT id FROM sb_instance'))
        .rowCount;
      if (options.rotateBootstrap) {
        if (!issued)
          throw new Error(
            'Issue the initial bootstrap invitation before rotating it.',
          );
        if (
          (
            await client.query(
              'SELECT 1 FROM sb_invitations WHERE bootstrap AND used_by IS NOT NULL UNION ALL SELECT 1 FROM sb_admitted_users WHERE administrator LIMIT 1',
            )
          ).rowCount
        )
          throw new Error(
            'Bootstrap admission is complete. Use existing-account operator recovery.',
          );
        await client.query(
          'UPDATE sb_invitations SET revoked=true WHERE bootstrap AND used_by IS NULL AND NOT revoked',
        );
      } else if (issued)
        throw new Error(
          'Instance already bootstrapped. Use an existing administrator or the documented operator recovery flow.',
        );
      if (!issued)
        await client.query('INSERT INTO sb_instance (id) VALUES (1)');
    } else if (
      !(
        await client.query('SELECT id FROM sb_workspaces WHERE id=$1', [
          options.workspaceId,
        ])
      ).rowCount
    )
      throw new Error('Workspace not found.');
    await client.query(
      "INSERT INTO sb_invitations (id,email,token_hash,workspace_id,role,bootstrap,expires_at) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '24 hours')",
      [
        inviteId,
        normalized,
        tokenHash(token),
        options.workspaceId ?? null,
        options.bootstrap ? 'owner' : role,
        !!options.bootstrap,
      ],
    );
  });
  return { id: inviteId, token, email: normalized };
}

/** Private operator action; never expose token issuance through a user-facing route. */
export function rotateBootstrapInvitation(pool: Pool, email: string) {
  return issueInvitation(pool, email, {
    bootstrap: true,
    rotateBootstrap: true,
  });
}

export function createIdentity(pool: Pool, config: IdentityConfig) {
  if (config.secret.length < 32)
    throw new Error(
      'Authentication secret must contain at least 32 characters.',
    );
  const base = configuredUrl(config.url, config.allowLocalHttp);
  if (base.pathname !== '/')
    throw new Error('SwiftBuild identity uses an origin URL without a path.');
  if (config.oidc)
    configuredUrl(config.oidc.discoveryUrl, config.allowLocalHttp);
  const activeUser = async (userId: string) =>
    !!(
      await pool.query(
        'SELECT user_id FROM sb_admitted_users WHERE user_id=$1 AND active=true',
        [userId],
      )
    ).rowCount;
  const invitation = async (
    email: string,
    token?: string,
  ): Promise<Invite | undefined> => {
    if (token !== undefined && !/^[a-zA-Z0-9_-]{43}$/.test(token))
      return undefined;
    const result = await pool.query<Invite>(
      'SELECT id,email,workspace_id,role,bootstrap FROM sb_invitations WHERE email=$1 AND ($2::text IS NULL OR token_hash=$2) AND used_by IS NULL AND NOT revoked AND expires_at>now() ORDER BY expires_at,id LIMIT 1',
      [emailSchema.parse(email), token ? tokenHash(token) : null],
    );
    return result.rows[0];
  };
  async function admit(userId: string, email: string, token?: string) {
    await transaction(pool, async (client) => {
      // Acquire the same lock before invitation row locks, including regular admission.
      await client.query('SELECT pg_advisory_xact_lock($1)', [bootstrapLock]);
      const result = await client.query<Invite>(
        'SELECT id,email,workspace_id,role,bootstrap FROM sb_invitations WHERE email=$1 AND ($2::text IS NULL OR token_hash=$2) AND used_by IS NULL AND NOT revoked AND expires_at>now() ORDER BY expires_at,id LIMIT 1 FOR UPDATE',
        [emailSchema.parse(email), token ? tokenHash(token) : null],
      );
      const invite = result.rows[0];
      if (!invite)
        throw new APIError('FORBIDDEN', {
          message: 'Invitation is invalid, expired or already used.',
        });
      const workspaceId = invite.workspace_id ?? randomUUID();
      if (!invite.workspace_id)
        await client.query(
          'INSERT INTO sb_workspaces (id,name) VALUES ($1,$2)',
          [workspaceId, 'SwiftBuild workspace'],
        );
      await client.query(
        'INSERT INTO sb_admitted_users (user_id,administrator) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING',
        [userId, invite.bootstrap],
      );
      // An invitation cannot reactivate a disabled account or change an existing role.
      if (
        !(
          await client.query(
            'SELECT user_id FROM sb_admitted_users WHERE user_id=$1 AND active=true',
            [userId],
          )
        ).rowCount
      )
        throw new APIError('FORBIDDEN', { message: 'Account is unavailable.' });
      await client.query(
        'INSERT INTO sb_members (workspace_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (workspace_id,user_id) DO NOTHING',
        [workspaceId, userId, invite.role],
      );
      await client.query(
        'UPDATE sb_invitations SET used_by=$2,used_at=now() WHERE id=$1',
        [invite.id, userId],
      );
      await client.query(
        "INSERT INTO sb_audit_events (id,workspace_id,actor_id,action) VALUES ($1,$2,$3,'invitation.accepted')",
        [randomUUID(), workspaceId, userId],
      );
    });
  }
  const auth = betterAuth({
    appName: 'SwiftBuild',
    baseURL: base.origin,
    secret: config.secret,
    database: pool,
    trustedOrigins: [base.origin],
    logger: { disabled: true },
    user: {
      modelName: 'sb_auth_users',
      validateUserInfo: async ({ user, source }) => {
        if (!source.oauth) return;
        if (
          source.oauth.providerId !== 'organization' ||
          !user.email ||
          user.emailVerified !== true
        )
          return {
            error: 'identity_not_allowed',
            errorDescription: 'A verified invited identity is required.',
          };
        const existing = await pool.query<{ id: string }>(
          'SELECT id FROM sb_auth_users WHERE email=$1',
          [emailSchema.parse(user.email)],
        );
        if (existing.rows[0] && (await activeUser(existing.rows[0].id))) return;
        if (!(await invitation(user.email)))
          return {
            error: 'identity_not_allowed',
            errorDescription: 'A verified invited identity is required.',
          };
      },
    },
    session: {
      modelName: 'sb_auth_sessions',
      expiresIn: 86400,
      updateAge: 3600,
      freshAge: 300,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'sb_auth_accounts',
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
      },
    },
    verification: {
      modelName: 'sb_auth_verifications',
      storeIdentifier: 'hashed',
    },
    advanced: { useSecureCookies: base.protocol === 'https:' },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ url }) => {
        if (!config.deliverRecovery)
          throw new Error('Use the local operator recovery command.');
        await config.deliverRecovery(url);
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'sb_auth_limits',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/reset-password': { window: 60, max: 5 },
      },
    },
    plugins: config.oidc
      ? [
          genericOAuth({
            config: [
              {
                providerId: 'organization',
                discoveryUrl: config.oidc.discoveryUrl,
                clientId: config.oidc.clientId,
                clientSecret: config.oidc.clientSecret,
                scopes: ['openid', 'email', 'profile'],
                pkce: true,
                requireIdTokenVerification: true,
              },
            ],
          }),
        ]
      : [],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email') {
          if (
            !z.string().trim().min(1).max(120).safeParse(ctx.body?.name).success
          )
            throw new APIError('BAD_REQUEST', {
              message: 'A name of 1 to 120 characters is required.',
            });
          const token = ctx.headers?.get('x-swiftbuild-invitation');
          if (!token || !(await invitation(ctx.body?.email, token)))
            throw new APIError('FORBIDDEN', {
              message: 'A valid invitation is required.',
            });
        }
        if (ctx.path === '/sign-in/email') {
          const row = await pool.query<{ id: string }>(
            'SELECT id FROM sb_auth_users WHERE email=$1',
            [emailSchema.parse(ctx.body?.email)],
          );
          const token = ctx.headers?.get('x-swiftbuild-invitation');
          if (
            !row.rows[0] ||
            (!(await activeUser(row.rows[0].id)) &&
              (!token || !(await invitation(ctx.body?.email, token))))
          )
            throw new APIError('UNAUTHORIZED', {
              message: 'Invalid credentials.',
            });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const token = ctx.headers?.get('x-swiftbuild-invitation') ?? undefined;
        if (ctx.path === '/sign-up/email' && token) {
          const parsed = z
            .object({ user: z.object({ id: z.string(), email: z.string() }) })
            .safeParse(ctx.context.returned);
          if (
            parsed.success &&
            (
              await pool.query('SELECT id FROM sb_auth_users WHERE id=$1', [
                parsed.data.user.id,
              ])
            ).rowCount
          )
            await admit(parsed.data.user.id, parsed.data.user.email, token);
        }
        const session = ctx.context.newSession;
        if (
          ctx.path === '/sign-in/email' &&
          session &&
          token &&
          (await invitation(session.user.email, token))
        )
          await admit(session.user.id, session.user.email, token);
        if (
          ctx.path.startsWith('/callback/') &&
          session &&
          session.user.emailVerified &&
          !(await activeUser(session.user.id))
        )
          await admit(session.user.id, session.user.email);
      }),
    },
  });
  return {
    auth,
    async session(headers: Headers) {
      const session = await auth.api.getSession({ headers });
      return session && (await activeUser(session.user.id)) ? session : null;
    },
    async acceptInvitation(headers: Headers, token: string) {
      const session = await auth.api.getSession({ headers });
      if (!session)
        throw new APIError('UNAUTHORIZED', {
          message: 'Sign in to accept this invitation.',
        });
      if (!(await invitation(session.user.email, token)))
        throw new APIError('FORBIDDEN', {
          message: 'Invitation is invalid, expired or already used.',
        });
      await admit(session.user.id, session.user.email, token);
    },
    async handler(request: Request) {
      const path = new URL(request.url).pathname.replace('/api/auth', '');
      const allowed = [
        '/sign-in/email',
        '/sign-up/email',
        '/sign-in/social',
        '/get-session',
        '/sign-out',
        '/reset-password',
        '/link-social',
        '/list-accounts',
        '/unlink-account',
        '/change-password',
      ];
      if (
        !allowed.includes(path) &&
        !/^\/(callback|reset-password)\/[a-zA-Z0-9_-]+$/.test(path)
      )
        return Response.json({ error: 'Not found.' }, { status: 404 });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        if (request.headers.get('origin') !== base.origin)
          return Response.json({ error: 'Untrusted origin.' }, { status: 403 });
        const reader = request.body?.getReader();
        if (reader) {
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 16 * 1024) {
              await reader.cancel();
              return Response.json(
                { error: 'Authentication input is too large.' },
                { status: 413 },
              );
            }
            chunks.push(part.value);
          }
          const body = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.length;
          }
          request = new Request(request, { body });
        }
      }
      return auth.handler(request);
    },
  };
}
