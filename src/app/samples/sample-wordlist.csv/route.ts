import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const content = await readFile(resolve(process.cwd(), 'data/samples/sample-wordlist.csv'));
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sample-wordlist.csv"',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
