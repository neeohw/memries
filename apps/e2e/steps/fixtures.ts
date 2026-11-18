import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd, test as base } from 'playwright-bdd';
import { ownerEmail } from '../scripts/owners.mjs';

export const test = base.extend({});

const e2eRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const prepareScript = join(e2eRoot, 'scripts', 'prepare-fixtures.mjs');

/**
 * The account this worker owns (ADR 0012).
 *
 * `parallelIndex`, not `workerIndex`: a worker that is restarted after a crash
 * gets a fresh `workerIndex` but keeps its parallel slot, so this stays within
 * the accounts the stack bootstrapped.
 */
export function currentOwner(): string {
  return ownerEmail(test.info().parallelIndex);
}

let restoreFixturesAfterTest = false;

export function markFixturesDirty() {
  restoreFixturesAfterTest = true;
}

/**
 * Runs the fixture script against this worker's own photo folder.
 *
 * Module state is per worker process, as is the folder, so a scenario that
 * removes or relocates a photo cannot disturb a scenario running beside it.
 *
 * The default is `prepare-owner`, not the script's own default: bare
 * `prepare-fixtures` rebuilds *every* worker's folder, which is right at stack
 * up and destructive from inside a running scenario.
 */
export function runPrepareFixtures(args: string[] = ['prepare-owner']) {
  const result = spawnSync(process.execPath, [prepareScript, ...args, '--owner', currentOwner()], {
    encoding: 'utf8',
    cwd: e2eRoot,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'prepare-fixtures failed');
  }
}

async function indexStatus(page: Page): Promise<string> {
  const res = await page.request.get('/api/index/status');
  if (!res.ok()) return `http-${res.status()}`;
  const body = (await res.json()) as { status?: string };
  return body.status ?? '';
}

async function reindexOwner(page: Page) {
  const started = await page.request.post('/api/index');
  if (!started.ok() && started.status() !== 202) {
    throw new Error(`index start failed: ${started.status()} ${await started.text()}`);
  }
  await expect.poll(() => indexStatus(page), { timeout: 120_000 }).toMatch(/^complete/);
}

async function resetLibrary(page: Page) {
  const res = await page.request.post('/api/e2e/reset');
  if (!res.ok()) {
    throw new Error(`e2e reset failed: ${res.status()} ${await res.text()}`);
  }
}

export const { Given, When, Then, After } = createBdd(test);

After({ timeout: 180_000 }, async ({ page }) => {
  if (restoreFixturesAfterTest) {
    runPrepareFixtures();
    restoreFixturesAfterTest = false;
    await reindexOwner(page);
  }
  await resetLibrary(page);
});

export async function signIn(page: Page) {
  await page.goto('/');
  const login = page.locator('input[name="login"]');
  try {
    await login.waitFor({ state: 'visible', timeout: 20_000 });
    await login.fill(currentOwner());
    await page.locator('input[name="password"]').fill('password');
    await page.locator('[type="submit"]').first().click();
  } catch {
    // Session cookie already present, or the splash is already showing.
  }
  await expect(page.getByRole('heading', { name: 'Your memries' })).toBeVisible({
    timeout: 120_000,
  });
}

export async function openTab(page: Page, tab: string) {
  await page.getByRole('button', { name: tab, exact: true }).filter({ visible: true }).click();
}

export function photoByDay(page: Page, day: string): Locator {
  return page.getByRole('button', {
    name: new RegExp(`Open (favorited )?photo, ${escapeRegExp(day)}`),
  });
}

/** Viewer dialog is labelled by the capture title, not a fixed "Photo viewer" name. */
export function photoViewer(page: Page): Locator {
  return page.locator('[role="dialog"][data-viewer-day]');
}

export function photoActionsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Photo actions' });
}

export function albumOpenButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name: new RegExp(`Open album ${escapeRegExp(name)}`) });
}

type TimelineEl = HTMLElement & { __scrollToGroup?: (index: number) => void };

export async function scrollTimeline(page: Page, dy: number) {
  const timeline = page.locator('[data-timeline]').first();
  if (!(await timeline.count())) return;
  await timeline.evaluate((root, delta) => {
    const el = root as TimelineEl;
    const count = Number(el.getAttribute('data-group-count') || 0);
    if (el.__scrollToGroup && count > 0) {
      const current = Number(el.getAttribute('data-start-index') || 0);
      const next = delta < 0 ? 0 : Math.min(count - 1, current + 1);
      el.setAttribute('data-start-index', String(next));
      el.__scrollToGroup(next);
      return;
    }
    const nodes = [root, ...[...root.querySelectorAll('*')].reverse()];
    const scroller = nodes.find(
      (node) => node instanceof HTMLElement && node.scrollHeight - node.clientHeight > 8,
    );
    (scroller ?? root).scrollBy(0, delta);
  }, dy);
}

/**
 * Whether the photo is on screen and the timeline is showing its period.
 *
 * `isVisible()` alone is not enough, and used to be what `revealPhoto` stopped
 * on: `virtua` renders an overscan band outside the viewport and Playwright
 * calls an element visible as soon as it has a non-empty box, so the loop
 * could stop while a different group was still at the top of the list and
 * anything reading the pinned period label got a stale one.
 *
 * Two stopping points are correct, and they are the two the component itself
 * uses to pick that label: the photo's own section is the first one past the
 * scroller's top edge, or the list is scrolled to its end — where the final
 * group can never reach the top, because there is nothing below it to scroll
 * against.
 */
async function isCurrentGroup(photo: Locator): Promise<boolean> {
  if (!(await photo.count())) return false;
  return photo
    .evaluate((el) => {
      const root = el.closest('[data-timeline]');
      const own = el.closest('section[aria-labelledby^="period-"]');
      if (!root || !own) return false;

      const rootBox = root.getBoundingClientRect();
      const photoBox = el.getBoundingClientRect();
      const onScreen = photoBox.bottom > rootBox.top && photoBox.top < rootBox.bottom;
      if (!onScreen) return false;

      const sections = [...root.querySelectorAll('section[aria-labelledby^="period-"]')];
      const first = sections
        .filter((section) => section.getBoundingClientRect().bottom > rootBox.top + 1)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      if (first === own) return true;

      const scroller = [root, ...root.querySelectorAll('*')].find(
        (node) => node.scrollHeight - node.clientHeight > 8,
      );
      if (!scroller) return false;
      const atEnd = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2;
      return atEnd && own === sections[sections.length - 1];
    })
    .catch(() => false);
}

/**
 * Scrolls the timeline until the photo taken on `day` is the current group.
 *
 * Group by group, because the list is virtualized: the target may not be in
 * the DOM at all until the groups before it have been scrolled through. The
 * group count is re-read each pass, since reaching the end of the loaded
 * groups is what asks for the next page.
 */
export async function revealPhoto(page: Page, day: string): Promise<Locator> {
  const photo = photoByDay(page, day).first();
  const timeline = page.locator('[data-timeline]').first();
  const hasTimeline = (await timeline.count()) > 0;
  if (!hasTimeline) {
    await expect(photo).toBeVisible();
    await photo.evaluate((el) => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
    return photo;
  }

  const groupCount = async () =>
    Number((await timeline.getAttribute('data-group-count').catch(() => '0')) || 0);

  // A hard ceiling so a library that keeps loading cannot spin here forever.
  const maxSteps = 200;
  for (let i = 0; i < maxSteps; i += 1) {
    if (await isCurrentGroup(photo)) return photo;
    const count = await groupCount();
    if (i >= Math.max(count, 24)) break;
    if (count > 0) {
      await timeline.evaluate((root, index) => {
        const el = root as TimelineEl;
        el.setAttribute('data-start-index', String(index));
        el.__scrollToGroup?.(index);
      }, i);
    } else {
      await scrollTimeline(page, 400);
    }
  }

  if (await isCurrentGroup(photo)) return photo;
  // Never found at all and found but never current are different failures;
  // they used to be reported as one.
  await expect(photo, `no photo from ${day} in the timeline`).toBeVisible();
  throw new Error(`scrolled the timeline but ${day} never became the current group`);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function collectTimelineLabels(page: Page): Promise<string[]> {
  const timeline = page.locator('[data-timeline]');
  await expect(timeline).toBeVisible();
  const seen = new Set<string>();
  const order: string[] = [];
  for (let i = 0; i < 24; i += 1) {
    const labels = await timeline
      .getByRole('button', { name: /Open / })
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    for (const label of labels) {
      if (label && !seen.has(label)) {
        seen.add(label);
        order.push(label);
      }
    }
    await scrollTimeline(page, 320);
  }
  return order;
}
