'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  executeFileImport,
  formatFromFileName,
  previewFileImport,
  type FileImportPreview,
  type FileImportResult,
  type WordlistFormat,
} from '@/application/importer';
import { validationFailed } from '@/domain/errors';
import { app, toActionError, type ActionResult } from '@/server/app';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export async function previewKnowledgeFileAction(
  _previous: ActionResult<FileImportPreview> | null,
  formData: FormData,
): Promise<ActionResult<FileImportPreview>> {
  try {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: '请选择要导入的文件' };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, message: '文件不能超过 10 MB' };
    }

    const format = formatFromFileName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const content = decodeUtf8(bytes);
    const fileHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const languageCode = String(formData.get('languageCode') ?? 'en');
    const { ctx, learnerId } = app();
    const preview = await previewFileImport(ctx, {
      learnerId,
      fileName: file.name,
      fileHash,
      format,
      content,
      languageCode,
    });
    await ctx.storage.put(stagingKey(learnerId, fileHash), bytes, file.type || 'text/plain');
    return { ok: true, data: preview, message: preview.duplicateFile ? '这个文件已经导入过' : '解析完成' };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

export async function confirmKnowledgeFileImportAction(
  _previous: ActionResult<FileImportResult> | null,
  formData: FormData,
): Promise<ActionResult<FileImportResult>> {
  const { ctx, learnerId } = app();
  const fileHash = String(formData.get('fileHash') ?? '');
  try {
    if (!HASH_PATTERN.test(fileHash)) throw validationFailed('上传预览已失效，请重新选择文件');
    const bytes = await ctx.storage.get(stagingKey(learnerId, fileHash));
    if (!bytes) return { ok: false, message: '上传预览已失效，请重新选择文件' };
    const actualHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (actualHash !== fileHash) throw validationFailed('上传文件校验失败，请重新选择文件');

    const format = String(formData.get('format') ?? '') as WordlistFormat;
    if (!['csv', 'json', 'txt'].includes(format)) throw validationFailed('导入格式无效');
    const result = await executeFileImport(ctx, {
      learnerId,
      fileName: String(formData.get('fileName') ?? '').slice(0, 300),
      fileHash,
      format,
      content: decodeUtf8(bytes),
      wordlistName: String(formData.get('wordlistName') ?? ''),
      languageCode: String(formData.get('languageCode') ?? 'en'),
      goalId: String(formData.get('goalId') ?? '').trim() || null,
    });
    await ctx.storage.delete(stagingKey(learnerId, fileHash));
    revalidatePath('/knowledge');
    revalidatePath('/knowledge/import');
    return {
      ok: true,
      data: result,
      message: result.duplicateFile
        ? '这个文件已经导入过，本次新增 0 条'
        : `导入完成：新增 ${result.addedCount} 条，跳过 ${result.duplicateCount} 条`,
    };
  } catch (error) {
    return { ok: false, message: toActionError(error) };
  }
}

function stagingKey(learnerId: string, fileHash: string): string {
  return `import-staging/${learnerId}/${fileHash.replace(':', '-')}`;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw validationFailed('文件不是有效的 UTF-8 文本，请转换编码后重试');
  }
}
