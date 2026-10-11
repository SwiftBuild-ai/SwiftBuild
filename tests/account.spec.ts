import { test, expect } from '@playwright/test';
test('local-only account screens preserve access to the draft', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { name: 'Sign in to SwiftBuild' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Server accounts have not been configured',
  );
  await page.getByRole('link', { name: 'Open local draft' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Editor tools' }),
  ).toBeVisible();
});
test('incomplete invitation and recovery links explain the operator path', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/invite?token=invalid');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'invitation link is incomplete',
  );
  await page.goto('/reset-password');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'one-time recovery link',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
