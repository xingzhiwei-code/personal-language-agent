import { retireMemoryAction } from '@/app/actions/data';
import { DELETE_CONFIRMATION_PHRASE } from '@/application/data-management';
import { listMemories } from '@/application/memory';
import { DataControls } from '@/components/settings/DataControls';
import { NewWordBudgetForm } from '@/components/settings/NewWordBudgetForm';
import { DEFAULT_DAILY_NEW_WORD_BUDGET } from '@/application/knowledge-pool';
import { Badge, Card, SectionTitle, formatDateTime } from '@/components/ui';
import { getTelemetry } from '@/infrastructure/observability/telemetry';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { ctx, learnerId } = app();
  const aiAvailable = ctx.llm.isConfigured();
  const memories = await listMemories(ctx, learnerId);
  const preferences = await ctx.repos.preferences.listByLearner(learnerId);
  const budgetPreference = preferences.find((preference) => preference.key === 'daily_new_word_budget');
  const dailyBudget = budgetPreference ? Number(budgetPreference.value) : DEFAULT_DAILY_NEW_WORD_BUDGET;
  const eventCount = await ctx.repos.events.countByLearner(learnerId);
  const stats = getTelemetry().stats();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">设置与数据</h1>
        <p className="mt-1 text-sm text-ink-600">版本 V0.2 · 单用户 · 本地优先</p>
      </header>

      <Card>
        <SectionTitle title="运行状态" />
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-400">AI Provider</dt>
            <dd className="mt-0.5">
              {aiAvailable ? (
                <Badge tone="accent">已配置</Badge>
              ) : (
                <Badge tone="warn">未配置</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">事件总数</dt>
            <dd className="mt-0.5 tabular-nums">{eventCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">AI 调用 / 失败</dt>
            <dd className="mt-0.5 tabular-nums">
              {stats.aiCalls} / {stats.aiFailures}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Token（入/出）</dt>
            <dd className="mt-0.5 tabular-nums">
              {stats.inputTokens} / {stats.outputTokens}
            </dd>
          </div>
        </dl>
        {!aiAvailable ? (
          <p className="mt-3 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600">
            要启用对话和解释，在项目根目录创建 <code>.env.local</code>，填入{' '}
            <code>LLA_LLM_BASE_URL</code>、<code>LLA_LLM_API_KEY</code>、
            <code>LLA_LLM_MODEL</code>（任何 OpenAI 兼容服务都可以），然后重启开发服务器。
            密钥只从环境变量读取，不会写进数据库或日志。
          </p>
        ) : null}
      </Card>

      <Card>
        <SectionTitle title="每日新词预算" hint="从词库池确定性选择，不调用 AI" />
        <NewWordBudgetForm
          value={Number.isInteger(dailyBudget) && dailyBudget >= 0 && dailyBudget <= 50 ? dailyBudget : DEFAULT_DAILY_NEW_WORD_BUDGET}
        />
      </Card>

      <Card>
        <SectionTitle title="隐私说明" hint="不夸大，也不隐瞒" />
        <ul className="space-y-1.5 text-sm text-ink-600">
          <li>· 学习数据保存在本机 SQLite 文件里，不会自动上传。</li>
          <li>
            ·
            使用对话或语言解释时，只发送裁剪后的目标、技能、错误、相关知识和最近对话；使用文本提炼时，会发送你本次主动粘贴的文本。不会发送整个数据库或全部聊天历史。
          </li>
          <li>· 不做行为分析、不做广告、不收集完成功能以外的数据。</li>
          <li>· 复习、知识库、历史和学习状态完全不需要联网。</li>
        </ul>
      </Card>

      <Card>
        <SectionTitle title="系统记住的事" hint="都是可以纠正的假设，不是事实" />
        {memories.length === 0 ? (
          <p className="text-sm text-ink-400">还没有长期记忆。单次行为不会直接变成长期偏好。</p>
        ) : (
          <ul className="space-y-2">
            {memories.map((memory) => (
              <li
                key={memory.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-200 px-3 py-2 text-sm"
              >
                <span>
                  {memory.content}
                  <span className="ml-2 text-xs text-ink-400">
                    置信度 {Math.round(memory.confidence * 100)}% · 观察 {memory.evidenceCount} 次
                    · {formatDateTime(memory.lastObservedAt)}
                  </span>
                </span>
                <form action={retireMemoryAction}>
                  <input type="hidden" name="memoryId" value={memory.id} />
                  <button type="submit" className="text-xs text-ink-400 hover:text-red-600">
                    这条不对
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {preferences.length > 0 ? (
          <div className="mt-4 border-t border-ink-100 pt-3">
            <p className="text-xs text-ink-400">偏好假设</p>
            <ul className="mt-1.5 space-y-1 text-xs text-ink-600">
              {preferences.map((preference) => (
                <li key={preference.id}>
                  {preference.key} = {preference.value}（置信度{' '}
                  {Math.round(preference.confidence * 100)}%，
                  {preference.source === 'user_explicit' ? '你明确说过' : '系统推断'}）
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionTitle title="数据管理" />
        <DataControls confirmPhrase={DELETE_CONFIRMATION_PHRASE} />
      </Card>
    </div>
  );
}
