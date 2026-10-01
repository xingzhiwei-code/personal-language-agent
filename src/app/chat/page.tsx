import Link from 'next/link';
import { startChatAction } from '@/app/actions/chat';
import { Card, buttonStyles } from '@/components/ui';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function ChatEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ ask?: string }>;
}) {
  const { ask } = await searchParams;
  const { ctx, learnerId } = app();
  const recent = await ctx.repos.sessions.listByLearner(learnerId, 5, [
    'active',
    'paused',
    'created',
  ]);
  const resumableChat = recent.find((session) => session.activityType === 'conversation');
  const aiAvailable = ctx.llm.isConfigured();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">{ask ? '问个语言问题' : '自由对话'}</h1>
        <p className="mt-1 text-sm text-ink-600">
          {ask
            ? '先直接回答你的问题，练习是可选的，不想练就不练。'
            : '想聊什么都行。默认不会把每句话都变成课程。'}
        </p>
      </header>

      {!aiAvailable ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <p className="text-sm font-medium">还没有配置 AI Provider</p>
          <p className="mt-1 text-sm text-ink-600">
            对话需要一个 LLM。你仍然可以进入会话——命令（例如「不要纠正我」「我只有 3
            分钟」）在本地就能生效，并且系统会告诉你还有哪些功能可用。
          </p>
          <Link href="/settings" className="mt-2 inline-block text-sm underline">
            查看配置方法
          </Link>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <form action={startChatAction}>
          <input type="hidden" name="clientToken" value={`chat-entry-${Date.now()}`} />
          <button type="submit" className={buttonStyles.primary} data-testid="chat-start">
            开始新的对话
          </button>
        </form>
        {resumableChat ? (
          <Link href={`/chat/${resumableChat.id}`} className={buttonStyles.secondary}>
            继续上次的对话
          </Link>
        ) : null}
      </div>
    </div>
  );
}
