'use server';

import { revalidatePath } from 'next/cache';
import { deleteLearnerData, saveExportToStorage } from '@/application/data-management';
import { setPreference, retireMemory } from '@/application/memory';
import { MAX_DAILY_NEW_WORD_BUDGET } from '@/application/knowledge-pool';
import { app, toActionError, type ActionResult } from '@/server/app';

export async function saveExportAction(
  _prev: ActionResult<{ key: string; bytes: number }> | null,
): Promise<ActionResult<{ key: string; bytes: number }>> {
  const { ctx, learnerId } = app();
  try {
    const result = await saveExportToStorage(ctx, learnerId);
    return {
      ok: true,
      data: result,
      message: `已导出到本地文件：${result.key}（${Math.round(result.bytes / 1024)} KB）`,
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function deleteDataAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, learnerId } = app();
  const confirmation = String(formData.get('confirmation') ?? '');
  try {
    await deleteLearnerData(ctx, learnerId, confirmation);
    revalidatePath('/');
    revalidatePath('/knowledge');
    revalidatePath('/history');
    revalidatePath('/goals');
    return { ok: true, message: '本地学习数据已删除' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function updateDailyNewWordBudgetAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const raw = String(formData.get('budget') ?? '');
  const budget = Number(raw);
  if (!Number.isInteger(budget) || budget < 0 || budget > MAX_DAILY_NEW_WORD_BUDGET) {
    return { ok: false, message: `每日新词预算必须是 0–${MAX_DAILY_NEW_WORD_BUDGET} 的整数` };
  }
  try {
    const { ctx, learnerId } = app();
    await setPreference(ctx, {
      learnerId,
      key: 'daily_new_word_budget',
      value: String(budget),
      source: 'user_explicit',
    });
    revalidatePath('/');
    revalidatePath('/settings');
    return { ok: true, message: budget === 0 ? '已关闭自动加入新词' : `每天最多自动加入 ${budget} 个新词` };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function retireMemoryAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  await retireMemory(ctx, learnerId, String(formData.get('memoryId') ?? ''));
  revalidatePath('/settings');
}
