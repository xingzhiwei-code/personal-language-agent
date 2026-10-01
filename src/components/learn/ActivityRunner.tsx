'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import {
  correctAssessmentAction,
  feedbackAction,
  submitAnswerAction,
} from '@/app/actions/learning';
import { MODALITY_LABELS } from '@/components/labels';
import { Badge, buttonStyles, Card, ErrorNote } from '@/components/ui';
import type { LearningActivity } from '@/domain/entities';
import type { ActionResult } from '@/server/app';

type AnswerData = {
  verdict: string;
  score: number;
  expected: string | null;
  assessmentId: string | null;
  finished: boolean;
};

/**
 * One task at a time (PRD §F-03). The learner can answer, skip, correct the
 * system, or leave — leaving is never framed as failure.
 */
export function ActivityRunner({
  activity,
  meaningHint,
  sessionId,
  position,
  total,
  alreadyAnswered = false,
}: {
  activity: LearningActivity;
  meaningHint: string | null;
  sessionId: string;
  position: number;
  total: number;
  /** True when this pinned activity was already answered in a previous visit. */
  alreadyAnswered?: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult<AnswerData> | null, FormData>(
    submitAnswerAction,
    null,
  );
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');

  const answered = state?.ok === true && state.data !== undefined;

  useEffect(() => {
    // Reset local input when a new activity is rendered.
    setChoice(null);
    setText('');
  }, [activity.id]);

  /** Moves to the next pending activity (or the summary) via a fresh server render. */
  const onAdvance = () => {
    router.push(`/learn/${sessionId}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>
          第 {position} / {total} 个
        </span>
        <Badge>{MODALITY_LABELS[activity.modality]}</Badge>
      </div>

      <Card>
        <p className="text-lg leading-relaxed font-medium">{activity.prompt}</p>
        {activity.hint && !answered ? (
          <p className="mt-2 text-xs text-ink-400">提示：{activity.hint}</p>
        ) : null}

        {alreadyAnswered && !answered ? (
          <div className="mt-5 space-y-3">
            <p className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-600">
              这一题你已经答过了。
              {activity.expectedAnswer ? ` 参考答案：${activity.expectedAnswer}` : ''}
            </p>
            <button
              type="button"
              onClick={onAdvance}
              className={buttonStyles.primary}
              data-testid="next-activity"
            >
              下一个
            </button>
          </div>
        ) : !answered ? (
          <form action={action} className="mt-5 space-y-3">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="activityId" value={activity.id} />

            {activity.options && activity.options.length > 0 ? (
              <>
                <input type="hidden" name="answer" value={choice ?? ''} />
                <div className="grid gap-2">
                  {activity.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setChoice(option)}
                      aria-pressed={choice === option}
                      className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                        choice === option
                          ? 'border-accent-500 bg-accent-50'
                          : 'border-ink-200 bg-white hover:bg-ink-50'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  className={buttonStyles.primary}
                  disabled={pending || choice === null}
                  data-testid="submit-answer"
                >
                  {pending ? '提交中…' : '提交'}
                </button>
              </>
            ) : activity.expectedAnswer ? (
              <>
                <label htmlFor="answer" className="block text-sm text-ink-600">
                  写出你的答案
                </label>
                <input
                  id="answer"
                  name="answer"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none"
                  placeholder="不记得就直接提交，没关系"
                />
                <button
                  type="submit"
                  className={buttonStyles.primary}
                  disabled={pending}
                  data-testid="submit-answer"
                >
                  {pending ? '提交中…' : '提交'}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-600">诚实选一个就好：</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: 'forgot', label: '忘了' },
                      { value: 'unsure', label: '有点印象' },
                      { value: 'known', label: '记得' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="submit"
                      name="selfRating"
                      value={option.value}
                      className={buttonStyles.secondary}
                      disabled={pending}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {state && !state.ok ? <ErrorNote>{state.message}</ErrorNote> : null}
          </form>
        ) : (
          <AnswerFeedback
            data={state.data as AnswerData}
            activity={activity}
            meaningHint={meaningHint}
            sessionId={sessionId}
            onNext={onAdvance}
          />
        )}
      </Card>
    </div>
  );
}

function AnswerFeedback({
  data,
  activity,
  meaningHint,
  sessionId,
  onNext,
}: {
  data: AnswerData;
  activity: LearningActivity;
  meaningHint: string | null;
  sessionId: string;
  onNext: () => void;
}) {
  const [feedbackState, feedbackDispatch] = useActionState<
    ActionResult<{ message: string }> | null,
    FormData
  >(feedbackAction, null);
  const [correctionState, correctionDispatch] = useActionState<
    ActionResult<{ mastery: number }> | null,
    FormData
  >(correctAssessmentAction, null);

  const correct = data.score >= 0.6;

  return (
    <div className="mt-5 space-y-4">
      <div
        className={`rounded-xl px-3 py-2.5 text-sm ${
          correct ? 'bg-accent-50 text-accent-600' : 'bg-amber-50 text-amber-700'
        }`}
        role="status"
      >
        {correct
          ? data.verdict === 'near'
            ? '基本对了，拼写差一点。'
            : '对了。'
          : '这次没答对，没关系——这正好告诉系统该多练它。'}
        {activity.expectedAnswer ? (
          <span className="mt-1 block text-ink-900">
            参考答案：<strong>{activity.expectedAnswer}</strong>
          </span>
        ) : null}
        {meaningHint ? (
          <span className="mt-0.5 block text-xs text-ink-600">释义：{meaningHint}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onNext}
          className={buttonStyles.primary}
          data-testid="next-activity"
        >
          {data.finished ? '看总结' : '下一个'}
        </button>

        {data.assessmentId ? (
          <form action={feedbackDispatch}>
            <input type="hidden" name="kind" value="already_known" />
            <input type="hidden" name="subjectId" value={activity.subjectId} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <button type="submit" className={buttonStyles.ghost}>
              这个我已经会了
            </button>
          </form>
        ) : null}

        <form action={feedbackDispatch}>
          <input type="hidden" name="kind" value="not_relevant" />
          <input type="hidden" name="subjectId" value={activity.subjectId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <button type="submit" className={buttonStyles.ghost}>
            这条不相关
          </button>
        </form>

        {!correct && data.assessmentId ? (
          <form action={correctionDispatch}>
            <input type="hidden" name="assessmentId" value={data.assessmentId} />
            <input type="hidden" name="score" value="1" />
            <button
              type="submit"
              className={buttonStyles.ghost}
              data-testid="correct-assessment"
            >
              我其实答对了
            </button>
          </form>
        ) : null}
      </div>

      {feedbackState?.message ? (
        <p role="status" className="text-xs text-accent-600">
          {feedbackState.message}
        </p>
      ) : null}
      {correctionState?.message ? (
        <p role="status" className="text-xs text-accent-600">
          {correctionState.message}
        </p>
      ) : null}
    </div>
  );
}
