import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-ink-200 bg-white/60 p-8 text-center">
      <p className="text-sm font-medium">找不到这个内容</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-400">
        可能已经被删除了，或者链接不对。
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-medium"
      >
        回首页
      </Link>
    </div>
  );
}
