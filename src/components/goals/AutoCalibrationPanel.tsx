'use client';

import {
  acknowledgeAutoCalibrationAction,
  applyAutoCalibrationAction,
  setAutoCalibrationAction,
} from '@/app/actions/learning';
import { buttonStyles, LinkButton } from '@/components/ui';

const CONFIDENCE_LABELS: Record<string, string> = { low: '低', medium: '中', high: '高' };

export interface CalibrationSuggestionView {
  suggestedValue: number;
  currentValue: number;
  confidence: string;
  basedOn: string;
}

/**
 * v0.5 §W3 — "adaptive starting point" switch + the (non-modal) calibration
 * suggestion with a three-way choice. Nothing takes effect until the user
 * confirms; the estimate is always shown as a hypothesis with its confidence.
 */
export function AutoCalibrationPanel({
  enabled,
  suggestion,
}: {
  enabled: boolean;
  suggestion: CalibrationSuggestionView | null;
}) {
  return (
    <div className="space-y-3">
      <form action={setAutoCalibrationAction} className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm text-ink-900">自适应起点</span>
          <p className="text-xs text-ink-400">根据学习数据建议调整，只有你确认后才生效</p>
        </div>
        <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
        <button
          type="submit"
          aria-pressed={enabled}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            enabled ? 'bg-accent-500' : 'bg-ink-200'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              enabled ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </form>

      {suggestion ? (
        <div className="rounded-xl border border-accent-200 bg-accent-50/60 p-3">
          <p className="text-sm text-ink-900">
            你的水平可能在 <span className="font-semibold tabular-nums">{suggestion.suggestedValue}</span>{' '}
            左右（之前是 {suggestion.currentValue}），要更新吗？
          </p>
          <p className="mt-0.5 text-xs text-ink-400">
            依据：{suggestion.basedOn} · 置信度：{CONFIDENCE_LABELS[suggestion.confidence] ?? suggestion.confidence}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={applyAutoCalibrationAction}>
              <input type="hidden" name="value" value={suggestion.suggestedValue} />
              <input type="hidden" name="confidence" value={suggestion.confidence} />
              <button type="submit" className={buttonStyles.primary}>
                更新
              </button>
            </form>
            <form action={acknowledgeAutoCalibrationAction}>
              <input type="hidden" name="value" value={suggestion.suggestedValue} />
              <button type="submit" className={buttonStyles.ghost}>
                保持不变
              </button>
            </form>
            <LinkButton href="/placement" variant="secondary">
              去重测
            </LinkButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
