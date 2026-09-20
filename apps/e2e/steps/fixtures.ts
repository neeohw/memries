import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd, test as base } from 'playwright-bdd';

export const test = base.extend({});

const e2eRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const prepareScript = join(e2eRoot, 'scripts', 'prepare-fixtures.mjs');

let restoreFixturesAfterTest = false;

export function markFixturesDirty() {
  restoreFixturesAfterTest = true;
}

export function runPrepareFixtures(args: string[] = []) {
  const result = spawnSync(process.execPath, [prepareScript, ...args], {
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
    await login.fill('admin@example.com');
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

export async function revealPhoto(page: Page, day: string): Promise<Locator> {
  const photo = photoByDay(page, day).first();
  const timeline = page.locator('[data-timeline]').first();
  const hasTimeline = (await timeline.count()) > 0;
  if (!hasTimeline) {
    await expect(photo).toBeVisible();
    await photo.evaluate((el) => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
    return photo;
  }
  const count = Number((await timeline.getAttribute('data-group-count').catch(() => '0')) || 0);
  const steps = Math.max(count, 24);
  for (let i = 0; i < steps; i += 1) {
    if (await photo.isVisible().catch(() => false)) {
      await photo.evaluate((el) => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
      return photo;
    }
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
  await expect(photo).toBeVisible();
  await photo.evaluate((el) => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
  return photo;
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
