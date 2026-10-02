import Link from 'next/link';

const TABS = [
  { id: 'library', label: '知识条目', href: '/knowledge' },
  { id: 'sources', label: '已保存原文', href: '/knowledge/sources' },
  { id: 'history', label: '导入导出历史', href: '/knowledge/history' },
  { id: 'logs', label: '操作日志', href: '/knowledge/logs' },
] as const;

export function KnowledgeTabs({ active }: { active: (typeof TABS)[number]['id'] }) {
  return (
    <nav aria-label="知识库导航" className="flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? 'page' : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
            active === tab.id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
