import { expect, Page, test } from '@playwright/test';

const open = async (page: Page, qs = '?autoplay=0') => {
  await page.goto(qs);
  await expect(page.getByTestId('banner')).toBeVisible();
};
const num = async (page: Page, id: string) => Number(await page.getByTestId(id).innerText());
const steps = async (page: Page, n: number) => {
  for (let i = 0; i < n; i++) await page.getByTestId('step').click();
};

test('첫 화면에 시뮬레이션·합성 데이터·의료 조언 아님이 항상 보이고 콘솔 오류가 없다', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.getByTestId('banner')).toContainText('브라우저 시뮬레이션');
  await expect(page.getByTestId('banner')).toContainText('합성 데이터');
  await expect(page.getByTestId('banner')).toContainText('의료 조언 아님');
  await steps(page, 12);
  expect(errors).toEqual([]);
});

test('1틱씩 진행하면 곡선·타임라인·파이프라인 카운터가 늘어난다', async ({ page }) => {
  await open(page);
  expect(await num(page, 's-stored')).toBe(0);
  await steps(page, 9);
  expect(await num(page, 's-stored')).toBeGreaterThan(0);
  expect(Number(await page.getByTestId('chart').getAttribute('data-points'))).toBe(9);
  await expect(page.getByTestId('timeline').locator('li')).not.toHaveCount(0);
  await expect(page.getByTestId('t-readings')).not.toHaveText('—');
});

test('중복 재전송은 저장 수를 늘리지 않고 중복 차단만 늘린다', async ({ page }) => {
  await open(page);
  await steps(page, 12);
  const stored = await num(page, 'c-stored');
  await page.getByTestId('dup').click();
  expect(await num(page, 'c-stored')).toBe(stored);
  expect(await num(page, 'c-dup')).toBe(12);
});

test('오프라인으로 보관한 묶음을 늦게 보내면 곡선의 빈 구간이 채워지고 순서 역전 반영이 집계된다', async ({ page }) => {
  await open(page);
  await steps(page, 6);
  await page.getByTestId('offline').click();
  await steps(page, 12);
  const before = Number(await page.getByTestId('chart').getAttribute('data-points'));
  await expect(page.getByTestId('release')).toBeEnabled();
  await page.getByTestId('release').click();
  const after = Number(await page.getByTestId('chart').getAttribute('data-points'));
  expect(after).toBeGreaterThan(before);
  expect(await num(page, 'c-ooo')).toBeGreaterThan(0);
});

test('소비자 실패를 주입하면 재시도 끝에 dead-letter 가 쌓이고, 해제 후 재처리하면 요약이 나온다', async ({ page }) => {
  await open(page);
  await page.getByTestId('fail').click();
  await steps(page, 14);
  expect(await num(page, 'c-retry')).toBeGreaterThan(0);
  expect(await num(page, 'c-dlq')).toBeGreaterThan(0);
  await expect(page.getByTestId('t-avg')).toHaveText('—');
  await page.getByTestId('fail').click();
  await page.getByTestId('replay').click();
  await expect(page.getByTestId('t-avg')).not.toHaveText('—');
  expect(await num(page, 's-dlq')).toBe(0);
});

test('병의원 조회는 동의가 있어야 200 이고, 철회하면 바로 404 이며 감사 로그에 남는다', async ({ page }) => {
  await open(page);
  await steps(page, 12);
  await page.getByTestId('clinic-view').click();
  await expect(page.getByTestId('clinic-result')).toContainText('200');
  await page.getByTestId('consent').uncheck();
  await page.getByTestId('clinic-view').click();
  await expect(page.getByTestId('clinic-result')).toContainText('404');
  const rows = page.getByTestId('audit').locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('거부');
  await expect(rows.nth(1)).toContainText('허용');
});

test('재생하면 가상 시계가 저절로 흐르고 일시정지하면 멈춘다', async ({ page }) => {
  await open(page);
  await page.getByRole('radio', { name: '64×' }).click();
  await page.getByTestId('play').click();
  await expect.poll(() => num(page, 's-stored')).toBeGreaterThan(5);
  await page.getByTestId('play').click();
  const a = await num(page, 's-stored');
  await page.waitForTimeout(400);
  expect(await num(page, 's-stored')).toBe(a);
});

test('어두운 화면 전환은 유지되고 모바일 폭에서도 가로로 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await steps(page, 20);
  await page.getByTestId('theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
