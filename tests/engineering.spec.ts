import { test, expect, type Page } from '@playwright/test';
import { engineeringSampleDocument } from '../packages/components-core/src/index';
import type { ProjectArchive } from '../packages/canvas/src/workspace';
import { readFile } from 'node:fs/promises';
async function seed(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem('swiftbuild.theme', 'light'),
  );
  await page.addInitScript(
    (raw) => localStorage.setItem('swiftbuild.draft.v1', raw),
    JSON.stringify(engineeringSampleDocument()),
  );
  await page.goto('/');
  await expect(page.locator('.statusbar').getByRole('status')).toHaveText(
    'Saved locally',
  );
}
async function workspace(page: Page) {
  return page.evaluate(
    () =>
      new Promise<ProjectArchive>((resolve, reject) => {
        const open = indexedDB.open('swiftbuild-workspace', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db
            .transaction('workspace', 'readonly')
            .objectStore('workspace')
            .get('current');
          read.onsuccess = () => {
            resolve(read.result);
            db.close();
          };
          read.onerror = () => reject(read.error);
        };
      }),
  );
}
async function section(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name, exact: true })
    .click();
}
test('requirements, decisions, recoverable checkpoints and undo remain linked', async ({
  page,
}) => {
  await seed(page);
  await section(page, 'Requirements');
  await page.getByRole('button', { name: 'Add requirement' }).click();
  const requirement = page.getByRole('dialog', {
    name: 'Requirement',
    exact: true,
  });
  await requirement.getByLabel('Title', { exact: true }).fill('Fast checkout');
  await requirement
    .getByLabel('Description', { exact: true })
    .fill('Checkout remains reviewable under peak traffic.');
  await requirement.getByLabel('Storefront API', { exact: true }).check();
  await requirement.getByRole('button', { name: 'Save requirement' }).click();
  await expect(
    page.getByRole('heading', { name: 'Fast checkout' }),
  ).toBeVisible();
  await section(page, 'Decisions');
  await page.getByRole('button', { name: 'Add decision' }).click();
  const decision = page.getByRole('dialog', { name: 'Architecture decision' });
  await decision
    .getByLabel('Title', { exact: true })
    .fill('Separate checkout processing');
  await decision
    .getByLabel('Context', { exact: true })
    .fill('Checkout needs explicit dependencies.');
  await decision
    .getByLabel('Alternatives (one per line)', { exact: true })
    .fill('Shared service\nDedicated service');
  await decision
    .getByLabel('Rationale', { exact: true })
    .fill('Keep workload assumptions inspectable.');
  await decision
    .getByLabel('Consequences', { exact: true })
    .fill('Additional operational responsibility.');
  await decision.getByLabel('Fast checkout', { exact: true }).check();
  await decision.getByRole('button', { name: 'Save decision' }).click();
  await section(page, 'History');
  await page.getByLabel('Checkpoint name').fill('Before API change');
  await page.getByRole('button', { name: 'Save checkpoint' }).click();
  await expect
    .poll(async () => (await workspace(page)).checkpoints.length)
    .toBe(1);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page
    .locator('#object-list')
    .getByRole('button', { name: 'Storefront API', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Changed API');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await section(page, 'History');
  await page
    .getByRole('button', { name: 'Restore checkpoint', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await workspace(page)).document.nodes.find((n) => n.id === 'service')!
          .name,
    )
    .toBe('Storefront API');
  await expect
    .poll(async () => (await workspace(page)).checkpoints.length)
    .toBe(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await workspace(page)).document.nodes.find((n) => n.id === 'service')!
          .name,
    )
    .toBe('Changed API');
  const saved = await workspace(page);
  const r = saved.document.requirements.find(
    (r) => r.title === 'Fast checkout',
  )!;
  expect(
    saved.document.decisions.find(
      (d) => d.title === 'Separate checkout processing',
    )!.requirementIds,
  ).toContain(r.id);
  await page.reload();
  await section(page, 'History');
  await expect(
    page.getByRole('heading', { name: 'Before API change', exact: true }),
  ).toBeVisible();
});
test('worker simulation exposes evidence, validates targets and exports a project archive', async ({
  page,
}, info) => {
  await seed(page);
  await section(page, 'Capacity');
  await page
    .getByText('Simulation window and execution budget', { exact: true })
    .click();
  await page.getByLabel('Warm-up window', { exact: true }).fill('0');
  await page.getByLabel('Observation window', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Apply simulation settings' }).click();
  await page
    .getByRole('button', { name: 'Run simulation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Simulation results', exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await workspace(page)).runs.length).toBe(1);
  await page.getByRole('button', { name: /^P95 foreground latency/ }).click();
  await expect(page.getByRole('dialog')).toContainText('nearest-rank');
  await expect(page.getByRole('dialog')).toContainText('illustrative');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.screenshot({ path: info.outputPath('capacity-light.png') });
  await section(page, 'Validation');
  await expect(
    page.getByText('Model integrity verified', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .locator('.engineering-card')
      .filter({ hasText: 'capacity evidence is incomplete' }),
  ).toHaveCount(3);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Export architecture', exact: true })
    .click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export project archive' }).click();
  const download = await downloading,
    raw = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(raw).runs).toHaveLength(1);
  await page
    .getByLabel('Import project archive', { exact: true })
    .setInputFiles({
      name: 'archive.json',
      mimeType: 'application/json',
      buffer: Buffer.from(raw),
    });
  await page
    .getByRole('dialog', { name: 'Import project archive', exact: true })
    .getByRole('button', { name: 'Replace workspace' })
    .click();
  await expect
    .poll(async () => (await workspace(page)).runs[0]!.origin)
    .toBe('imported');
  await page
    .getByLabel('Import project archive', { exact: true })
    .setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{broken'),
    });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Archive rejected' }),
  ).toBeVisible();
  expect((await workspace(page)).document.nodes).toHaveLength(4);
});
test('capacity profile CSV, inspector tabs and keyboard connections work', async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole('button', { name: 'Architecture objects', exact: true })
    .click();
  await page
    .locator('#object-list')
    .getByRole('button', { name: 'Storefront API', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Capacity', exact: true }).click();
  const inspector = page.getByRole('complementary', {
    name: 'Component inspector',
  });
  await inspector
    .getByLabel('Import measurement CSV', { exact: true })
    .setInputFiles({
      name: 'samples.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('service_ms\n10\n20\n30'),
    });
  await inspector
    .getByRole('button', { name: 'Save capacity profile' })
    .click();
  await expect
    .poll(
      async () =>
        (await workspace(page)).document.performanceProfiles.find(
          (p) => p.nodeId === 'service',
        )!.serviceTime!.kind,
    )
    .toBe('empirical');
  await page.getByRole('tab', { name: 'Notes', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(
    page.getByRole('tab', { name: 'Capacity', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', {
    name: 'Connect architecture objects',
  });
  await dialog.getByLabel('Source object').selectOption('client');
  await dialog.getByLabel('Target object').selectOption('database');
  await dialog.getByRole('button', { name: 'Create connection' }).click();
  await expect(dialog.getByRole('alert')).toContainText('compatible');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('.react-flow__node[data-id="service"]').focus();
  const before = (await workspace(page)).document.views[0]!.layout.service!.x;
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(
      async () => (await workspace(page)).document.views[0]!.layout.service!.x,
    )
    .toBeGreaterThan(before);
});
test('engineering panels reflow at narrow widths with reduced motion and dark theme', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await section(page, 'Capacity');
  await expect(
    page.getByRole('button', { name: 'Run simulation', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('capacity-dark-narrow.png') });
  await section(page, 'Requirements');
  await expect(
    page.getByRole('heading', { name: 'Responsive storefront', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add requirement' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Add requirement' }),
  ).toBeFocused();
});
