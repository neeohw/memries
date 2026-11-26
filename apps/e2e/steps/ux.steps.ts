import { expect } from '@playwright/test';
import {
  Given,
  Then,
  When,
  openTab,
  photoActionsDialog,
  photoByDay,
  photoViewer,
} from './fixtures';

Given('I prefer reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

Given('I prefer a dark color scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
});

Given('I prefer a light color scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
});

Given('I have no saved theme', async ({ page }) => {
  await page.addInitScript(() => {
    const flag = 'memries-theme-cleared-once';
    if (!sessionStorage.getItem(flag)) {
      localStorage.removeItem('memries-theme');
      sessionStorage.setItem(flag, '1');
    }
  });
});

When('I press {string}', async ({ page }, key: string) => {
  await page.keyboard.press(key);
});

When('I open the viewer album picker', async ({ page }) => {
  await page.getByRole('button', { name: 'Add to album', exact: true }).click();
});

When('I swipe the viewer left', async ({ page }) => {
  await dragViewer(page, -90, 0);
});

When('I swipe the viewer right', async ({ page }) => {
  await dragViewer(page, 90, 0);
});

When('I drag the viewer a short way left', async ({ page }) => {
  await dragViewer(page, -24, 0);
});

When('I drag the viewer down to dismiss', async ({ page }) => {
  await dragViewer(page, 0, 130);
});

When('I switch the theme', async ({ page }) => {
  const toggle = page.locator('[data-theme-toggle]').filter({ visible: true });
  const next = (await toggle.getAttribute('aria-label'))?.includes('dark') ? 'dark' : 'light';
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', next);
});

// Scan on the Folders page is the only trigger in the interface: the splash
// no longer starts a run on its own and the timeline has no sync button
// (ADR 0004).
When('I start a folder sync', async ({ page }) => {
  await openTab(page, 'Folders');
  await page.getByRole('button', { name: 'Scan now' }).first().click();
  await expect(page.locator('[data-indexing-splash]')).toBeVisible();
});

When('I start a new album', async ({ page }) => {
  await openTab(page, 'Albums');
  await page.getByRole('button', { name: 'New album' }).click();
});

Then('the photo actions menu is closed', async ({ page }) => {
  await expect(photoActionsDialog(page)).toHaveCount(0);
});

Then('the viewer shows the photo from {string}', async ({ page }, day: string) => {
  await expect(photoViewer(page)).toHaveAttribute('data-viewer-day', day);
});

Then('the viewer photo is a favorite', async ({ page }) => {
  const viewer = photoViewer(page);
  await expect(viewer).toHaveAttribute('data-viewer-favorite', 'true');
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
});

Then('the viewer photo is not a favorite', async ({ page }) => {
  const viewer = photoViewer(page);
  await expect(viewer).toHaveAttribute('data-viewer-favorite', 'false');
  await expect(page.getByRole('button', { name: 'Add to favorites' })).toBeVisible();
});

Then('focus stays inside the photo viewer', async ({ page }) => {
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][data-viewer-day]');
    return !!dialog && dialog.contains(document.activeElement);
  });
  expect(inside).toBe(true);
});

Then('the photo from {string} is focused', async ({ page }, day: string) => {
  await expect(photoByDay(page, day).first()).toBeFocused();
});

Then('the photo viewer opened from a photo card', async ({ page }) => {
  await expect(photoViewer(page)).toHaveAttribute('data-origin', 'card');
});

Then('the photo viewer should skip motion', async ({ page }) => {
  const viewer = photoViewer(page);
  await expect(viewer).toHaveAttribute('data-reduced-motion', 'true');
  await expect(viewer).toHaveAttribute('data-viewer-motion', 'reduced');
});

Then('the timeline should skip motion', async ({ page }) => {
  await expect(page.locator('[data-timeline]')).toHaveAttribute('data-timeline-motion', 'none');
});

Then('I should see the Today control', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Back to today' })).toBeVisible();
});

Then('the library is in dark mode', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

Then('the library is in light mode', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

Then('I should see the Index run splash', async ({ page }) => {
  await expect(page.locator('[data-indexing-splash]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Indexing your files' })).toBeVisible();
});

Then('the main navigation should match this viewport', async ({ page }) => {
  const width = await page.evaluate(() => window.innerWidth);
  if (width >= 800) {
    await expect(page.locator('[data-nav-layout="side"]')).toBeVisible();
  } else {
    await expect(page.locator('[data-nav-layout="bottom"]')).toBeVisible();
  }
});

Then('I should not see the album page', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Back to albums' })).toHaveCount(0);
});

Then('I should see the empty favorites state', async ({ page }) => {
  await expect(page.locator('[data-empty="favorites"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing favorited yet' })).toBeVisible();
});

When('I open an empty album named {string}', async ({ page }, name: string) => {
  await openTab(page, 'Albums');
  await page.getByRole('button', { name: 'New album' }).click();
  await page.getByLabel('Album name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`Open album ${name}`) }).click();
  await expect(page.getByRole('button', { name: 'Back to albums' })).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
});

Then('I should see the empty album state', async ({ page }) => {
  await expect(page.getByText('No photos in this album yet.', { exact: true })).toBeVisible();
});

Then('I should see the empty albums list', async ({ page }) => {
  await expect(page.getByRole('status').filter({ hasText: 'No albums yet.' })).toBeVisible();
});

Then('the year facet {string} is selected', async ({ page }, year: string) => {
  await expect(page.getByRole('button', { name: year, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

Then('the year facet {string} is not selected', async ({ page }, year: string) => {
  await expect(page.getByRole('button', { name: year, exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

Then('the album name field is focused', async ({ page }) => {
  await expect(page.getByLabel('Album name')).toBeFocused();
});

async function dragViewer(page: import('@playwright/test').Page, dx: number, dy: number) {
  const stage = page.locator('[data-viewer-stage]');
  await expect(stage).toBeVisible();
  const box = await stage.boundingBox();
  if (!box) throw new Error('viewer stage has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}
