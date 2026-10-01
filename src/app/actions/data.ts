'use server';

import { revalidatePath } from 'next/cache';
import { deleteLearnerData, saveExportToStorage } from '@/application/data-management';
import { retireMemory } from '@/application/memory';
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

export async function retireMemoryAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  await retireMemory(ctx, learnerId, String(formData.get('memoryId') ?? ''));
  revalidatePath('/settings');
}
