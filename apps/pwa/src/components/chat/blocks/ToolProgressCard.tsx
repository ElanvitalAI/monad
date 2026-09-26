// M5 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — tool.progress
// renderer. Bash stdout/stderr · HTTP body · large file read streaming
// tails. Collapsed by default — shows the latest line + line count;
// expanded shows the full buffer with monospace + a "✓ done" footer
// once phase=end fires.

'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatBlock } from '@/lib/chat-runtime';

type Block = Extract<ChatBlock, { kind: 'tool_progress' }>;

const STREAM_TONE: Record<Block['stream'], string> = {
  stdout: 'text-foreground',
  stderr: 'text-rose-300',
  http: 'text-amber-300',
  generic: 'text-muted-foreground',
};

const STREAM_GLYPH: Record<Block['stream'], string> = {
  stdout: '▌',
  stderr: '▌',
  http: '↹',
  generic: '·',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function ToolProgressCard({ block }: { block: Block }) {
  const [open, setOpen] = useState(false);
  const lineCount = block.lines.length;
  const tail = lineCount === 0 ? '' : block.lines[lineCount - 1]!;
  const exitTone =
    block.exitCode === undefined
      ? ''
      : block.exitCode === 0
        ? 'text-emerald-300'
        : 'text-rose-300';
  return (
    <div
      data-elanous-block-kind="tool_progress"
      data-elanous-block-id={block.blockId}
      data-elanous-stream={block.stream}
      data-elanous-done={block.done ? 'true' : 'false'}
      className="rounded border border-border bg-muted/20 px-2 py-1 text-xs font-mono"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span
          aria-hidden="true"
          className={cn(
            STREAM_TONE[block.stream],
            !block.done && 'motion-safe:animate-pulse',
          )}
        >
          {STREAM_GLYPH[block.stream]}
        </span>
        <span className="uppercase tracking-wide text-[10px] text-muted-foreground">
          {block.stream}
        </span>
        {!open && tail && (
          <span className={cn('flex-1 truncate', STREAM_TONE[block.stream])}>
            {tail}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>
            {lineCount} line{lineCount === 1 ? '' : 's'}
          </span>
          {block.bytesSoFar !== undefined && (
            <span>· {fmtBytes(block.bytesSoFar)}</span>
          )}
          {block.exitCode !== undefined && (
            <span className={exitTone}>· exit {block.exitCode}</span>
          )}
          {block.done && !block.exitCode && (
            <span className="text-emerald-300">· ✓</span>
          )}
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <pre
          className={cn(
            'm-0 mt-1 max-h-64 overflow-auto rounded bg-background/40 p-1.5 text-[11px] leading-tight whitespace-pre',
            STREAM_TONE[block.stream],
          )}
        >
          {block.lines.length === 0
            ? '(no output yet)'
            : block.lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
