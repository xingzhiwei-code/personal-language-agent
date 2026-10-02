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
import { pauseKnowledgeItems, promoteKnowledgeItems } from '@/application/knowledge-pool';
import {
  knowledgeRelationTypeSchema,
  knowledgeStatusSchema,
  knowledgeTypeSchema,
} from '@/domain/enums';
import { validationFailed } from '@/domain/errors';
import { app, toActionError, type ActionResult } from '@/server/app';

export async function createKnowledgeAction(
  _prev: ActionResult<{ id: string; deduplicated: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; deduplicated: boolean }>> {
  const { ctx, learnerId } = app();
  const text = String(formData.get('text') ?? '').trim();
  const typeRaw = String(formData.get('type') ?? 'auto');
  const example = String(formData.get('example') ?? '').trim();
  const sourceId = String(formData.get('sourceId') ?? '').trim() || null;

  try {
    const source = sourceId ? await ctx.repos.content.findSourceById(sourceId) : null;
    if (sourceId && (!source || source.learnerId !== learnerId)) {
      throw validationFailed('内容来源不存在');
    }
    const parsedType = typeRaw === 'auto' ? null : knowledgeTypeSchema.safeParse(typeRaw);
    if (parsedType && !parsedType.success) throw validationFailed('知识类型无效');
    const { item, deduplicated } = await createKnowledgeItem(ctx, {
      learnerId,
      text,
      type: parsedType?.data,
      meaning: String(formData.get('meaning') ?? '').trim() || null,
      notes: String(formData.get('notes') ?? '').trim() || null,
      languageCode: String(formData.get('languageCode') ?? 'en'),
      examples: example ? [{ text: example, origin: 'user' }] : [],
      origin: 'user',
      sourceType: source ? 'user_import' : 'user_manual',
      sourceId: source?.id ?? null,
      sourceRef: source ? `${source.title ?? '未命名文本'} · 用户手动摘录` : null,
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
    const typeRaw = formData.get('type');
    const statusRaw = formData.get('status');
    const type = typeRaw ? knowledgeTypeSchema.safeParse(String(typeRaw)) : null;
    const status = statusRaw ? knowledgeStatusSchema.safeParse(String(statusRaw)) : null;
    if ((type && !type.success) || (status && !status.success)) {
      throw validationFailed('知识类型或状态无效');
    }
    await updateKnowledgeItem(ctx, {
      learnerId,
      id,
      text: formData.get('text') ? String(formData.get('text')) : undefined,
      type: type?.data,
      meaning: formData.has('meaning') ? String(formData.get('meaning')) : undefined,
      notes: formData.has('notes') ? String(formData.get('notes')) : undefined,
      status: status?.data,
    });
    revalidatePath('/knowledge');
    revalidatePath(`/knowledge/${id}`);
    return { ok: true, message: '已保存' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function promoteKnowledgeBatchAction(
  _previous: ActionResult<{ count: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ count: number }>> {
  try {
    const { ctx, learnerId } = app();
    const promoted = await promoteKnowledgeItems(ctx, {
      learnerId,
      itemIds: formData.getAll('itemId').map(String),
    });
    revalidatePath('/');
    revalidatePath('/knowledge');
    revalidatePath('/knowledge/logs');
    return { ok: true, data: { count: promoted.length }, message: `已将 ${promoted.length} 条加入学习` };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function pauseKnowledgeBatchAction(
  _previous: ActionResult<{ count: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ count: number }>> {
  try {
    const { ctx, learnerId } = app();
    const paused = await pauseKnowledgeItems(ctx, {
      learnerId,
      itemIds: formData.getAll('itemId').map(String),
    });
    revalidatePath('/');
    revalidatePath('/knowledge');
    revalidatePath('/knowledge/logs');
    return { ok: true, data: { count: paused.length }, message: `已将 ${paused.length} 条暂停回池` };
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
    const type = knowledgeRelationTypeSchema.safeParse(String(formData.get('type') ?? 'related'));
    if (!type.success) throw validationFailed('知识关系类型无效');
    await addKnowledgeRelation(ctx, {
      learnerId,
      fromItemId,
      toItemId: String(formData.get('toItemId') ?? ''),
      type: type.data,
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
