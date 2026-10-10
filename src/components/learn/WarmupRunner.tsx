'use client';

import { useEffect, useState } from 'react';
import { advanceWarmupAction, skipWarmupAction } from '@/app/actions/learning';
import { phoneticFromNotes, sourceSpanOf } from '@/lib/item-display';
import { isSupported, speak } from '@/lib/speech';
import { Badge, buttonStyles, Card } from '@/components/ui';
import type { KnowledgeItem, LearningActivity } from '@/domain/entities';

/**
 * Warmup phase (v0.3 §D1): expose new words without testing. Auto-plays the
 * word once (best effort — autoplay may be blocked, the manual button always
 * works), and never records a score.
 */
export function WarmupRunner({
  activity,
  item,
  sessionId,
  position,
  total,
}: {
  activity: LearningActivity;
  item: KnowledgeItem | undefined;
  sessionId: string;
  position: number;
  total: number;
}) {
  const word = item?.text ?? activity.subjectId;
  const phonetic = phoneticFromNotes(item?.notes ?? null);
  const span = item ? sourceSpanOf(item) : null;
  // Web Speech only exists in the browser. Deciding the replay button during
  // render makes SSR output (`false`) differ from the client's first render
  // (`true`) and breaks hydration, so resolve it after mount instead.
  const [speechSupported, setSpeechSupported] = useState(false);

  useEffect(() => {
    setSpeechSupported(isSupported());
    speak(word);
  }, [word]);

  const replay = () => speak(word);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>
          热身 {position} / {total}
        </span>
        <Badge>只曝光 · 不计分</Badge>
      </div>

      <Card className="text-center">
        <div className="flex items-center justify-center gap-3">
          <p className="text-2xl font-semibold">{word}</p>
          {speechSupported ? (
            <button
              type="button"
              onClick={replay}
              aria-label={`播放 ${word} 的发音`}
              className="rounded-full border border-ink-200 px-2.5 py-1.5 text-sm hover:bg-ink-50"
            >
              🔊
            </button>
          ) : null}
        </div>
        {phonetic ? <p className="mt-1 text-sm text-ink-400">{phonetic}</p> : null}
        {item?.meaning ? (
          <p className="mt-3 text-base text-ink-800">{item.meaning}</p>
        ) : (
          <p className="mt-3 text-sm text-ink-400">这条还没有释义</p>
        )}
        {span ? (
          <blockquote className="mt-4 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
            <p>“{span.text}”</p>
            {span.source ? <p className="mt-1 text-xs text-ink-400">来自：{span.source}</p> : null}
          </blockquote>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <form action={advanceWarmupAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="activityId" value={activity.id} />
          <button type="submit" className={buttonStyles.primary} data-testid="warmup-next">
            下一个
          </button>
        </form>
        <form action={skipWarmupAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <button type="submit" className={buttonStyles.ghost} data-testid="skip-warmup">
            跳过热身直接开始
          </button>
        </form>
      </div>
      <p className="text-xs text-ink-400">热身只是先见一面，接下来才会开始测试。</p>
    </div>
  );
}
