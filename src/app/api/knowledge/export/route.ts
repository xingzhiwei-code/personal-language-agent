import { exportKnowledgeLibrary, type KnowledgeExportFormat } from '@/application/knowledge-export';
import type { KnowledgeStatus } from '@/domain/enums';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

const STATUS_MAP: Record<string, KnowledgeStatus[] | undefined> = {
  active: ['active'],
  pool: ['new'],
  mastered: ['user_mastered'],
  irrelevant: ['irrelevant'],
  all: undefined,
};

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const formatRaw = url.searchParams.get('format') ?? 'json';
    if (formatRaw !== 'json' && formatRaw !== 'csv') {
      return Response.json({ error: '导出格式无效' }, { status: 400 });
    }
    const format: KnowledgeExportFormat = formatRaw;
    const status = url.searchParams.get('status') ?? 'all';
    const text = url.searchParams.get('q')?.trim() || undefined;
    const tag = url.searchParams.get('tag')?.trim().toLowerCase() || undefined;
    const wordlistId = url.searchParams.get('wordlist')?.trim() || undefined;
    if (!(status in STATUS_MAP)) {
      return Response.json({ error: '筛选条件无效' }, { status: 400 });
    }
    const { ctx, learnerId } = app();
    const result = await exportKnowledgeLibrary(ctx, {
      learnerId,
      format,
      text,
      statuses: STATUS_MAP[status],
      tags: tag ? [tag] : undefined,
      wordlistIds: wordlistId ? [wordlistId] : undefined,
    });
    return new Response(result.body, {
      headers: {
        'content-type': result.contentType,
        'content-disposition': `attachment; filename="${result.filename}"`,
        'cache-control': 'no-store',
        'x-export-count': String(result.count),
      },
    });
  } catch (error) {
    console.error('[knowledge-export]', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: '导出失败，请稍后再试。' }, { status: 500 });
  }
}
