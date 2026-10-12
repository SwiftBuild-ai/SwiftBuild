import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { sampleDocument } from '../packages/components-core/src/index';
import { workspaceFor } from '../packages/project-format/src/index';
import { createCheckpoint } from '../packages/architecture-model/src/index';
import {
  connectBackend,
  issueInvitation,
} from '../packages/server-core/src/index';
test.skip(
  !process.env.SWIFTBUILD_BROWSER_TEST,
  'Run with playwright.server.config.ts and an isolated database.',
);
test('server editing preserves revisions, stale/offline recovery and complete local promotion', async ({
  page,
  context,
}, info) => {
  const email = process.env.SWIFTBUILD_BROWSER_EMAIL!,
    token = process.env.SWIFTBUILD_BROWSER_INVITATION!;
  expect(email).toBeTruthy();
  expect(token).toBeTruthy();
  const errors: string[] = [];
  page.on('pageerror', (failure) => errors.push(failure.message));
  page.on('dialog', (dialog) => dialog.accept());
  const link = '/invite?' + new URLSearchParams({ email, token });
  await page.goto(link);
  await page
    .getByLabel('Name', { exact: true })
    .fill('SwiftBuild browser fixture');
  await page
    .getByLabel('Password', { exact: true })
    .fill('swiftbuild-browser-test-password!');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await page.waitForURL('**/account');
  await page
    .getByRole('link', { name: 'Open server projects', exact: true })
    .click();
  await page
    .getByLabel('New project name', { exact: true })
    .fill('Durable browser project');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  const saved = () =>
    page.getByRole('status').filter({ hasText: 'Saved to server' });
  await expect(saved()).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'Architecture templates', exact: true })
    .click();
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect
    .poll(
      async () =>
        (await (await context.request.get(`/api/v1/projects/${id}`)).json())
          .revision,
    )
    .toBe(2);
  await expect(saved()).toBeVisible();
  await page.screenshot({ path: info.outputPath('server-editor-dark.png') });
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(saved()).toBeVisible();
  await page
    .getByRole('button', { name: 'Revision history', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Saved revisions' }),
  ).toBeVisible();
  const historyDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export revision 1', exact: true })
    .click();
  const historical = await historyDownload;
  expect(
    JSON.parse(await readFile((await historical.path())!, 'utf8')).document
      .nodes,
  ).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Close revision history', exact: true })
    .click();
  const snapshot = await (
    await context.request.get(`/api/v1/projects/${id}`)
  ).json();
  snapshot.archive.document.architecture.name = 'Another writer';
  const external = await context.request.put(`/api/v1/projects/${id}`, {
    headers: { origin: 'http://localhost:3200', 'if-match': '"2"' },
    data: { operationId: randomUUID(), archive: snapshot.archive },
  });
  expect(external.status()).toBe(200);
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page
    .locator('#object-list')
    .getByRole('button', { name: 'Web application', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Delete selection', exact: true })
    .click();
  await expect(page.locator('.server-project-error')).toContainText(
    'server project changed',
  );
  expect(
    (await (await context.request.get(`/api/v1/projects/${id}`)).json()).archive
      .document.architecture.name,
  ).toBe('Another writer');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Preserve your recovery copy' }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Save recovery as separate project',
      exact: true,
    })
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith('/projects/') && !url.pathname.endsWith(id),
  );
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(saved()).toBeVisible();
  await page.goto('/');
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved locally' }),
  ).toBeVisible();
  const archive = workspaceFor(sampleDocument());
  archive.document.project.name = 'Complete promoted archive';
  archive.checkpoints.push(
    createCheckpoint(
      archive.document,
      'Before promotion',
      randomUUID(),
      '2026-10-11T00:00:00Z',
    ),
  );
  await page.evaluate(async (json: string) => {
    const value = JSON.parse(json);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('swiftbuild-workspace', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').put(
          { ...value, storageRevision: 100 },
          'current',
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, JSON.stringify(archive));
  await page.goto('/projects');
  await page
    .getByRole('button', {
      name: 'Copy saved local draft to server',
      exact: true,
    })
    .click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
  await expect(saved()).toBeVisible();
  const promotedId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(
    (await (await context.request.get(`/api/v1/projects/${promotedId}`)).json())
      .archive,
  ).toEqual(archive);
  const local = await page.evaluate(
    () =>
      new Promise<{ storageRevision: number; checkpoints: unknown[] }>(
        (resolve, reject) => {
          const request = indexedDB.open('swiftbuild-workspace', 1);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('workspace', 'readonly');
            const read = tx.objectStore('workspace').get('current');
            read.onsuccess = () => resolve(read.result);
            tx.oncomplete = () => db.close();
            tx.onerror = () => reject(tx.error);
          };
        },
      ),
  );
  expect(local.storageRevision).toBe(100);
  expect(local.checkpoints).toEqual(archive.checkpoints);
  await context.setOffline(true);
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page
    .locator('#object-list')
    .getByRole('button', { name: 'Web application', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Delete selection', exact: true })
    .click();
  await expect(page.locator('.server-project-error')).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Preserve your recovery copy' }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('server-recovery-dark.png') });
  await page
    .getByRole('button', {
      name: 'Discard local recovery and open server revision',
      exact: true,
    })
    .click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(saved()).toBeVisible();
  await page.goto('/projects');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath('server-projects-narrow.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test('viewer edits remain local while the server rejects writes', async ({
  page,
  context,
}) => {
  const scoped = connectBackend({
    DATABASE_URL: process.env.SWIFTBUILD_BROWSER_DATABASE_URL,
    SWIFTBUILD_URL: 'http://localhost:3200',
    SWIFTBUILD_AUTH_SECRET: process.env.SWIFTBUILD_BROWSER_SECRET,
    SWIFTBUILD_ALLOW_LOCAL_HTTP: '1',
  });
  let id: string, email: string, token: string;
  try {
    const project = (
      await scoped.pool.query(
        'SELECT id,workspace_id FROM sb_projects ORDER BY created_at LIMIT 1',
      )
    ).rows[0];
    expect(project).toBeTruthy();
    id = project.id;
    email = 'viewer-' + randomUUID() + '@example.test';
    token = (
      await issueInvitation(scoped.pool, email, {
        workspaceId: project.workspace_id,
        role: 'viewer',
      })
    ).token;
  } finally {
    await scoped.pool.end();
  }
  await page.goto('/invite?' + new URLSearchParams({ email, token }));
  await page
    .getByLabel('Name', { exact: true })
    .fill('SwiftBuild viewer fixture');
  await page
    .getByLabel('Password', { exact: true })
    .fill('swiftbuild-browser-test-password!');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await page.waitForURL('**/account');
  await page.goto('/projects/' + id);
  await expect(
    page.getByText('Read-only server · editable local preview', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Preview saved locally' }),
  ).toBeVisible();
  const initial = await (
    await context.request.get('/api/v1/projects/' + id)
  ).json();
  let serverWrites = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PUT' &&
      new URL(request.url()).pathname === '/api/v1/projects/' + id
    )
      serverWrites++;
  });
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page
    .locator('#object-list')
    .getByRole('button', { name: 'Web application', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Delete selection', exact: true })
    .click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(
    page.getByRole('status').filter({ hasText: 'Preview saved locally' }),
  ).toBeVisible();
  expect(serverWrites).toBe(0);
  const current = await (
    await context.request.get('/api/v1/projects/' + id)
  ).json();
  expect(current.revision).toBe(initial.revision);
  expect(current.archive).toEqual(initial.archive);
  const denied = await context.request.put('/api/v1/projects/' + id, {
    headers: {
      origin: 'http://localhost:3200',
      'if-match': `"${current.revision}"`,
    },
    data: { operationId: randomUUID(), archive: current.archive },
  });
  expect(denied.status()).toBe(403);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Preserve your recovery copy' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Save recovery as separate project',
      exact: true,
    }),
  ).toHaveCount(0);
});
