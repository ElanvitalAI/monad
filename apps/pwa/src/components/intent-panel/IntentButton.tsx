// CV-3 mobile-readiness #1 · single intent button.
//
// Pure presenter — receives label + confidence + onClick; renders
// a button whose visual intensity scales with confidence. Pattern
// mirrors the β-1a HitlBannerView split: container does the
// hook + state, view renders deterministic markup so tests can
// pin via renderToStaticMarkup without DOM.

'use client';

import type { IntentButtonLabel } from './use-intent-prediction';
import { confidenceToIntensity } from './use-intent-prediction';

export interface IntentButtonProps {
  label: IntentButtonLabel;
  confidence: number;
  /** Optional rationale text — surfaced as a tooltip / aria-label
   *  for dev tooling + accessibility. */
  reason?: string;
  /** True while ANY button in the panel is mid-submit. The whole
   *  grid disables to prevent double-tap during the brief POST. */
  disabled: boolean;
  onTap: () => void;
}

/** Tailwind class name for a given intensity level. Returning a
 *  fixed lookup table (not template literal interpolation) so
 *  Tailwind's JIT extractor sees every class string at build time. */
function bgClassForIntensity(intensity: number): string {
  switch (intensity) {
    case 600: return 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600';
    case 500: return 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-500';
    case 400: return 'bg-emerald-400 hover:bg-emerald-500 text-emerald-950 border-emerald-400';
    case 300: return 'bg-emerald-300 hover:bg-emerald-400 text-emerald-950 border-emerald-300';
    case 200: return 'bg-emerald-200 hover:bg-emerald-300 text-emerald-950 border-emerald-200';
    case 100:
    default:  return 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300 dark:border-zinc-700';
  }
}

export function IntentButton({
  label,
  confidence,
  reason,
  disabled,
  onTap,
}: IntentButtonProps) {
  const intensity = confidenceToIntensity(confidence);
  const bgClass = bgClassForIntensity(intensity);
  const conf = `${Math.round(confidence * 100)}%`;
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={disabled}
      data-testid={`intent-button-${label}`}
      data-confidence={confidence.toFixed(3)}
      data-intensity={intensity}
      title={reason ? `${label} · ${conf} · ${reason}` : `${label} · ${conf}`}
      aria-label={`${label} · 신뢰도 ${conf}${reason ? ` · ${reason}` : ''}`}
      className={`flex flex-col items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${bgClass}`}
    >
      <span className="leading-tight">{label}</span>
      <span className="mt-0.5 text-[10px] opacity-70">{conf}</span>
    </button>
  );
}
