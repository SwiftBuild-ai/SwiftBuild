import { randomUUID } from 'node:crypto';
import {
  connectBackend,
  migrate,
  issueInvitation,
} from '../packages/server-core/src/index';
export default async function setup() {
  const schema = process.env.SWIFTBUILD_BROWSER_SCHEMA;
  if (!schema || !/^swiftbuild_browser_test_[0-9a-f]{32}$/.test(schema))
    throw new Error('A generated browser fixture schema is required.');
  const settings = {
    SWIFTBUILD_URL: 'http://localhost:3200',
    SWIFTBUILD_AUTH_SECRET: process.env.SWIFTBUILD_BROWSER_SECRET,
    SWIFTBUILD_ALLOW_LOCAL_HTTP: '1',
  };
  const admin = connectBackend({
    ...settings,
    DATABASE_URL: process.env.SWIFTBUILD_TEST_DATABASE_URL,
  });
  if (
    !(
      await admin.pool.query('SELECT current_database() AS name')
    ).rows[0].name.endsWith('_test')
  ) {
    await admin.pool.end();
    throw new Error('An isolated _test database is required.');
  }
  await admin.pool.query(`CREATE SCHEMA "${schema}"`);
  const scoped = connectBackend({
    ...settings,
    DATABASE_URL: process.env.SWIFTBUILD_BROWSER_DATABASE_URL,
  });
  try {
    await migrate(scoped.pool);
    const email = 'browser-' + randomUUID() + '@example.test';
    const invitation = await issueInvitation(scoped.pool, email, {
      bootstrap: true,
    });
    process.env.SWIFTBUILD_BROWSER_EMAIL = email;
    process.env.SWIFTBUILD_BROWSER_INVITATION = invitation.token;
  } catch (failure) {
    await admin.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.pool.end();
    throw failure;
  } finally {
    await scoped.pool.end();
  }
  return async () => {
    try {
      await admin.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.pool.end();
    }
  };
}
