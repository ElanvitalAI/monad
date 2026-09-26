// M3 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — agent.plan
// renderer. Numbered step list with status badges. Emit caller (LLM tool
// integration) lands in a follow-up; this PR exercises the renderer with
// mock envelopes so the visual parity contract is locked early.

'use client';

import { cn } from '@/lib/utils';
import type { ChatBlock } from '@/lib/chat-runtime';

type Block = Extract<ChatBlock, { kind: 'agent_plan' }>;
type StepStatus = Block['steps'][number]['status'];

const STEP_GLYPH: Record<StepStatus, string> = {
  pending: '○',
  'in-progress': '◐',
  done: '●',
  skipped: '⊘',
};

const STEP_TONE: Record<StepStatus, string> = {
  pending: 'text-muted-foreground',
  'in-progress': 'text-amber-300',
  done: 'text-emerald-400',
  skipped: 'text-muted-foreground/60 line-through',
};

export function PlanBlock({ block }: { block: Block }) {
  return (
    <div
      data-elanous-block-kind="agent_plan"
      data-elanous-block-id={block.blockId}
      data-elanous-plan-ref={block.ref}
      className="rounded border border-border bg-muted/20 px-2 py-1.5 text-xs font-mono"
    >
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Plan · {block.ref}</span>
        {typeof block.activeIndex === 'number' && block.steps.length > 0 && (
          <span>
            {block.activeIndex + 1}/{block.steps.length}
          </span>
        )}
      </div>
      <ol className="m-0 list-none space-y-0.5 p-0">
        {block.steps.map((step, idx) => {
          const isActive = idx === block.activeIndex;
          return (
            <li
              key={idx}
              data-elanous-step-index={idx}
              data-elanous-step-status={step.status}
              className={cn(
                'flex items-start gap-2 leading-snug',
                STEP_TONE[step.status],
                isActive && step.status !== 'done'
                  ? 'font-semibold motion-safe:animate-pulse'
                  : undefined,
              )}
            >
              <span aria-hidden="true" className="select-none">
                {STEP_GLYPH[step.status]}
              </span>
              <span className="flex-1 whitespace-pre-wrap">{step.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
