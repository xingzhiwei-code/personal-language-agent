import { exportLearnerData } from '@/application/data-management';
import { app } from '@/server/app';

export const dynamic = 'force-dynamic';

/** Human-readable JSON download of all local learning data. */
export async function GET(): Promise<Response> {
  const { ctx, learnerId } = app();
  try {
    const data = await exportLearnerData(ctx, learnerId);
    const filename = `language-learning-export-${data.exportedAt.slice(0, 10)}.json`;
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[export]', error instanceof Error ? error.message : 'unknown');
    return new Response(JSON.stringify({ error: '导出失败，请稍后再试。' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
