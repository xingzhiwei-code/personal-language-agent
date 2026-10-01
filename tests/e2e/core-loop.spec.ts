import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage of the PRD §12 acceptance scenarios.
 * Runs with NO AI provider configured, which proves the core loop is local.
 * Tests run in order and share one database, like a real user session.
 */

const DATA_DIR = resolve(process.cwd(), '.e2e-data');

test.beforeAll(() => {
  // Fresh database for a true "new user" run.
  rmSync(DATA_DIR, { recursive: true, force: true });
});

async function addKnowledge(page: Page, entries: { text: string; meaning: string }[]) {
  for (const entry of entries) {
    await page.goto('/knowledge?new=1');
    await page.getByTestId('knowledge-text').fill(entry.text);
    await page.getByTestId('knowledge-meaning').fill(entry.meaning);
    await page.getByTestId('submit-knowledge').click();
    await expect(page.getByRole('status')).toContainText(/已添加|已存在/);
  }
}

const VOCAB = [
  { text: 'give up', meaning: '放弃' },
  { text: 'look after', meaning: '照顾' },
  { text: 'run into', meaning: '偶然遇到' },
  { text: 'put off', meaning: '推迟' },
  { text: 'come up with', meaning: '想出' },
];

/** The three question shapes, the feedback screen, and the summary. */
type Screen = 'typed' | 'choice' | 'selfRate' | 'answered' | 'summary';

async function probeScreen(page: Page): Promise<Screen | 'none'> {
  if (await page.getByRole('heading', { name: /总结/ }).count()) return 'summary';
  if (await page.getByTestId('submit-answer').count()) {
    return (await page.locator('button[aria-pressed]').count()) > 0 ? 'choice' : 'typed';
  }
  if (await page.getByRole('button', { name: '有点印象' }).count()) return 'selfRate';
  if (await page.getByTestId('next-activity').count()) return 'answered';
  return 'none';
}

/**
 * Waits until the learn page has settled into a known screen. Advancing
 * re-renders on the server, so the DOM is briefly empty or still shows the
 * previous screen; a single `count()` check would race. The screen must be
 * observed twice in a row before it is trusted.
 */
async function waitForScreen(page: Page): Promise<Screen> {
  let previous: Screen | 'none' = 'none';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await probeScreen(page);
    if (current !== 'none' && current === previous) return current;
    previous = current;
    await page.waitForTimeout(200);
  }
  throw new Error('learn page never settled into a known screen');
}

/** Advances past the feedback screen and waits for the next render to land. */
async function advance(page: Page): Promise<void> {
  const before = page.url();
  await page.getByTestId('next-activity').click({ noWaitAfter: true });
  await page
    .waitForURL((url) => url.toString() !== before, { timeout: 30_000 })
    .catch(() => {
      // Re-rendering the same URL is also a valid outcome (e.g. the summary).
    });
}

/** Answers the current question. `wrong: true` forces an incorrect answer. */
async function answerCurrent(page: Page, screen: Screen, wrong: boolean): Promise<void> {
  if (screen === 'typed') {
    await page.getByLabel('写出你的答案').fill(wrong ? 'zzz-not-the-answer' : 'figure out');
    await page.getByTestId('submit-answer').click();
    return;
  }
  if (screen === 'choice') {
    await page.locator('button[aria-pressed]').first().click();
    await page.getByTestId('submit-answer').click();
    return;
  }
  // Self-rating submits directly; "忘了" is an honest wrong answer.
  await page.getByRole('button', { name: wrong ? '忘了' : '记得' }).click();
}

test('新用户创建目标 → 首页可用', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '先说一句你想达到什么' })).toBeVisible();

  await page.getByLabel('你想达到什么？').fill('我想提高英语口语');
  await page.getByTestId('create-goal').click();

  await expect(page.getByText('当前主要目标')).toBeVisible();
  await expect(page.getByRole('heading', { name: '我想提高英语口语' })).toBeVisible();
  // Honest empty state instead of fabricated practice content.
  await expect(page.getByText('还没有可以安排的练习')).toBeVisible();
  await expect(page.getByText('当前没有配置 AI Provider', { exact: false })).toBeVisible();
});

test('知识库：figure 与 figure out 是两个独立条目，来源可见', async ({ page }) => {
  await addKnowledge(page, [
    { text: 'figure', meaning: '数字；人物' },
    { text: 'figure out', meaning: '弄清楚' },
  ]);

  await page.goto('/knowledge');
  await expect(page.getByText('figure', { exact: true })).toBeVisible();
  await expect(page.getByText('figure out', { exact: true })).toBeVisible();
  await expect(page.getByText('单词', { exact: true })).toBeVisible();
  await expect(page.getByText('短语', { exact: true }).first()).toBeVisible();

  await page.getByText('figure out', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'figure out' })).toBeVisible();
  await expect(page.getByText('我手动添加').first()).toBeVisible();
  await expect(page.getByText('还没有练习记录', { exact: false })).toBeVisible();
});

test('“我只有 3 分钟” → 推荐时长匹配', async ({ page }) => {
  await addKnowledge(page, VOCAB);

  await page.goto('/');
  await page.getByLabel('现在的情况是？').fill('我现在只有 3 分钟');
  await page.getByRole('button', { name: '告诉它' }).click();

  await expect(page.getByRole('status')).toContainText('3 分钟');
  await expect(page.getByText('按你说的 3 分钟安排')).toBeVisible();
  await expect(page.getByText('约 3 分钟').first()).toBeVisible();
  // No 4-minute-minimum activity may be offered for a 3-minute window.
  await expect(page.getByText('写作练习')).toHaveCount(0);
});

test('完成一次复习 → 看到反馈 → 学习状态更新 → 推荐变化', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('start-recommendation')).toBeVisible();

  await page.getByTestId('start-quick-review').click();
  await expect(page).toHaveURL(/\/learn\/.*\?a=/);

  let answered = 0;
  for (let step = 0; step < 20; step += 1) {
    const screen = await waitForScreen(page);
    if (screen === 'summary') break;

    // A pinned-but-already-answered item only offers "下一个".
    if (screen === 'answered') {
      await advance(page);
      continue;
    }

    await answerCurrent(page, screen, false);

    // The learner must actually see the result of their answer.
    await expect(page.getByText(/对了|这次没答对/).first()).toBeVisible();
    answered += 1;

    await advance(page);
  }

  expect(answered).toBeGreaterThan(2);
  await expect(page.getByRole('heading', { name: /总结/ })).toBeVisible();

  // Evidence reached the learner model.
  await page.goto('/knowledge/');
  await expect(page.getByText('%').first()).toBeVisible();

  // And it is visible in the history.
  await page.goto('/history');
  await expect(page.getByText('快速复习').first()).toBeVisible();
  await expect(page.getByText(/作答 \d+/).first()).toBeVisible();

  // The home summary reflects the new evidence.
  await page.goto('/');
  const answersCell = page
    .locator('dt', { hasText: '7 天内作答' })
    .locator('xpath=following-sibling::dd[1]');
  await expect(answersCell).not.toHaveText('0');
});

test('中断后可以从首页恢复', async ({ page }) => {
  await addKnowledge(page, [{ text: 'hold on', meaning: '等一下' }]);
  await page.goto('/');
  await page.getByTestId('start-quick-review').click();
  await expect(page).toHaveURL(/\/learn\//);

  await page.getByTestId('pause-session').click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('还没做完')).toBeVisible();

  await page.getByTestId('resume-session').click();
  await expect(page).toHaveURL(/\/(learn|chat)\//);
  await page.goto('/');
});

test('自由聊天：关闭纠错真的生效；AI 不可用时优雅降级', async ({ page }) => {
  await page.goto('/chat');
  await page.getByTestId('chat-start').click();
  await expect(page).toHaveURL(/\/chat\//);
  await expect(page.getByText('未配置 AI')).toBeVisible();

  await page.getByTestId('chat-input').fill('不要纠正我的语法');
  await page.getByTestId('chat-send').click();

  await expect(page.getByText('好，这次不纠正你的语法。我们继续聊。')).toBeVisible();
  await expect(page.getByText('本次不纠错')).toBeVisible();

  // A genuine conversation turn degrades gracefully instead of crashing.
  await page.getByTestId('chat-input').fill('我昨天去爬山了');
  await page.getByTestId('chat-send').click();
  await expect(page.getByText(/AI 对话现在连不上/)).toBeVisible();
  await expect(page.getByRole('button', { name: '开始快速复习' })).toBeVisible();

  // Saving an expression works with no AI at all.
  await page.getByTestId('chat-input').fill('把「take over」保存起来');
  await page.getByTestId('chat-send').click();
  await expect(page.getByText(/已保存「take over」/)).toBeVisible();

  await page.goto('/knowledge');
  await expect(page.getByText('take over', { exact: true })).toBeVisible();
  await expect(page.getByText('应用内对话').first()).toBeVisible();
});

test('用户纠正系统：判错了可以改回来，不被系统争论', async ({ page }) => {
  await addKnowledge(page, [{ text: 'sort out', meaning: '整理清楚' }]);
  await page.goto('/');
  await page.getByTestId('start-quick-review').click();
  await expect(page).toHaveURL(/\/learn\//);

  // Answer wrongly on purpose until the system marks something wrong,
  // then correct it. All three question shapes must be answerable.
  let corrected = false;
  for (let step = 0; step < 15; step += 1) {
    const screen = await waitForScreen(page);
    if (screen === 'summary') break;

    if (screen === 'answered') {
      await advance(page);
      continue;
    }

    await answerCurrent(page, screen, true);
    await expect(page.getByTestId('next-activity')).toBeVisible();

    const correctButton = page.getByTestId('correct-assessment');
    if ((await correctButton.count()) > 0) {
      await expect(page.getByText('这次没答对', { exact: false })).toBeVisible();
      // The system must accept the user's correction without arguing.
      await correctButton.click();
      await expect(page.getByText(/已按你的判断更新/)).toBeVisible();
      corrected = true;
      break;
    }
    await advance(page);
  }
  expect(corrected).toBe(true);

  // The correction is auditable in the session record.
  await page.goto('/history');
  await page.getByText('快速复习').first().click();
  await expect(page.getByText('已按你的纠正更新').first()).toBeVisible();
});

test('这条不相关：不再安排复习', async ({ page }) => {
  await addKnowledge(page, [{ text: 'qqzzxx', meaning: '测试用的无意义条目' }]);
  await page.goto('/knowledge?status=all&q=qqzzxx');
  await page.getByText('qqzzxx', { exact: true }).click();

  await page.getByTestId('edit-status').selectOption('irrelevant');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('不相关').first()).toBeVisible();

  // It disappears from the active list instead of nagging the user.
  await page.goto('/knowledge?status=active&q=qqzzxx');
  await expect(page.getByText('没有匹配的条目')).toBeVisible();
});

test('数据导出与删除', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText('未配置')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 JSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('language-learning-export');

  // Deleting requires the exact confirmation phrase.
  const deleteButton = page.getByTestId('delete-data');
  await expect(deleteButton).toBeDisabled();
  await page.getByTestId('delete-confirm-input').fill('删除我的数据');
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page.getByText('本地学习数据已删除')).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '先说一句你想达到什么' })).toBeVisible();
});
