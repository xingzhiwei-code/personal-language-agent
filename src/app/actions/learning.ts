'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { SelfRating } from '@/assessment/grading';
import { correctAssessment } from '@/application/assessment';
import { captureContext } from '@/application/context';
import { recordFeedback } from '@/application/feedback';
import { createGoalFromText, updateGoal } from '@/application/goals';
import {
  abandonSession,
  completeSession,
  pauseSession,
  resumeSession,
  skipActivity,
  startSession,
  submitActivityAnswer,
} from '@/application/sessions';
import { rejectRecommendation } from '@/application/recommendations';
import type { ActivityType, FeedbackKind, GoalStatus } from '@/domain/enums';
import {
  app,
  toActionError,
  type ActionResult,
  type AnswerFeedbackData,
} from '@/server/app';

/** Creates the first (or an additional) goal and sends the user to the home screen. */
export async function createGoalAction(
  _prev: ActionResult<{ goalId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ goalId: string }>> {
  const { ctx, learnerId } = app();
  const text = String(formData.get('text') ?? '').trim();
  const minutesRaw = String(formData.get('minutes') ?? '').trim();
  const minutes = minutesRaw.length > 0 ? Number.parseInt(minutesRaw, 10) : null;

  try {
    const { goal } = await createGoalFromText(ctx, {
      learnerId,
      text,
      availableMinutes: Number.isFinite(minutes) ? minutes : null,
    });
    revalidatePath('/');
    revalidatePath('/goals');
    return { ok: true, data: { goalId: goal.id }, message: '目标已创建' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function updateGoalAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, learnerId } = app();
  try {
    await updateGoal(ctx, {
      learnerId,
      goalId: String(formData.get('goalId') ?? ''),
      title: formData.get('title') ? String(formData.get('title')) : undefined,
      status: formData.get('status') ? (String(formData.get('status')) as GoalStatus) : undefined,
      makePrimary: formData.get('makePrimary') === 'on' ? true : undefined,
    });
    revalidatePath('/');
    revalidatePath('/goals');
    return { ok: true, message: '已更新' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

/** Records "I only have 3 minutes" / "今天只想聊天" from the home input. */
export async function captureContextAction(
  _prev: ActionResult<{ intent: string; minutes: number | null }> | null,
  formData: FormData,
): Promise<ActionResult<{ intent: string; minutes: number | null }>> {
  const { ctx, learnerId } = app();
  const text = String(formData.get('text') ?? '').trim();
  if (text.length === 0) return { ok: false, message: '请先输入一句话' };

  try {
    const context = await captureContext(ctx, {
      learnerId,
      rawInput: text,
      device: String(formData.get('device') ?? 'unknown') === 'mobile' ? 'mobile' : 'desktop',
    });
    revalidatePath('/');
    return {
      ok: true,
      data: { intent: context.intent, minutes: context.availableMinutes },
      message: buildContextMessage(context.intent, context.availableMinutes),
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

function buildContextMessage(intent: string, minutes: number | null): string {
  const parts: string[] = [];
  if (minutes) parts.push(`按 ${minutes} 分钟安排`);
  if (intent === 'conversation') parts.push('直接进入聊天');
  if (intent === 'practice') parts.push('给你准备练习');
  return parts.length > 0 ? `好的，${parts.join('，')}。` : '记下了，推荐已更新。';
}

export async function startSessionAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  const activityType = String(formData.get('activityType') ?? 'quick_review') as ActivityType;
  const minutesRaw = String(formData.get('minutes') ?? '');
  const minutes = Number.parseInt(minutesRaw, 10);
  const recommendationId = formData.get('recommendationId')
    ? String(formData.get('recommendationId'))
    : null;
  // Idempotency: the token is rendered with the page, so a double click reuses
  // the same session instead of creating two.
  const clientToken = String(formData.get('clientToken') ?? `session-${Date.now()}`);

  const { session } = await startSession(ctx, {
    learnerId,
    activityType,
    plannedDurationMinutes: Number.isFinite(minutes) ? minutes : null,
    recommendationId,
    clientToken,
  });

  revalidatePath('/');
  redirect(activityType === 'conversation' ? `/chat/${session.id}` : `/learn/${session.id}`);
}

export async function submitAnswerAction(
  _prev: ActionResult<AnswerFeedbackData> | null,
  formData: FormData,
): Promise<ActionResult<AnswerFeedbackData>> {
  const { ctx, learnerId } = app();
  const sessionId = String(formData.get('sessionId') ?? '');
  const activityId = String(formData.get('activityId') ?? '');
  const answer = formData.get('answer') ? String(formData.get('answer')) : null;
  const selfRating = formData.get('selfRating')
    ? (String(formData.get('selfRating')) as SelfRating)
    : null;

  try {
    const result = await submitActivityAnswer(ctx, {
      learnerId,
      sessionId,
      activityId,
      answer,
      selfRating,
    });
    // Deliberately NOT revalidating `/learn/[sessionId]`: the learner must see
    // the feedback for this answer before the next item appears.
    revalidatePath('/');
    return {
      ok: true,
      data: {
        verdict: result.duplicate ? 'duplicate' : (result.grade?.verdict ?? (result.score >= 0.6 ? 'exact' : 'wrong')),
        score: result.score,
        expected: result.grade?.normalizedExpected ?? null,
        assessmentId: result.assessment?.id ?? null,
        finished: result.view.nextActivity === null,
      },
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function skipActivityAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  const sessionId = String(formData.get('sessionId') ?? '');
  await skipActivity(ctx, {
    learnerId,
    sessionId,
    activityId: String(formData.get('activityId') ?? ''),
  });
  revalidatePath(`/learn/${sessionId}`);
}

export async function pauseSessionAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  await pauseSession(ctx, { learnerId, sessionId: String(formData.get('sessionId') ?? '') });
  revalidatePath('/');
  redirect('/');
}

export async function resumeSessionAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  const sessionId = String(formData.get('sessionId') ?? '');
  const session = await resumeSession(ctx, { learnerId, sessionId });
  revalidatePath('/');
  redirect(session.activityType === 'conversation' ? `/chat/${sessionId}` : `/learn/${sessionId}`);
}

export async function abandonSessionAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  await abandonSession(ctx, { learnerId, sessionId: String(formData.get('sessionId') ?? '') });
  revalidatePath('/');
  redirect('/');
}

export async function completeSessionAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  const sessionId = String(formData.get('sessionId') ?? '');
  await completeSession(ctx, { learnerId, sessionId });
  revalidatePath('/');
  revalidatePath(`/learn/${sessionId}`);
}

export async function rejectRecommendationAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  await rejectRecommendation(ctx, learnerId, String(formData.get('recommendationId') ?? ''));
  revalidatePath('/');
}

export async function feedbackAction(
  _prev: ActionResult<{ message: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ message: string }>> {
  const { ctx, learnerId } = app();
  try {
    const result = await recordFeedback(ctx, {
      learnerId,
      kind: String(formData.get('kind') ?? 'already_known') as FeedbackKind,
      subjectType: 'knowledge_item',
      subjectId: formData.get('subjectId') ? String(formData.get('subjectId')) : null,
      sessionId: formData.get('sessionId') ? String(formData.get('sessionId')) : null,
    });
    revalidatePath('/');
    revalidatePath('/knowledge');
    return { ok: true, data: { message: result.message }, message: result.message };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

/** "The system judged me wrong" — the learner's correction wins. */
export async function correctAssessmentAction(
  _prev: ActionResult<{ mastery: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ mastery: number }>> {
  const { ctx, learnerId } = app();
  try {
    const result = await correctAssessment(ctx, {
      learnerId,
      assessmentId: String(formData.get('assessmentId') ?? ''),
      correctedScore: Number.parseFloat(String(formData.get('score') ?? '1')),
    });
    revalidatePath('/');
    return {
      ok: true,
      data: { mastery: result.state.mastery },
      message: '已按你的判断更新',
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}
