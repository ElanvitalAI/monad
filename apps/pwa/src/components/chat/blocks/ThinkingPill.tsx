// M3 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — agent.thinking
// renderer. Pulse + metrics while the bridge is live, ✓ + final metrics
// once phase=end lands. Matches TUI thinking-line semantics (msg + elapsed
// + token count) so the cross-surface parity gap closes.

'use client';

import { cn } from '@/lib/utils';
import type { ChatBlock } from '@/lib/chat-runtime';

type Block = Extract<ChatBlock, { kind: 'agent_thinking' }>;

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function fmtTokens(n: number): string {
  if (n <= 0) return '';
  const k = n / 1000;
  return k >= 1 ? `${k.toFixed(1)}k tokens` : `${n} tokens`;
}

export function ThinkingPill({ block }: { block: Block }) {
  const { msg, done, metrics } = block;
  const tail: string[] = [];
  if (metrics) {
    const elapsed = fmtElapsed(metrics.elapsedMs);
    if (elapsed && metrics.elapsedMs > 0) tail.push(elapsed);
    const tokens = fmtTokens(metrics.tokenCount);
    if (tokens) tail.push(tokens);
  }
  const tailStr = tail.length ? ` (${tail.join(' · ')})` : '';
  return (
    <div
      data-monad-block-kind="agent_thinking"
      data-monad-block-id={block.blockId}
      data-monad-done={done ? 'true' : 'false'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] font-mono',
        done
          ? 'border-border text-muted-foreground'
          : 'border-border/60 text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          done ? 'bg-emerald-500' : 'bg-amber-400 motion-safe:animate-pulse',
        )}
      />
      <span>
        {done ? '✓ ' : ''}
        {msg}
        {done ? '' : '…'}
        <span className="text-muted-foreground">{tailStr}</span>
      </span>
    </div>
  );
}
