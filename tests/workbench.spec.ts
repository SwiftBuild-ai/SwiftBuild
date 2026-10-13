import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sampleDocument } from '../packages/components-core/src/index';
const key = 'swiftbuild.draft.v1';
async function ready(page: Page, withSample = true) {
  await page.addInitScript(() =>
    localStorage.setItem('swiftbuild.theme', 'light'),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Saved locally');
  if (withSample && (await page.locator('.react-flow__node').count()) === 0) {
    await page
      .getByRole('navigation', { name: 'Editor tools' })
      .getByRole('button', { name: 'Architecture templates', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Use template', exact: true })
      .click();
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await expect.poll(async () => (await stored(page)).nodes.length).toBe(4);
  }
}
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<ReturnType<typeof sampleDocument>>((resolve, reject) => {
        const request = indexedDB.open('swiftbuild-workspace', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction('workspace', 'readonly')
            .objectStore('workspace')
            .get('current');
          read.onsuccess = () => {
            resolve(read.result?.document);
            db.close();
          };
          read.onerror = () => reject(read.error);
        };
      }),
  );
}
async function selectObject(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page
    .locator('#object-list')
    .getByRole('button', { name, exact: true })
    .click();
}
test('sample opens without runtime errors; dark and light layouts', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath('workbench-light.png') });
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: info.outputPath('workbench-dark.png') });
  expect(errors).toEqual([]);
});
test('configuration validation, undo/redo and refresh restoration', async ({
  page,
}) => {
  await ready(page);
  await selectObject(page, 'Storefront API');
  await page
    .getByRole('spinbutton', { name: 'Replicas', exact: true })
    .fill('0');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /at least|Import rejected|Export JSON|incompatible/ }),
  ).toContainText('at least 1');
  await page
    .getByRole('spinbutton', { name: 'Replicas', exact: true })
    .fill('3');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(
    page.locator('.node-footer').filter({ hasText: '3 replicas' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.locator('.node-footer').filter({ hasText: '2 replicas' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await stored(page)).nodes.find(
          (n: { id: string }) => n.id === 'service',
        )?.configuration.replicas,
    )
    .toBe(3);
  await page.reload();
  await expect(
    page.locator('.node-footer').filter({ hasText: '3 replicas' }),
  ).toBeVisible();
});
test('keyboard quick-add, duplicate, delete and undo', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('a');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search components', exact: true })
    .fill('queue');
  await page.getByRole('button', { name: 'Add Queue', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
});
test('JSON export reimports and invalid imports preserve draft', async ({
  page,
}) => {
  await ready(page);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export architecture', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Export JSON', exact: true })
    .click();
  const file = await download;
  const path = await file.path();
  const parsed = JSON.parse(await readFile(path!, 'utf8'));
  expect(parsed.schemaVersion).toBe('1.1');
  expect(parsed.nodes).toHaveLength(4);
  const input = page.getByLabel('Import architecture JSON', { exact: true });
  await input.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /at least|Import rejected|Export JSON|incompatible/ }),
  ).toContainText('Import rejected');
  expect((await stored(page)).nodes).toHaveLength(4);
  parsed.project.name = 'Imported design';
  await input.setInputFiles({
    name: 'design.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(parsed)),
  });
  await expect(page.getByRole('dialog')).toContainText('Imported design');
  await page.getByRole('button', { name: 'Import and replace draft' }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Imported design');
});
test('corrupt saved draft is preserved until explicit replacement', async ({
  page,
}) => {
  await page.addInitScript((k) => localStorage.setItem(k, '{broken'), key);
  await page.goto('/');
  await expect(page.getByText('Stored draft needs recovery.')).toBeVisible();
  await page.waitForTimeout(800);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(
    '{broken',
  );
  await page.getByRole('button', { name: 'Replace with a new draft' }).click();
  await page
    .getByRole('button', { name: 'Start new architecture', exact: true })
    .click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Saved locally');
  await expect.poll(async () => (await stored(page)).nodes.length).toBe(0);
});
test('storage write failures remain visible', async ({ page }) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
  });
  await page.addInitScript(() =>
    localStorage.setItem('swiftbuild.theme', 'light'),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Save failed');
  await expect(
    page.getByRole('button', { name: 'Logs', exact: true }),
  ).toContainText('Save failed');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /at least|Import rejected|Export JSON|incompatible/ }),
  ).toContainText('Export JSON');
});
test('boundaries group nodes and deletion is reversible', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Add component A' }).click();
  await page
    .getByRole('textbox', { name: 'Search components', exact: true })
    .fill('boundary');
  await page.getByRole('button', { name: 'Add Boundary', exact: true }).click();
  await selectObject(page, 'Storefront API');
  await page
    .getByLabel('Boundary', { exact: true })
    .selectOption({ label: 'Boundary' });
  await expect
    .poll(
      async () =>
        (await stored(page)).nodes.find(
          (n: { id: string }) => n.id === 'service',
        )?.parentId,
    )
    .toBeTruthy();
  await selectObject(page, 'Boundary');
  await page.getByRole('button', { name: 'Delete selection' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
});
test('narrow layout, modal focus and command palette', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(
    page.getByRole('complementary', { name: 'Component catalog' }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page
    .getByRole('button', { name: 'Command palette', exact: true })
    .click();
  await expect(page.getByLabel('Search commands')).toBeFocused();
  await page.getByLabel('Search commands').fill('add component');
  await page
    .getByRole('option', { name: 'Add component A', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Search components', exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: info.outputPath('workbench-narrow.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('dialog dismissal restores its invoker and handoffs retain destination focus', async ({
  page,
}) => {
  await ready(page, false);
  const trigger = page.getByRole('button', {
    name: 'Command palette',
    exact: true,
  });
  await trigger.click();
  await page.getByLabel('Search commands').press('Escape');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search commands').fill('add component');
  await page
    .getByRole('option', { name: 'Add component A', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Search components', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(
    page.getByRole('button', { name: 'Workspace settings' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.getByLabel('Search commands').fill('Open Capacity');
  await page
    .getByRole('option', { name: 'Open Capacity', exact: true })
    .click();
  await expect(
    page.getByRole('main', { name: 'System architecture' }),
  ).toBeFocused();
});

test('command palette supports ranked keyboard results and empty states', async ({
  page,
}) => {
  await ready(page, false);
  await page
    .getByRole('button', { name: 'Command palette', exact: true })
    .click();
  const search = page.getByLabel('Search commands');
  await expect(search).toHaveAttribute('role', 'combobox');
  await expect(page.getByRole('option').first()).toContainText(
    'Connect architecture objects',
  );
  await search.fill('add component');
  await search.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toContainText(
    'Add component',
  );
  await search.press('Enter');
  await expect(
    page.getByRole('textbox', { name: 'Search components', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Command palette', exact: true })
    .click();
  await search.fill('no-such-command');
  await expect(
    page.getByRole('status').filter({ hasText: 'No commands match' }),
  ).toBeVisible();
  await search.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Command palette' }),
  ).toBeVisible();
  await search.fill('Add Load balancer');
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('option').nth(0)).not.toHaveAttribute(
    'id',
    (await page.getByRole('option').nth(1).getAttribute('id')) ?? '',
  );
  await expect(page.getByRole('option').nth(0)).toContainText(
    'generic.load-balancer',
  );
  await expect(page.getByRole('option').nth(1)).toContainText(
    'core.load-balancer',
  );
});

test('breakpoint changes dismiss the catalog and preserve deliberate toggles', async ({
  page,
}) => {
  await ready(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('complementary', { name: 'Component catalog' }),
  ).toHaveCount(0);
  const trigger = page.getByRole('button', {
    name: 'Show component catalog',
    exact: true,
  });
  await trigger.click();
  await expect(page.getByLabel('Search component catalog')).toBeFocused();
  await page.getByLabel('Search component catalog').press('Escape');
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 760, height: 844 });
  await expect(
    page.getByRole('complementary', { name: 'Component catalog' }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(
    page.getByRole('complementary', { name: 'Component catalog' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Hide component catalog', exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole('complementary', { name: 'Component catalog' }),
  ).toHaveCount(0);
});

test('UI navigation does not write another workspace revision', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tracking = window as typeof window & { workspaceWrites?: number };
    tracking.workspaceWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'workspace')
        tracking.workspaceWrites = (tracking.workspaceWrites ?? 0) + 1;
      return put.call(this, value, key);
    };
  });
  await ready(page);
  const before = await stored(page);
  const writes = await page.evaluate(
    () =>
      (window as typeof window & { workspaceWrites?: number }).workspaceWrites,
  );
  await selectObject(page, 'Storefront API');
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page
    .getByRole('button', { name: 'Command palette', exact: true })
    .click();
  await page.getByLabel('Search commands').fill('fit');
  await page.getByLabel('Search commands').press('Escape');
  await page
    .getByRole('button', { name: 'Zoom controls', exact: true })
    .click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page
    .getByRole('button', { name: 'Zoom controls', exact: true })
    .click();
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  // Observe a full autosave debounce interval after the last UI interaction.
  await page.waitForTimeout(600);
  expect(await stored(page)).toEqual(before);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { workspaceWrites?: number })
          .workspaceWrites,
    ),
  ).toBe(writes);
});

test('empty workbench and controls fit responsive viewports in both themes', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page, false);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.getByRole('button', { name: 'Workspace settings' }).click();
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await page.getByRole('button', { name: 'Close dialog' }).click();
    }
    for (const width of [390, 760, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator('.empty-canvas').evaluate((element) => {
        const card = element.getBoundingClientRect();
        const main = element.closest('main')!.getBoundingClientRect();
        const controls = document
          .querySelector('.canvas-controls')!
          .getBoundingClientRect();
        const logs = document
          .querySelector('.editor-bottom-left')!
          .getBoundingClientRect();
        return {
          card: {
            left: card.left,
            right: card.right,
            top: card.top,
            bottom: card.bottom,
          },
          main: {
            left: main.left,
            right: main.right,
            top: main.top,
            bottom: main.bottom,
          },
          controls: {
            left: controls.left,
            right: controls.right,
            top: controls.top,
          },
          logs: { right: logs.right },
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(bounds.card.left).toBeGreaterThanOrEqual(bounds.main.left);
      expect(bounds.card.right).toBeLessThanOrEqual(bounds.main.right);
      expect(bounds.card.top).toBeGreaterThanOrEqual(bounds.main.top);
      expect(bounds.card.bottom).toBeLessThan(bounds.controls.top);
      expect(bounds.logs.right).toBeLessThanOrEqual(bounds.controls.left);
      expect(bounds.controls.right).toBeLessThanOrEqual(width);
      expect(bounds.scrollWidth).toBe(width);
      await page.screenshot({
        path: info.outputPath(`empty-${theme}-${width}.png`),
      });
    }
  }
});

test('100-node import remains interactive and searchable', async ({ page }) => {
  const doc = sampleDocument();
  const prototype = doc.nodes[1]!;
  doc.nodes = Array.from({ length: 100 }, (_, i) => ({
    ...prototype,
    id: `service-${i}`,
    name: `Service ${i}`,
  }));
  doc.edges = [];
  doc.views[0]!.nodeIds = doc.nodes.map((n) => n.id);
  doc.views[0]!.layout = Object.fromEntries(
    doc.nodes.map((n, i) => [
      n.id,
      { x: (i % 10) * 300, y: Math.floor(i / 10) * 220 },
    ]),
  );
  await ready(page);
  await page.getByLabel('Import architecture JSON').setInputFiles({
    name: 'large.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await page.getByRole('button', { name: 'Import and replace draft' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(100);
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page.getByLabel('Search objects').fill('Service 99');
  await expect(page.locator('#object-list button')).toHaveCount(1);
  await selectObject(page, 'Service 99');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Service 99',
  );
  await page
    .getByRole('spinbutton', { name: 'Replicas', exact: true })
    .fill('4');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect
    .poll(
      async () =>
        (await stored(page)).nodes.find(
          (n: { id: string }) => n.id === 'service-99',
        )?.configuration.replicas,
    )
    .toBe(4);
});
test('drag changes layout only and commits a single undo step', async ({
  page,
}) => {
  await ready(page);
  const before = await stored(page);
  const card = page.locator('.react-flow__node[data-id="client"]');
  const box = await card.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 80, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 130, box!.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await stored(page)).views[0]!.layout.client!.x)
    .not.toBe(before.views[0]!.layout.client!.x);
  const after = await stored(page);
  expect(after.nodes).toEqual(before.nodes);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await stored(page)).views[0]!.layout.client!)
    .toEqual(before.views[0]!.layout.client!);
});
test('compatible connection creation and incompatible port feedback', async ({
  page,
}) => {
  const doc = sampleDocument();
  doc.edges = [];
  const serialized = JSON.stringify(doc);
  await page.addInitScript(
    ({ key, serialized }) => localStorage.setItem(key, serialized),
    { key, serialized },
  );
  await ready(page);
  async function connect(from: string, to: string) {
    const a = await page.getByLabel(from, { exact: true }).boundingBox();
    const b = await page.getByLabel(to, { exact: true }).boundingBox();
    expect(a && b).toBeTruthy();
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
    await page.mouse.down();
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
  }
  await connect(
    'Storefront API: Dependencies',
    'Primary database: Connections',
  );
  await expect.poll(async () => (await stored(page)).edges.length).toBe(1);
  expect((await stored(page)).edges[0]!.relationship).toBe(
    'database-connection',
  );
  await connect('Web application: Requests', 'Primary database: Connections');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /at least|Import rejected|Export JSON|incompatible/ }),
  ).toContainText('incompatible');
  expect((await stored(page)).edges).toHaveLength(1);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page
    .getByRole('group', { name: 'Edge from service to database' })
    .click();
  await page
    .getByRole('button', { name: 'Delete connection', exact: true })
    .click();
  await expect.poll(async () => (await stored(page)).edges.length).toBe(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
});

test('fresh editor matches the catalog-first layout and supports search and custom components', async ({
  page,
}) => {
  await ready(page, false);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(
    page.getByRole('complementary', { name: 'Component catalog' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Zoom controls' }),
  ).toContainText('92%');
  await page.getByLabel('Search component catalog').fill('queue');
  await page.getByRole('button', { name: 'Add Queue', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.getByRole('button', { name: 'New custom component' }).click();
  await page.getByLabel('Custom component name').fill('Payment service');
  await page.getByLabel('Base primitive').selectOption('core.service');
  await page
    .getByRole('button', { name: 'Create component', exact: true })
    .click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Payment service',
  );
  await expect
    .poll(async () =>
      (await stored(page)).components.some(
        (c: { name: string }) => c.name === 'Payment service',
      ),
    )
    .toBe(true);
});
test('canvas locking prevents layout movement and logs show actual saved work', async ({
  page,
}) => {
  await ready(page);
  const original = await stored(page);
  await page.getByRole('button', { name: 'Lock canvas', exact: true }).click();
  const box = await page
    .locator('.react-flow__node[data-id="client"]')
    .boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 80, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 130, box!.y + 90, { steps: 8 });
  await page.mouse.up();
  expect((await stored(page)).views[0]!.layout.client!).toEqual(
    original.views[0]!.layout.client!,
  );
  await page
    .getByRole('button', { name: 'Unlock canvas', exact: true })
    .click();
  await page.getByRole('button', { name: 'Logs', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Activity log' }),
  ).toContainText('Saved draft');
});
