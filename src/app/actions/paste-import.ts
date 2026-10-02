'use server';

import { revalidatePath } from 'next/cache';
import {
  confirmPastedCandidates,
  extractFromPastedText,
  type ConfirmPasteImportResult,
  type ExtractedPasteCandidate,
  type PasteExtractionPreview,
} from '@/application/paste-import';
import { validationFailed } from '@/domain/errors';
import { app, toActionError, type ActionResult } from '@/server/app';

export async function extractPastedTextAction(
  _previous: ActionResult<PasteExtractionPreview> | null,
  formData: FormData,
): Promise<ActionResult<PasteExtractionPreview>> {
  try {
    const { ctx, learnerId } = app();
    const preview = await extractFromPastedText(ctx, {
      learnerId,
      title: String(formData.get('title') ?? ''),
      text: String(formData.get('text') ?? ''),
      languageCode: String(formData.get('languageCode') ?? 'en'),
    });
    revalidatePath('/knowledge/history');
    return {
      ok: true,
      data: preview,
      message: preview.aiAvailable ? `提炼出 ${preview.candidates.length} 条候选表达` : preview.notice ?? undefined,
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function confirmPastedCandidatesAction(
  _previous: ActionResult<ConfirmPasteImportResult> | null,
  formData: FormData,
): Promise<ActionResult<ConfirmPasteImportResult>> {
  try {
    const raw = String(formData.get('candidates') ?? '');
    let candidates: ExtractedPasteCandidate[];
    try {
      candidates = JSON.parse(raw) as ExtractedPasteCandidate[];
    } catch {
      throw validationFailed('确认数据无效，请重新提炼');
    }
    const { ctx, learnerId } = app();
    const result = await confirmPastedCandidates(ctx, {
      learnerId,
      sourceId: String(formData.get('sourceId') ?? ''),
      historyId: String(formData.get('historyId') ?? ''),
      candidates,
      directLearning: formData.get('directLearning') === 'on',
      languageCode: String(formData.get('languageCode') ?? 'en'),
    });
    revalidatePath('/knowledge');
    revalidatePath('/knowledge/history');
    revalidatePath('/knowledge/logs');
    return {
      ok: true,
      data: result,
      message: `已保存 ${result.addedCount} 条，跳过重复 ${result.duplicateCount} 条`,
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}
