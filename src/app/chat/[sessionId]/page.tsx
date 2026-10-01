import Link from 'next/link';
import { notFound } from 'next/navigation';
import { toggleCorrectionAction } from '@/app/actions/chat';
import {
  abandonSessionAction,
  completeSessionAction,
  pauseSessionAction,
} from '@/app/actions/learning';
import { getSessionView } from '@/application/sessions';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { buttonStyles } from '@/components/ui';
import { DomainError } from '@/domain/errors';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const { ctx, learnerId } = app();

  let view;
  try {
    view = await getSessionView(ctx, learnerId, sessionId);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'not_found') notFound();
    throw error;
  }

  const messages = await ctx.repos.chat.listBySession(sessionId, 200);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">自由对话</h1>
        <Link href="/" className="text-xs text-ink-400 hover:text-ink-900">
          返回首页
        </Link>
      </header>

      <ChatPanel
        sessionId={sessionId}
        initialMessages={messages}
        correctionEnabled={view.session.correctionEnabled}
        aiAvailable={ctx.llm.isConfigured()}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
        <form action={toggleCorrectionAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input
            type="hidden"
            name="enabled"
            value={view.session.correctionEnabled ? 'false' : 'true'}
          />
          <button type="submit" className={buttonStyles.ghost} data-testid="toggle-correction">
            {view.session.correctionEnabled ? '关闭本次纠错' : '开启本次纠错'}
          </button>
        </form>
        <form action={pauseSessionAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <button type="submit" className={buttonStyles.ghost}>
            先暂停
          </button>
        </form>
        <form action={completeSessionAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <button type="submit" className={buttonStyles.ghost}>
            结束这次对话
          </button>
        </form>
        <form action={abandonSessionAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <button type="submit" className={buttonStyles.ghost}>
            退出
          </button>
        </form>
      </div>
    </div>
  );
}
