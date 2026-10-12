import { randomBytes, randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';
const database = process.env.SWIFTBUILD_TEST_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith('_test'))
  throw new Error(
    'Configure an isolated SWIFTBUILD_TEST_DATABASE_URL ending in _test.',
  );
process.env.SWIFTBUILD_BROWSER_TEST = '1';
process.env.SWIFTBUILD_BROWSER_SCHEMA ??=
  'swiftbuild_browser_test_' + randomUUID().replaceAll('-', '');
process.env.SWIFTBUILD_BROWSER_SECRET ??= randomBytes(48).toString('base64url');
const scoped = new URL(database);
scoped.searchParams.set(
  'options',
  '-c search_path=' + process.env.SWIFTBUILD_BROWSER_SCHEMA,
);
process.env.SWIFTBUILD_BROWSER_DATABASE_URL = scoped.toString();
export default defineConfig({
  testDir: './tests',
  testMatch: 'server-projects.spec.ts',
  globalSetup: './tests/server-setup.ts',
  workers: 1,
  timeout: 120000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3200',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @swiftbuild/web start --port 3200',
    url: 'http://localhost:3200/api/health',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      DATABASE_URL: scoped.toString(),
      SWIFTBUILD_URL: 'http://localhost:3200',
      SWIFTBUILD_AUTH_SECRET: process.env.SWIFTBUILD_BROWSER_SECRET,
      SWIFTBUILD_ALLOW_LOCAL_HTTP: '1',
      SWIFTBUILD_OIDC_DISCOVERY_URL: '',
      SWIFTBUILD_OIDC_CLIENT_ID: '',
      SWIFTBUILD_OIDC_CLIENT_SECRET: '',
    },
  },
});
