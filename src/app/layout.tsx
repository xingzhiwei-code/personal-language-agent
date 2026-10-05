import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { APP_VERSION_LABEL } from '@/config/version';
import './globals.css';

export const metadata: Metadata = {
  title: '语言学习助手',
  description: '一个会适应你的个人语言学习系统：目标、复习、对话与学习状态都在本地。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const NAV = [
  { href: '/', label: '首页' },
  { href: '/knowledge', label: '知识库' },
  { href: '/history', label: '历史' },
  { href: '/goals', label: '目标' },
  { href: '/settings', label: '设置' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-24 sm:px-6 sm:pb-10">
          <header className="flex flex-wrap items-center justify-between gap-3 py-5">
            <Link href="/" className="text-sm font-semibold tracking-tight text-ink-900">
              语言学习助手
              <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-normal text-ink-400">
                {APP_VERSION_LABEL}
              </span>
            </Link>
            <nav aria-label="主导航" className="hidden gap-1 sm:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>

          <main className="flex-1">{children}</main>
        </div>

        {/* Mobile bottom navigation */}
        <nav
          aria-label="主导航"
          className="fixed inset-x-0 bottom-0 z-10 flex border-t border-ink-200 bg-white/95 backdrop-blur sm:hidden"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 px-1 py-3 text-center text-xs text-ink-600"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </body>
    </html>
  );
}
