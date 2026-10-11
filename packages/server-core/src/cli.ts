import { Pool } from 'pg';
import { createIdentity, issueInvitation } from './identity';
import { identityConfig } from './config';
import { migrate } from './migrate';
const [command, ...args] = process.argv.slice(2);
if (!command || command === 'help' || command === '--help') {
  console.log(
    'SwiftBuild operator commands: migrate; bootstrap --email ADDRESS; invite --email ADDRESS --workspace ID --role owner|editor|viewer; recover --email ADDRESS. Configure DATABASE_URL and identity settings in the environment. Links are secrets: deliver them privately.',
  );
} else {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !['--email', '--workspace', '--role'].includes(key) ||
      !value ||
      flags.has(key)
    )
      throw new Error('Invalid operator command options.');
    flags.set(key, value);
  }
  if (!['migrate', 'bootstrap', 'invite', 'recover'].includes(command))
    throw new Error('Unknown operator command.');
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL.');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });
  try {
    if (command === 'migrate') {
      await migrate(pool);
      console.log('SwiftBuild database migrations applied.');
    } else {
      const email = flags.get('--email');
      if (!email) throw new Error('An email address is required.');
      const config = identityConfig();
      createIdentity(pool, config);
      if (command === 'recover') {
        const identity = createIdentity(pool, {
          ...config,
          deliverRecovery: async (url) => {
            console.log(url);
          },
        });
        await identity.auth.api.requestPasswordReset({
          body: {
            email,
            redirectTo: new URL('/reset-password', config.url).toString(),
          },
        });
        console.log(
          'Recovery requested. A one-time link is printed only for an eligible existing account.',
        );
      } else {
        const role = flags.get('--role');
        if (role && !['owner', 'editor', 'viewer'].includes(role))
          throw new Error('Role must be owner, editor or viewer.');
        const invitation = await issueInvitation(pool, email, {
          bootstrap: command === 'bootstrap',
          workspaceId: flags.get('--workspace'),
          role: role as 'owner' | 'editor' | 'viewer' | undefined,
        });
        const link = new URL('/invite', config.url);
        link.searchParams.set('token', invitation.token);
        link.searchParams.set('email', invitation.email);
        console.log(link.toString());
      }
    }
  } finally {
    await pool.end();
  }
}
