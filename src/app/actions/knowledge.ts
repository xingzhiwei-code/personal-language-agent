'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addKnowledgeRelation,
  createKnowledgeItem,
  deleteKnowledgeItem,
  removeKnowledgeRelation,
  updateKnowledgeItem,
} from '@/application/knowledge';
import type {
  KnowledgeRelationType,
  KnowledgeStatus,
  KnowledgeType,
} from '@/domain/enums';
import { app, toActionError, type ActionResult } from '@/server/app';

export async function createKnowledgeAction(
  _prev: ActionResult<{ id: string; deduplicated: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; deduplicated: boolean }>> {
  const { ctx, learnerId } = app();
  const text = String(formData.get('text') ?? '').trim();
  const typeRaw = String(formData.get('type') ?? 'auto');
  const example = String(formData.get('example') ?? '').trim();

  try {
    const { item, deduplicated } = await createKnowledgeItem(ctx, {
      learnerId,
      text,
      type: typeRaw === 'auto' ? undefined : (typeRaw as KnowledgeType),
      meaning: String(formData.get('meaning') ?? '').trim() || null,
      notes: String(formData.get('notes') ?? '').trim() || null,
      languageCode: String(formData.get('languageCode') ?? 'en'),
      examples: example ? [{ text: example, origin: 'user' }] : [],
      origin: 'user',
      sourceType: 'user_manual',
      aiGenerated: false,
    });
    revalidatePath('/knowledge');
    revalidatePath('/');
    return {
      ok: true,
      data: { id: item.id, deduplicated },
      message: deduplicated ? `「${item.text}」已存在，已补充信息` : `已添加「${item.text}」`,
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function updateKnowledgeAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, learnerId } = app();
  const id = String(formData.get('id') ?? '');
  try {
    await updateKnowledgeItem(ctx, {
      learnerId,
      id,
      text: formData.get('text') ? String(formData.get('text')) : undefined,
      type: formData.get('type') ? (String(formData.get('type')) as KnowledgeType) : undefined,
      meaning: formData.has('meaning') ? String(formData.get('meaning')) : undefined,
      notes: formData.has('notes') ? String(formData.get('notes')) : undefined,
      status: formData.get('status')
        ? (String(formData.get('status')) as KnowledgeStatus)
        : undefined,
    });
    revalidatePath('/knowledge');
    revalidatePath(`/knowledge/${id}`);
    return { ok: true, message: '已保存' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  await deleteKnowledgeItem(ctx, learnerId, String(formData.get('id') ?? ''));
  revalidatePath('/knowledge');
  redirect('/knowledge');
}

export async function addRelationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, learnerId } = app();
  const fromItemId = String(formData.get('fromItemId') ?? '');
  try {
    await addKnowledgeRelation(ctx, {
      learnerId,
      fromItemId,
      toItemId: String(formData.get('toItemId') ?? ''),
      type: String(formData.get('type') ?? 'related') as KnowledgeRelationType,
    });
    revalidatePath(`/knowledge/${fromItemId}`);
    return { ok: true, message: '已建立关系' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function removeRelationAction(formData: FormData): Promise<void> {
  const { ctx, learnerId } = app();
  const itemId = String(formData.get('itemId') ?? '');
  await removeKnowledgeRelation(ctx, learnerId, String(formData.get('relationId') ?? ''));
  revalidatePath(`/knowledge/${itemId}`);
}
