import { Pool } from 'pg';
import { createIdentity } from './identity';
import { identityConfig } from './config';
import { createProjectStore } from './projects';
import { createApi } from './http';
export function connectBackend(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DATABASE_URL) throw new Error('Server storage is not configured.');
  const config = identityConfig(env);
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    application_name: 'SwiftBuild',
  });
  const identity = createIdentity(pool, config);
  const projects = createProjectStore(pool);
  return {
    pool,
    identity,
    projects,
    api: createApi({
      pool,
      identity,
      projects,
      origin: new URL(config.url).origin,
      oidc: !!config.oidc,
    }),
  };
}
