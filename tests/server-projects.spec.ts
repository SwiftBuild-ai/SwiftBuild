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
test('credential fields cannot submit before client hydration', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: 'http://localhost:3200',
  });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page.getByLabel('Password', { exact: true })).toBeDisabled();
    await expect(page.locator('form')).toHaveAttribute('method', 'post');
  } finally {
    await context.close();
  }
});
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
  let committedCreationId = '';
  await page.route('**/api/v1/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    committedCreationId = (await response.json()).id;
    await route.abort('failed');
  });
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Retry project creation', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry project creation', exact: true }),
  ).toBeEnabled();
  await page.unroute('**/api/v1/projects');
  await page.reload();
  await expect(
    page.getByRole('button', {
      name: 'Export pending creation archive',
      exact: true,
    }),
  ).toBeVisible();
  const recoveryBackend = connectBackend({
    DATABASE_URL: process.env.SWIFTBUILD_BROWSER_DATABASE_URL,
    SWIFTBUILD_URL: 'http://localhost:3200',
    SWIFTBUILD_AUTH_SECRET: process.env.SWIFTBUILD_BROWSER_SECRET,
    SWIFTBUILD_ALLOW_LOCAL_HTTP: '1',
  });
  const creationScope = (
    await recoveryBackend.pool.query(
      'SELECT workspace_id,created_by FROM sb_projects WHERE id=$1',
      [committedCreationId],
    )
  ).rows[0];
  try {
    await recoveryBackend.pool.query(
      'DELETE FROM sb_members WHERE workspace_id=$1 AND user_id=$2',
      [creationScope.workspace_id, creationScope.created_by],
    );
    await page.reload();
    await expect(
      page.getByRole('button', {
        name: 'Export pending creation archive',
        exact: true,
      }),
    ).toBeVisible();
    const deniedCreation = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/projects' &&
        response.request().method() === 'POST',
    );
    await page
      .getByRole('button', { name: 'Retry project creation', exact: true })
      .click();
    expect((await deniedCreation).status()).toBe(404);
    await expect(page.locator('.account-error')).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Export pending creation archive',
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await recoveryBackend.pool.query(
      "INSERT INTO sb_members(workspace_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING",
      [creationScope.workspace_id, creationScope.created_by],
    );
    await recoveryBackend.pool.end();
  }
  await page.reload();
  await page
    .getByRole('button', { name: 'Retry project creation', exact: true })
    .click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(id).toBe(committedCreationId);
  const saved = () =>
    page.getByRole('status').filter({ hasText: 'Saved to server' });
  await expect(saved()).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
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
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Saved revisions' }),
  ).toBeHidden();
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
test('revision restoration previews history, survives a lost response and preserves a stale conflict', async ({
  page,
  context,
}, info) => {
  page.on('dialog', (dialog) => dialog.accept());
  const signed = await context.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3200' },
    data: {
      email: process.env.SWIFTBUILD_BROWSER_EMAIL!,
      password: 'swiftbuild-browser-test-password!',
    },
  });
  expect(signed.status()).toBe(200);
  const workspaces = (
    await (await context.request.get('/api/v1/workspaces')).json()
  ).items;
  const archive = workspaceFor(sampleDocument());
  archive.document.project.name = 'Restore browser fixture';
  const project = await (
    await context.request.post('/api/v1/projects', {
      headers: { origin: 'http://localhost:3200' },
      data: {
        workspaceId: workspaces[0].id,
        operationId: randomUUID(),
        archive,
      },
    })
  ).json();
  const later = structuredClone(archive);
  later.document.architecture.name = 'Later revision';
  expect(
    (
      await context.request.put(`/api/v1/projects/${project.id}`, {
        headers: { origin: 'http://localhost:3200', 'if-match': '"1"' },
        data: { operationId: randomUUID(), archive: later },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/projects/${project.id}`);
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved to server' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Revision history', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Preview revision 1', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Preview of revision 1' }),
  ).toContainText('4 components');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath('revision-restore-narrow.png'),
  });
  await page.route(
    `**/api/v1/projects/${project.id}/restore`,
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
  );
  const restoreButton = page.getByRole('button', {
    name: 'Restore revision 1 as a new revision',
    exact: true,
  });
  await restoreButton.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Preserve your recovery copy' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Retry restoration of revision 1',
      exact: true,
    }),
  ).toBeEnabled();
  await page.unroute(`**/api/v1/projects/${project.id}/restore`);
  await page.reload();
  await page
    .getByRole('button', {
      name: 'Retry restoration of revision 1',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('Server project · revision 3', { exact: true }),
  ).toBeVisible();
  const restored = await (
    await context.request.get(`/api/v1/projects/${project.id}`)
  ).json();
  expect(restored.archive).toEqual(archive);
  await page
    .getByRole('button', { name: 'Revision history', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Preview revision 2', exact: true })
    .click();
  const intervening = structuredClone(archive);
  intervening.document.architecture.name = 'Intervening writer';
  expect(
    (
      await context.request.put(`/api/v1/projects/${project.id}`, {
        headers: { origin: 'http://localhost:3200', 'if-match': '"3"' },
        data: { operationId: randomUUID(), archive: intervening },
      })
    ).status(),
  ).toBe(200);
  await page
    .getByRole('button', {
      name: 'Restore revision 2 as a new revision',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Preserve your recovery copy' }),
  ).toBeVisible();
  expect(
    (await (await context.request.get(`/api/v1/projects/${project.id}`)).json())
      .archive,
  ).toEqual(intervening);
  await expect(
    page.getByRole('button', { name: 'Export recovery archive', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Discard local recovery and open server revision',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved to server' }),
  ).toBeVisible();
});

test('engineering jobs survive reload and export/import through the workbench', async ({
  page,
  context,
}, info) => {
  test.skip(
    !process.env.SWIFTBUILD_BROWSER_COMPUTATION,
    'Configure Python for complete computation browser verification.',
  );
  await page.goto('/login');
  await page
    .getByLabel('Email', { exact: true })
    .fill(process.env.SWIFTBUILD_BROWSER_EMAIL!);
  await page
    .getByLabel('Password', { exact: true })
    .fill('swiftbuild-browser-test-password!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/account');
  const workspaces = await (
    await context.request.get('/api/v1/workspaces')
  ).json();
  const p = await context.request.post('/api/v1/projects', {
    headers: { origin: 'http://localhost:3200' },
    data: {
      workspaceId: workspaces.items[0].id,
      operationId: randomUUID(),
      archive: workspaceFor(sampleDocument()),
    },
  });
  expect(p.status()).toBe(201);
  const project = await p.json();
  await page.goto('/projects/' + project.id);
  await page
    .getByRole('button', { name: 'Engineering analysis', exact: true })
    .click();
  await page.getByRole('checkbox', { name: /Web application/ }).check();
  await page.getByLabel('Mean operating time (seconds)').fill('80');
  await page.getByLabel('Mean repair time (seconds)').fill('20');
  await page.getByLabel('Evidence source').fill('Browser reference');
  await page
    .getByLabel('Model context and assumptions')
    .fill('Explicit stationary test inputs.');
  await page
    .getByRole('button', { name: 'Submit saved revision 1', exact: true })
    .click();
  await page.reload();
  await page
    .getByRole('button', { name: 'Engineering analysis', exact: true })
    .click();
  await expect(page.getByText(/availability 0.8/)).toBeVisible({
    timeout: 30000,
  });
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export analysis bundle', exact: true })
    .click();
  const bundle = await downloaded;
  const body = JSON.parse(await readFile((await bundle.path())!, 'utf8'));
  expect(body.report.availability).toBeCloseTo(0.8, 12);
  await page.getByLabel('Import historical analysis bundle').setInputFiles({
    name: 'analysis.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(body)),
  });
  await expect(page.getByText('completed · Historical import')).toBeVisible();
  await page
    .getByRole('button', { name: 'Submit saved revision 1', exact: true })
    .focus();
  await expect(
    page.getByRole('button', { name: 'Submit saved revision 1', exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: info.outputPath('server-engineering-analysis-dark.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath('server-engineering-analysis-narrow.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
