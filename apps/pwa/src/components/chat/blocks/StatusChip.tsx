// M3 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — agent.status
// renderer. HUD-pulse parity for external CLI agents (claude-code · codex
// parser) once the M2-followup wires AgentStatusStore.subscribe into the
// SSE feedback channel. For now lands as the renderer half of the parity
// loop; mock envelopes in tests exercise it.

'use client';

import { cn } from '@/lib/utils';
import type { ChatBlock } from '@/lib/chat-runtime';

type Block = Extract<ChatBlock, { kind: 'agent_status' }>;

const STATUS_GLYPH: Record<Block['status'], string> = {
  running: '●',
  queued: '◌',
  done: '✓',
  error: '✗',
};

const STATUS_TONE: Record<Block['status'], string> = {
  running: 'border-amber-400/50 text-amber-300',
  queued: 'border-border text-muted-foreground',
  done: 'border-emerald-500/40 text-emerald-300',
  error: 'border-destructive/50 text-destructive',
};

export function StatusChip({ block }: { block: Block }) {
  const glyph = STATUS_GLYPH[block.status];
  const tone = STATUS_TONE[block.status];
  return (
    <div
      data-monad-block-kind="agent_status"
      data-monad-block-id={block.blockId}
      data-monad-agent-id={block.agentId}
      data-monad-status={block.status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border bg-muted/20 px-2 py-0.5 text-[11px] font-mono',
        tone,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          block.status === 'running'
            ? 'motion-safe:animate-pulse'
            : undefined,
        )}
      >
        {glyph}
      </span>
      <span className="font-semibold">{block.agentId}</span>
      <span className="uppercase tracking-wide text-[10px] text-muted-foreground">
        {block.status}
      </span>
      {block.lastEvent && (
        <span className="ml-1 truncate text-muted-foreground">
          · {block.lastEvent}
        </span>
      )}
    </div>
  );
}
