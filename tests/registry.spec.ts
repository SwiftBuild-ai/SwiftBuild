import { test, expect } from '@playwright/test';
import { sampleDocument } from '../packages/components-core/src/index';
import { infrastructureComponents } from '../packages/component-registry/src/index';
test('technology search, native drag insertion, configuration, connections and theme restoration', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('.statusbar').getByRole('status')).toHaveText(
    'Saved locally',
  );
  const search = page.getByRole('textbox', {
    name: 'Search component catalog',
    exact: true,
  });
  await search.fill('postgres');
  const pg = page.getByRole('button', { name: 'Add PostgreSQL', exact: true });
  await expect(pg).toBeVisible();
  await page
    .getByRole('button', { name: 'Details for PostgreSQL', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'PostgreSQL', exact: true }),
  ).toContainText('Read replicas');
  expect(await page.locator('.react-flow__node').count()).toBe(0);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await pg.dragTo(page.locator('.graph-area'), {
    targetPosition: { x: 440, y: 240 },
  });
  const node = page
    .locator('.react-flow__node')
    .filter({ hasText: 'PostgreSQL' });
  await expect(node).toHaveCount(1);
  await expect(
    node.getByRole('img', { name: 'PostgreSQL icon' }),
  ).toBeVisible();
  await node.click();
  const inspector = page.getByRole('complementary', {
    name: 'Component inspector',
  });
  await inspector.getByLabel('Storage capacity', { exact: true }).fill('250');
  await inspector.getByLabel('Read replicas', { exact: true }).fill('2');
  await inspector.getByRole('button', { name: 'Apply changes' }).click();
  await expect(
    inspector.getByLabel('Storage capacity', { exact: true }),
  ).toHaveValue('250');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await search.fill('redis');
  await page
    .getByRole('button', { name: 'Favorite Redis', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add Redis', exact: true })
    .press('Enter');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await search.fill('kafka');
  await page
    .getByRole('button', { name: 'Add Apache Kafka', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await search.fill('');
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Add Redis', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await search.fill('Application server');
  await page
    .getByRole('button', { name: 'Add Application server', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page
    .getByRole('button', { name: 'Command palette', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Search commands' })
    .fill('Connect architecture');
  await page
    .getByRole('button', {
      name: 'Connect architecture objects C',
      exact: true,
    })
    .click();
  const connection = page.getByRole('dialog', {
    name: 'Connect architecture objects',
    exact: true,
  });
  await connection
    .getByLabel('Source object')
    .selectOption({ label: 'Application server' });
  await connection
    .getByLabel('Target object')
    .selectOption({ label: 'PostgreSQL' });
  await connection.getByLabel('Output port').selectOption('out');
  await connection.getByRole('button', { name: 'Create connection' }).click();
  await expect(connection).not.toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('.graph-area')).toHaveCSS(
    'background-color',
    'rgb(0, 0, 0)',
  );
  await expect(
    page.getByRole('complementary', { name: 'Component catalog' }),
  ).toHaveCSS('background-color', 'rgb(9, 9, 11)');
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--canvas')
          .trim(),
      ),
    )
    .toMatch(/^#(?:000|000000)$/);
  await page.screenshot({ path: info.outputPath('registry-dark.png') });
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--canvas')
          .trim(),
      ),
    )
    .toBe('#f4f4f5');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('swiftbuild-workspace', 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result,
                read = db
                  .transaction('workspace', 'readonly')
                  .objectStore('workspace')
                  .get('current');
              read.onsuccess = () => {
                resolve(read.result?.document.nodes.length ?? 0);
                db.close();
              };
              read.onerror = () => reject(read.error);
            };
          }),
      ),
    )
    .toBe(4);
  await page.reload();
  await expect(page.locator('.statusbar').getByRole('status')).toHaveText(
    'Saved locally',
  );
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--canvas')
          .trim(),
      ),
    )
    .toBe('#f4f4f5');
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page
    .locator('#object-list')
    .getByRole('button', { name: 'PostgreSQL', exact: true })
    .click();
  await expect(
    page.getByLabel('Storage capacity', { exact: true }),
  ).toHaveValue('250');
  await page.screenshot({ path: info.outputPath('registry-light.png') });
});
test('declarative community packs persist and rejected updates leave nodes intact', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.statusbar').getByRole('status')).toHaveText(
    'Saved locally',
  );
  const base = infrastructureComponents.find(
    (c) => c.name === 'OpenTelemetry',
  )!;
  const component = {
    ...base,
    id: 'community.collector',
    name: 'Community collector',
  };
  const pack = {
    format: 'swiftbuild-component-pack',
    packVersion: '1.0',
    id: 'community.observability',
    name: 'Community observability',
    version: '1.0.0',
    license: 'Apache-2.0',
    components: [component],
  };
  await page
    .getByLabel('Import component pack', { exact: true })
    .setInputFiles({
      name: 'pack.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(pack)),
    });
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Installed Community observability' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search component catalog' })
    .fill('Community collector');
  await page
    .getByRole('button', { name: 'Add Community collector', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('swiftbuild-workspace', 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result,
                read = db
                  .transaction('workspace', 'readonly')
                  .objectStore('workspace')
                  .get('current');
              read.onsuccess = () => {
                resolve(read.result?.document.nodes.length ?? 0);
                db.close();
              };
              read.onerror = () => reject(read.error);
            };
          }),
      ),
    )
    .toBe(1);
  await page.reload();
  await expect(page.locator('.statusbar').getByRole('status')).toHaveText(
    'Saved locally',
  );
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page
    .getByLabel('Import component pack', { exact: true })
    .setInputFiles({
      name: 'conflict.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          ...pack,
          components: [{ ...component, version: '2.0.0' }],
        }),
      ),
    });
  await expect(
    page.getByRole('alert').filter({ hasText: 'upgrade must be explicit' }),
  ).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
});
test('explicit legacy conversion preserves connections and can be undone', async ({
  page,
}) => {
  await page.addInitScript(
    (raw) => localStorage.setItem('swiftbuild.draft.v1', raw),
    JSON.stringify(sampleDocument()),
  );
  await page.goto('/');
  await expect(page.locator('.statusbar').getByRole('status')).toHaveText(
    'Saved locally',
  );
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page
    .locator('#object-list')
    .getByRole('button', { name: 'Primary database', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Convert to PostgreSQL', exact: true })
    .click();
  await expect(
    page
      .getByRole('complementary', { name: 'Component inspector' })
      .getByRole('img', { name: 'PostgreSQL icon' }),
  ).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.keyboard.press('Control+z');
  await page
    .locator('#object-list')
    .getByRole('button', { name: 'Primary database', exact: true })
    .click();
  await expect(page.getByLabel('Engine', { exact: true })).toHaveValue(
    'PostgreSQL',
  );
});
