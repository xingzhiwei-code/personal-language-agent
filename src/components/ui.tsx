import Link from 'next/link';
import type { ReactNode } from 'react';

/** Shared presentational primitives. No business logic lives here. */

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'li';
}) {
  return (
    <Tag
      className={`rounded-2xl border border-ink-200 bg-white p-5 shadow-[0_1px_2px_rgba(28,30,26,0.04)] ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({
  title,
  action,
  hint,
}: {
  title: string;
  action?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-ink-400">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 bg-white/60 p-8 text-center">
      <p className="text-sm font-medium text-ink-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-400">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-accent-50 px-3 py-2 text-sm text-accent-600">{children}</p>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'ai';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-600',
    accent: 'bg-accent-100 text-accent-600',
    warn: 'bg-amber-100 text-amber-700',
    ai: 'bg-violet-100 text-violet-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Meter({ value, label }: { value: number; label?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? '进度'}
      >
        <div className="h-full rounded-full bg-accent-500" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-400">
        {percent}%
      </span>
    </div>
  );
}

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export const buttonStyles = {
  primary: `${buttonBase} bg-accent-500 px-4 py-2.5 text-white hover:bg-accent-600`,
  secondary: `${buttonBase} border border-ink-200 bg-white px-4 py-2.5 text-ink-900 hover:bg-ink-50`,
  ghost: `${buttonBase} px-3 py-2 text-ink-600 hover:bg-ink-100`,
  danger: `${buttonBase} bg-red-600 px-4 py-2.5 text-white hover:bg-red-700`,
};

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  className = '',
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof buttonStyles;
  className?: string;
}) {
  return (
    <Link href={href} className={`${buttonStyles[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeDays(iso: string | null): string {
  if (!iso) return '还没安排';
  const diff = Date.parse(iso) - Date.now();
  const days = Math.round(diff / 86_400_000);
  if (Number.isNaN(days)) return '—';
  if (days <= 0) return '现在可复习';
  if (days === 1) return '明天复习';
  return `${days} 天后复习`;
}
