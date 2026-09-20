import { expect, type Page } from '@playwright/test';
import {
  Given,
  Then,
  When,
  albumOpenButton,
  collectTimelineLabels,
  markFixturesDirty,
  openTab,
  photoActionsDialog,
  photoByDay,
  photoViewer,
  revealPhoto,
  runPrepareFixtures,
  scrollTimeline,
  signIn,
} from './fixtures';

const originalRequests = new WeakMap<Page, string[]>();

function originalsFor(page: Page): string[] {
  let list = originalRequests.get(page);
  if (!list) {
    list = [];
    originalRequests.set(page, list);
    page.on('request', (req) => {
      if (req.url().includes('/api/original/')) list.push(req.url());
    });
  }
  return list;
}

When('I group memories by {string}', async ({ page }, granularity: string) => {
  await page.getByRole('radio', { name: granularity, exact: true }).click();
});

When('I go back to today', async ({ page }) => {
  const today = page.getByRole('button', { name: 'Back to today' });
  if (await today.isVisible().catch(() => false)) {
    await today.click();
    return;
  }
  await scrollTimeline(page, -10_000);
});

Then('I should see the period heading {string}', async ({ page }, label: string) => {
  const heading = page.getByRole('heading', { name: label, exact: true });
  for (let i = 0; i < 16; i += 1) {
    if (await heading.isVisible().catch(() => false)) break;
    await scrollTimeline(page, 320);
  }
  await expect(heading).toBeVisible();
});

Then('the current period should be {string}', async ({ page }, label: string) => {
  await expect(page.getByLabel('Current period')).toHaveText(label);
});

When('I scroll until I see the memory from {string}', async ({ page }, day: string) => {
  await revealPhoto(page, day);
});

Then(
  'memories should appear in this capture order:',
  async ({ page }, table: { raw: () => string[][] }) => {
    const expected = table
      .raw()
      .map((row) => row[0])
      .filter(Boolean);
    const labels = await collectTimelineLabels(page);
    const found = expected.map((day: string) => {
      const index = labels.findIndex((label: string) => label.includes(day));
      expect(index, `missing memory from ${day}`).toBeGreaterThanOrEqual(0);
      return index;
    });
    for (let i = 1; i < found.length; i += 1) {
      expect(found[i], `${expected[i]} should follow ${expected[i - 1]}`).toBeGreaterThan(
        found[i - 1],
      );
    }
  },
);

Then('the first memory should be from {string}', async ({ page }, day: string) => {
  const labels = await collectTimelineLabels(page);
  expect(labels[0] ?? '').toContain(day);
});

Given('today is {int} August {int}', async ({ page }, day: number, year: number) => {
  const stamp = parseLibraryClock(`${day} August ${year}`);
  await page.addInitScript((fixed) => {
    const RealDate = Date;
    const frozen = new RealDate(fixed).valueOf();
    class FrozenDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(frozen);
        else super(...(args as []));
      }
      static now() {
        return frozen;
      }
    }
    FrozenDate.UTC = RealDate.UTC;
    FrozenDate.parse = RealDate.parse;
    window.Date = FrozenDate as DateConstructor;
  }, stamp);
});

When('I open the Filter on memories', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
});

When('I search for {string}', async ({ page }, phrase: string) => {
  const field = page.getByRole('searchbox', { name: 'Search memories' });
  await field.fill(phrase);
});

When('I choose the search suggestion {string}', async ({ page }, chip: string) => {
  await page.getByRole('button', { name: chip, exact: true }).click();
});

Then('I should see the heading {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
});

Then('I should see the search suggestions', async ({ page }) => {
  await expect(page.getByRole('list', { name: 'Search suggestions' })).toBeVisible();
});

Then('the search should read {string}', async ({ page }, reading: string) => {
  await expect(page.getByRole('status').filter({ hasText: reading })).toBeVisible();
});

Then('I should see the photo from {string} in search results', async ({ page }, day: string) => {
  await expect(photoByDay(page, day).first()).toBeVisible();
});

Then(
  'I should not see the photo from {string} in search results',
  async ({ page }, day: string) => {
    await expect(photoByDay(page, day)).toHaveCount(0);
  },
);

Then('I should see no matching search results', async ({ page }) => {
  await expect(page.getByText('No memories match that search.', { exact: true })).toBeVisible();
});

When('I search for year {string}', async ({ page }, year: string) => {
  await openTab(page, 'Search');
  const yearButton = page.getByRole('button', { name: year, exact: true });
  if (!(await yearButton.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Years', exact: true }).click();
  }
  await yearButton.click();
});

When('I filter search to favorites', async ({ page }) => {
  await openTab(page, 'Search');
  await page
    .getByRole('button', { name: 'Favorites', exact: true })
    .and(page.locator('[aria-pressed]'))
    .click();
});

Then('I should see {int} search results', async ({ page }, count: number) => {
  const label = count === 1 ? '1 result' : `${count} results`;
  await expect(page.getByText(label, { exact: true })).toBeVisible();
});

When('I create an album named {string}', async ({ page }, name: string) => {
  await openTab(page, 'Albums');
  await page.getByRole('button', { name: 'New album' }).click();
  await page.getByLabel('Album name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(albumOpenButton(page, name)).toBeVisible();
});

When('I open the album named {string}', async ({ page }, name: string) => {
  await openTab(page, 'Albums');
  await albumOpenButton(page, name).click();
  await expect(page.getByRole('button', { name: 'Back to albums' })).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
});

Then('I should see the photo from {string} on the album page', async ({ page }, day: string) => {
  await expect(photoByDay(page, day).first()).toBeVisible();
});

Given('I am watching media requests', async ({ page }) => {
  originalsFor(page);
});

Then('compact thumbnails should use the size for this viewport', async ({ page }) => {
  const width = await page.evaluate(() => window.innerWidth);
  const size = width >= 1280 ? '256' : '512';
  const imgs = page.locator('img[src*="/api/thumb/"][src*="size="]');
  await expect(imgs.first()).toBeVisible();
  const count = await imgs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const src = await imgs.nth(i).getAttribute('src');
    expect(src, src ?? '').toContain(`size=${size}`);
    expect(src, src ?? '').not.toContain('/api/original/');
  }
});

Then('no original image has been requested', async ({ page }) => {
  expect(originalsFor(page)).toEqual([]);
});

Then('the original image is requested', async ({ page }) => {
  await expect.poll(() => originalsFor(page).length).toBeGreaterThan(0);
});

Then('the actions menu offers to remove from this album', async ({ page }) => {
  await expect(
    photoActionsDialog(page).getByRole('button', { name: 'Remove from this album' }),
  ).toBeVisible();
  await expect(photoActionsDialog(page).getByRole('group', { name: 'Add to album' })).toHaveCount(
    0,
  );
});

When('I remove the photo from this album', async ({ page }) => {
  await photoActionsDialog(page).getByRole('button', { name: 'Remove from this album' }).click();
});

Then(
  'the album {string} should have {int} photos',
  async ({ page }, name: string, count: number) => {
    await openTab(page, 'Albums');
    const label = count === 1 ? '1 photo' : `${count} photos`;
    const card = page.locator('article').filter({
      has: page.getByRole('button', { name: new RegExp(`Open album ${name}, ${label}`) }),
    });
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  },
);

When('I open the photo from {string}', async ({ page }, day: string) => {
  const search = page.getByRole('heading', { name: 'Search', exact: true });
  if (await search.isVisible().catch(() => false)) {
    const photo = photoByDay(page, day).first();
    await expect(photo).toBeVisible();
    await photo.click();
    await expect(photoViewer(page)).toBeVisible();
    return;
  }
  await openTab(page, 'Memories');
  const photo = await revealPhoto(page, day);
  await photo.click();
  await expect(photoViewer(page)).toBeVisible();
});

Then('the photo viewer is open', async ({ page }) => {
  await expect(photoViewer(page)).toBeVisible();
});

Then('the photo viewer is closed', async ({ page }) => {
  await expect(photoViewer(page)).toHaveCount(0);
});

When('I add the viewer photo to favorites', async ({ page }) => {
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
});

When('I add the viewer photo to album {string}', async ({ page }, name: string) => {
  await page.getByRole('button', { name: 'Add to album', exact: true }).click();
  await expect(photoActionsDialog(page)).toBeVisible();
  await photoActionsDialog(page)
    .getByRole('button', { name: new RegExp(`Add to album ${name}`) })
    .click();
});

When('I go to the next photo', async ({ page }) => {
  await page.getByRole('button', { name: 'Next photo' }).click();
});

When('I go to the previous photo', async ({ page }) => {
  await page.getByRole('button', { name: 'Previous photo' }).click();
});

When('I close the photo viewer', async ({ page }) => {
  await page.getByRole('button', { name: 'Close photo' }).click();
});

When('I long-press the photo from {string}', async ({ page }, day: string) => {
  const photo = await revealPhoto(page, day);
  const box = await photo.boundingBox();
  if (!box) throw new Error(`no bounding box for ${day}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  const menu = photoActionsDialog(page);
  if (!(await menu.isVisible().catch(() => false))) {
    await photo.click({ button: 'right' });
  }
  await expect(menu).toBeVisible();
});

Then('the photo actions menu is visible', async ({ page }) => {
  await expect(photoActionsDialog(page)).toBeVisible();
});

Then(
  'album {string} in the actions menu shows {int} on the right',
  async ({ page }, name: string, count: number) => {
    const item = photoActionsDialog(page).getByRole('button', {
      name: new RegExp(`Add to album ${name}, ${count} photo`),
    });
    await expect(item).toBeVisible();
    await expect(item).toContainText(name);
    await expect(item).toContainText(String(count));
    const nameBox = await item.locator('span').filter({ hasText: name }).first().boundingBox();
    const countBox = await item
      .locator('span')
      .filter({ hasText: String(count) })
      .last()
      .boundingBox();
    if (!nameBox || !countBox) throw new Error(`missing layout boxes for album ${name}`);
    expect(countBox.x, 'album count should sit to the right of the name').toBeGreaterThan(
      nameBox.x,
    );
  },
);

When('I choose album {string} in the actions menu', async ({ page }, name: string) => {
  await photoActionsDialog(page)
    .getByRole('button', { name: new RegExp(`Add to album ${name}`) })
    .click();
});

When(
  'I change the capture date of {string} to {string}',
  async ({ page }, file: string, datetime: string) => {
    markFixturesDirty();
    runPrepareFixtures(['set-exif', file, datetime]);
    await signIn(page);
  },
);

When('I remove the photo {string}', async ({}, file: string) => {
  markFixturesDirty();
  runPrepareFixtures(['remove-photo', file]);
});

When('I relocate the photo {string} to {string}', async ({}, from: string, to: string) => {
  markFixturesDirty();
  runPrepareFixtures(['relocate-photo', from, to]);
});

When('I sync the folder', async ({ page }) => {
  await openTab(page, 'Memories');
  await page.getByRole('button', { name: 'Sync folder' }).click();
  await expect(page.getByRole('heading', { name: 'Your memries' })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByRole('heading', { name: 'Indexing your files' })).toHaveCount(0, {
    timeout: 120_000,
  });
});

Then('I should see a memory from {string}', async ({ page }, day: string) => {
  await expect(await revealPhoto(page, day)).toBeVisible();
});

Then('I should not see a memory from {string}', async ({ page }, day: string) => {
  await openTab(page, 'Memories');
  const labels = await collectTimelineLabels(page);
  expect(
    labels.some((label) => label.includes(day)),
    `did not expect a memory from ${day}, got ${labels.join(' | ')}`,
  ).toBe(false);
});

Then('the photo from {string} should be a favorite', async ({ page }, day: string) => {
  const photo = await revealPhoto(page, day);
  await expect(photo).toHaveAttribute('aria-label', /Open favorited photo/);
});

Given('the library fixtures are restored', async ({}) => {
  runPrepareFixtures();
});

const LIBRARY_CLOCKS: Record<string, string> = {
  '26 August 2026': '2026-08-26T12:00:00.000Z',
};

function parseLibraryClock(day: string): string {
  const stamp = LIBRARY_CLOCKS[day];
  if (!stamp) throw new Error(`unknown library clock ${day}`);
  return stamp;
}
