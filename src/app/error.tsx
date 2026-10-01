'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Global error boundary: friendly message, never a raw stack trace. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ui]', error.message);
  }, [error]);

  return (
    <div className="mt-10 rounded-2xl border border-ink-200 bg-white p-6 text-center">
      <p className="text-sm font-medium">这个页面没能加载出来</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-400">
        你的学习数据没有受影响。可以重试，或者回首页继续。
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-medium text-white"
        >
          重试
        </button>
        <Link
          href="/"
          className="rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-medium"
        >
          回首页
        </Link>
      </div>
    </div>
  );
}
