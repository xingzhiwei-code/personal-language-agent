'use server';

import { revalidatePath } from 'next/cache';
import {
  bindWordlistToGoal,
  createScenario,
  deleteScenario,
  updateScenario,
} from '@/application/scenarios';
import {
  scenarioStatusSchema,
  scenarioTypeSchema,
  timeContextPresetSchema,
} from '@/domain/enums';
import { validationFailed } from '@/domain/errors';
import { app, toActionError, type ActionResult } from '@/server/app';

export async function createScenarioAction(
  _previous: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const type = scenarioTypeSchema.safeParse(String(formData.get('type') ?? 'big'));
    const presetRaw = String(formData.get('timePreset') ?? '');
    const preset = presetRaw ? timeContextPresetSchema.safeParse(presetRaw) : null;
    if (!type.success || (preset && !preset.success)) throw validationFailed('场景类型或时间范围无效');
    const { ctx, learnerId } = app();
    const scenario = await createScenario(ctx, {
      learnerId,
      name: String(formData.get('name') ?? ''),
      type: type.data,
      goalId: String(formData.get('goalId') ?? '').trim() || null,
      parentId: String(formData.get('parentId') ?? '').trim() || null,
      timePreset: preset?.data ?? null,
      timeText: String(formData.get('timeText') ?? '').trim() || null,
    });
    revalidateGoalViews();
    return { ok: true, data: { id: scenario.id }, message: '场景已创建' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function updateScenarioAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const status = scenarioStatusSchema.safeParse(String(formData.get('status') ?? 'active'));
    const hasTimePreset = formData.has('timePreset');
    const presetRaw = String(formData.get('timePreset') ?? '');
    const preset = presetRaw ? timeContextPresetSchema.safeParse(presetRaw) : null;
    if (!status.success || (preset && !preset.success)) {
      throw validationFailed('场景状态或时间范围无效');
    }
    const { ctx, learnerId } = app();
    await updateScenario(ctx, {
      learnerId,
      scenarioId: String(formData.get('scenarioId') ?? ''),
      name: String(formData.get('name') ?? ''),
      goalId: String(formData.get('goalId') ?? '').trim() || null,
      status: status.data,
      timePreset: hasTimePreset ? preset?.data ?? null : undefined,
    });
    revalidateGoalViews();
    return { ok: true, message: '场景已更新' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function deleteScenarioAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { ctx, learnerId } = app();
    await deleteScenario(ctx, learnerId, String(formData.get('scenarioId') ?? ''));
    revalidateGoalViews();
    return { ok: true, message: '场景已删除' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function bindWordlistGoalAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { ctx, learnerId } = app();
    await bindWordlistToGoal(ctx, {
      learnerId,
      wordlistId: String(formData.get('wordlistId') ?? ''),
      goalId: String(formData.get('goalId') ?? '').trim() || null,
    });
    revalidateGoalViews();
    return { ok: true, message: '词库绑定已更新' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

function revalidateGoalViews(): void {
  revalidatePath('/');
  revalidatePath('/goals');
  revalidatePath('/knowledge/logs');
}
