import { rm } from 'node:fs/promises';
for (const path of [
  'apps/web/.next',
  '.turbo',
  'coverage',
  'test-results',
  'playwright-report',
  'packages/ui/storybook-static',
])
  await rm(path, { recursive: true, force: true });
