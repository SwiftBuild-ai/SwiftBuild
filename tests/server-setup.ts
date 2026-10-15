import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
  const children: ReturnType<typeof spawn>[] = [];
  const stopChildren = () =>
    Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            child.once('exit', () => resolve());
            child.kill();
          }),
      ),
    );
  try {
    await migrate(scoped.pool);
    const backendPython =
      process.env.SWIFTBUILD_BACKEND_PYTHON ??
      resolve(
        'services/backend/.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      );
    children.push(
      spawn(backendPython, ['-m', 'swiftbuild_backend'], {
        cwd: resolve('services/backend'),
        env: {
          ...process.env,
          ...settings,
          DATABASE_URL: process.env.SWIFTBUILD_BROWSER_DATABASE_URL,
          SWIFTBUILD_BACKEND_PORT: '18321',
          SWIFTBUILD_OIDC_DISCOVERY_URL: '',
          SWIFTBUILD_OIDC_CLIENT_ID: '',
          SWIFTBUILD_OIDC_CLIENT_SECRET: '',
        },
        stdio: 'ignore',
      }),
    );
    let apiReady = false;
    for (let i = 0; i < 100; i++) {
      try {
        if (
          (
            await fetch('http://127.0.0.1:18321/api/v1/ready', {
              signal: AbortSignal.timeout(2000),
            })
          ).ok
        ) {
          apiReady = true;
          break;
        }
      } catch {
        /* wait for Python startup */
      }
      await delay(100);
    }
    if (!apiReady) throw new Error('Browser FastAPI service did not start.');
    const email = 'browser-' + randomUUID() + '@example.test';
    const invitation = await issueInvitation(scoped.pool, email, {
      bootstrap: true,
    });
    process.env.SWIFTBUILD_BROWSER_EMAIL = email;
    process.env.SWIFTBUILD_BROWSER_INVITATION = invitation.token;
    if (process.env.SWIFTBUILD_COMPUTATION_PYTHON) {
      const token = 'browser-computation-token-'.repeat(3);
      children.push(
        spawn(
          process.env.SWIFTBUILD_COMPUTATION_PYTHON,
          [
            '-m',
            'uvicorn',
            'app:app',
            '--host',
            '127.0.0.1',
            '--port',
            '18320',
            '--no-access-log',
          ],
          {
            cwd: resolve('services/computation'),
            env: {
              ...process.env,
              SWIFTBUILD_COMPUTATION_TOKEN: token,
              OPENBLAS_NUM_THREADS: '1',
            },
            stdio: 'ignore',
          },
        ),
      );
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch('http://127.0.0.1:18320/health')).ok) {
            ready = true;
            break;
          }
        } catch {
          /* wait for child startup */
        }
        await delay(100);
      }
      if (!ready) throw new Error('Browser computation service did not start.');
      children.push(
        spawn(backendPython, ['-m', 'swiftbuild_backend.worker'], {
          cwd: resolve('services/backend'),
          env: {
            ...process.env,
            ...settings,
            DATABASE_URL: process.env.SWIFTBUILD_BROWSER_DATABASE_URL,
            SWIFTBUILD_COMPUTATION_TOKEN: token,
            SWIFTBUILD_COMPUTATION_URL: 'http://127.0.0.1:18320',
          },
          stdio: 'ignore',
        }),
      );
      process.env.SWIFTBUILD_BROWSER_COMPUTATION = '1';
    }
  } catch (failure) {
    await stopChildren();
    await admin.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.pool.end();
    throw failure;
  } finally {
    await scoped.pool.end();
  }
  return async () => {
    await stopChildren();
    try {
      await admin.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.pool.end();
    }
  };
}
