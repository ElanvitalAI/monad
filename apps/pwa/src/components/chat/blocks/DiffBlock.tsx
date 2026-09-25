// M4 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — tool.diff
// renderer. Collapsible hunks with add/del/ctx tone — no Shiki yet
// (kept the PR scope tight; syntax highlighting can layer in a
// follow-up once we know the bundle-size budget). Block id stamped
// on the wrapper so the inspector can trace envelope → DOM.

'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatBlock } from '@/lib/chat-runtime';

type Block = Extract<ChatBlock, { kind: 'tool_diff' }>;
type HunkLine = Block['hunks'][number]['lines'][number];

const LINE_TONE: Record<HunkLine['kind'], string> = {
  add: 'bg-emerald-500/10 text-emerald-300',
  del: 'bg-rose-500/10 text-rose-300',
  ctx: 'text-muted-foreground',
};

const LINE_GLYPH: Record<HunkLine['kind'], string> = {
  add: '+',
  del: '-',
  ctx: ' ',
};

function hunkSummary(block: Block): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const h of block.hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') adds += 1;
      else if (l.kind === 'del') dels += 1;
    }
  }
  return { adds, dels };
}

export function DiffBlock({ block }: { block: Block }) {
  const [open, setOpen] = useState(false);
  const { adds, dels } = hunkSummary(block);
  const hunkCount = block.hunks.length;
  return (
    <div
      data-monad-block-kind="tool_diff"
      data-monad-block-id={block.blockId}
      data-monad-file-path={block.filePath}
      className="rounded border border-border bg-muted/20 px-2 py-1 text-xs font-mono"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span aria-hidden="true">⌥</span>
        <span className="font-semibold truncate">{block.filePath}</span>
        {block.language && (
          <span className="text-[10px] text-muted-foreground">
            ·{block.language}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[10px]">
          {adds > 0 && (
            <span className="text-emerald-300">+{adds}</span>
          )}
          {dels > 0 && (
            <span className="text-rose-300">-{dels}</span>
          )}
          <span className="text-muted-foreground">
            {hunkCount} hunk{hunkCount === 1 ? '' : 's'}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            {open ? '▾' : '▸'}
          </span>
        </span>
      </button>
      {open && (
        <div className="mt-1 overflow-x-auto rounded bg-background/40">
          {block.hunks.map((hunk, hi) => (
            <div
              key={hi}
              data-monad-hunk-index={hi}
              className="border-t border-border/40 first:border-t-0"
            >
              <div className="px-2 py-0.5 text-[10px] text-muted-foreground bg-muted/30">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                {hunk.newLines} @@
              </div>
              <pre className="m-0 whitespace-pre p-0 text-[11px] leading-tight">
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    data-monad-line-kind={line.kind}
                    className={cn(
                      'flex items-baseline px-2 py-px',
                      LINE_TONE[line.kind],
                    )}
                  >
                    <span aria-hidden="true" className="w-3 shrink-0 select-none">
                      {LINE_GLYPH[line.kind]}
                    </span>
                    <span className="flex-1">{line.text}</span>
                  </div>
                ))}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
