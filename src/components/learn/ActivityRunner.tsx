'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import {
  correctAssessmentAction,
  feedbackAction,
  submitAnswerAction,
} from '@/app/actions/learning';
import { MODALITY_LABELS, WORD_RELATION_LABELS } from '@/components/labels';
import { Badge, buttonStyles, Card, ErrorNote } from '@/components/ui';
import type { KnowledgeItem, LearningActivity, WordRelation } from '@/domain/entities';
import { phoneticFromNotes, sourceSpanOf } from '@/lib/item-display';
import { isSupported, speak } from '@/lib/speech';
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
 *
 * v0.3 §D2 adds the dictation card:
 *   - review_dictation: TTS plays the word, learner types it (MCQ fallback)
 *   - everything else: recognition / recall / production as before, now with
 *     phonetic + source_span context shown when available.
 */
export function ActivityRunner({
  activity,
  item,
  sessionId,
  position,
  total,
  alreadyAnswered = false,
  aiAvailable = false,
  relations = [],
}: {
  activity: LearningActivity;
  item?: KnowledgeItem;
  sessionId: string;
  position: number;
  total: number;
  /** True when this pinned activity was already answered in a previous visit. */
  alreadyAnswered?: boolean;
  /** Whether an AI provider is configured (drives honest writing labels). */
  aiAvailable?: boolean;
  /** Read-only semantic relation tags (v0.4 §G3). */
  relations?: WordRelation[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult<AnswerData> | null, FormData>(
    submitAnswerAction,
    null,
  );
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');

  const answered = state?.ok === true && state.data !== undefined;
  const meaningHint = item?.meaning ?? null;

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
        {activity.kind === 'review_dictation' && !answered ? (
          <DictationForm
            activity={activity}
            sessionId={sessionId}
            pending={pending}
            action={action}
            text={text}
            setText={setText}
            choice={choice}
            setChoice={setChoice}
            error={state && !state.ok ? state.message : null}
          />
        ) : (
          <>
            <p className="text-lg leading-relaxed font-medium">{activity.prompt}</p>
            {activity.kind === 'writing_prompt' && !aiAvailable && !answered ? (
              <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600">
                AI 批改未启用，这次只检查你有没有用上目标表达。
              </p>
            ) : null}
            {item ? <ItemContext item={item} relations={relations} /> : null}
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
              <AnswerForm
                activity={activity}
                sessionId={sessionId}
                pending={pending}
                action={action}
                choice={choice}
                setChoice={setChoice}
                text={text}
                setText={setText}
                error={state && !state.ok ? state.message : null}
              />
            ) : (
              <AnswerFeedback
                data={state.data as AnswerData}
                activity={activity}
                meaningHint={meaningHint}
                sessionId={sessionId}
                onNext={onAdvance}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/** Phonetic + source sentence + read-only relation tags shown on a card. */
function ItemContext({ item, relations }: { item: KnowledgeItem; relations: WordRelation[] }) {
  const phonetic = phoneticFromNotes(item.notes);
  const span = sourceSpanOf(item);
  const tags = relations
    .filter((relation) => relation.relationType !== 'topic')
    .slice(0, 2);
  if (!phonetic && !span && tags.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 text-sm text-ink-600">
      {phonetic ? <p className="text-ink-400">{phonetic}</p> : null}
      {span ? (
        <blockquote className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-600">
          <p>“{span.text}”</p>
          {span.source ? <p className="mt-1 text-xs text-ink-400">来自：{span.source}</p> : null}
        </blockquote>
      ) : null}
      {tags.length > 0 ? (
        <p className="text-xs text-ink-400">
          {tags.map((relation) => (
            <span key={relation.id} className="mr-2">
              {relation.relationType === 'antonym' ? '↔' : '·'}{' '}
              {WORD_RELATION_LABELS[relation.relationType]}：{relation.relatedLemma}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** Dictation (v0.3 §D2): TTS plays, learner types. Falls back to four-choice. */
function DictationForm({
  activity,
  sessionId,
  pending,
  action,
  text,
  setText,
  choice,
  setChoice,
  error,
}: {
  activity: LearningActivity;
  sessionId: string;
  pending: boolean;
  action: (formData: FormData) => void;
  text: string;
  setText: (value: string) => void;
  choice: string | null;
  setChoice: (value: string | null) => void;
  error: string | null;
}) {
  // Resolve speech support after mount: reading it during render makes SSR
  // (`false`) and the client's first render (`true`) differ, which breaks
  // hydration (same root cause as the warmup replay button).
  const [supported, setSupported] = useState(false);
  const word = activity.expectedAnswer ?? '';

  useEffect(() => {
    setSupported(isSupported());
  }, []);

  useEffect(() => {
    if (supported) speak(word);
  }, [supported, word]);

  if (!supported) {
    // No Web Speech: fall back to four-choice recognition, never an error.
    return (
      <form action={action} className="mt-5 space-y-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="activityId" value={activity.id} />
        <input type="hidden" name="answer" value={choice ?? ''} />
        <p className="text-sm text-ink-600">当前浏览器不支持发音，改为选择正确释义：</p>
        <div className="grid gap-2">
          {(activity.options ?? []).map((option) => (
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
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    );
  }

  return (
    <form action={action} className="mt-5 space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="activityId" value={activity.id} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => speak(word)}
          aria-label={`重播 ${word} 的发音`}
          className="rounded-full border border-ink-200 px-2.5 py-1.5 text-sm hover:bg-ink-50"
        >
          🔊 重播
        </button>
        <span className="text-xs text-ink-400">听音，写出你听到的单词</span>
      </div>
      <label htmlFor="answer" className="block text-sm text-ink-600">
        写下你听到的单词
      </label>
      <input
        id="answer"
        name="answer"
        value={text}
        onChange={(event) => setText(event.target.value)}
        autoComplete="off"
        autoCapitalize="off"
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
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </form>
  );
}

/** The standard answer form: four-choice, free text, or honest self-rating. */
function AnswerForm({
  activity,
  sessionId,
  pending,
  action,
  choice,
  setChoice,
  text,
  setText,
  error,
}: {
  activity: LearningActivity;
  sessionId: string;
  pending: boolean;
  action: (formData: FormData) => void;
  choice: string | null;
  setChoice: (value: string | null) => void;
  text: string;
  setText: (value: string) => void;
  error: string | null;
}) {
  return (
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

      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </form>
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
