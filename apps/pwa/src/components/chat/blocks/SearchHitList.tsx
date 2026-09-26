// M4 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — tool.search-hit
// renderer. Streaming hit list with file:line + snippet preview. Click a
// hit to open in the editor (deep link via vscode:// — falls back to
// a copy-friendly path text node when the user has no handler registered).

'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatBlock } from '@/lib/chat-runtime';

type Block = Extract<ChatBlock, { kind: 'tool_search_hits' }>;
type Hit = Block['hits'][number];

const COLLAPSED_HITS = 5;

function vscodeLink(hit: Hit): string {
  // vscode:// goto syntax — works for both code.app and code-insiders
  // when the handler is registered system-wide. Browsers that don't
  // know the scheme degrade to "open external app?" prompt; users
  // can right-click → copy link to paste into their terminal.
  const col = hit.column ?? 1;
  return `vscode://file/${hit.filePath}:${hit.line}:${col}`;
}

function HitRow({ hit }: { hit: Hit }) {
  return (
    <li
      data-elanous-search-hit-file={hit.filePath}
      data-elanous-search-hit-line={hit.line}
      className="rounded px-2 py-1 hover:bg-muted/30"
    >
      <a
        href={vscodeLink(hit)}
        className="block"
        // No noreferrer — vscode:// is local-handler only; opening in
        // a new tab on browser fallback is harmless.
        target="_blank"
        rel="noopener"
      >
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-semibold truncate">{hit.filePath}</span>
          <span className="text-muted-foreground">:{hit.line}</span>
          {hit.column !== undefined && (
            <span className="text-muted-foreground">:{hit.column}</span>
          )}
        </div>
        {(hit.contextBefore?.length ?? 0) > 0 && (
          <pre className="m-0 mt-0.5 whitespace-pre-wrap break-words text-[10px] text-muted-foreground/70">
            {hit.contextBefore!.join('\n')}
          </pre>
        )}
        <pre className="m-0 whitespace-pre-wrap break-words text-[10px] text-foreground">
          {hit.snippet}
        </pre>
        {(hit.contextAfter?.length ?? 0) > 0 && (
          <pre className="m-0 whitespace-pre-wrap break-words text-[10px] text-muted-foreground/70">
            {hit.contextAfter!.join('\n')}
          </pre>
        )}
      </a>
    </li>
  );
}

export function SearchHitList({ block }: { block: Block }) {
  const [showAll, setShowAll] = useState(false);
  const hitsCount = block.hits.length;
  const visible = showAll ? block.hits : block.hits.slice(0, COLLAPSED_HITS);
  const moreCount = hitsCount - visible.length;
  return (
    <div
      data-elanous-block-kind="tool_search_hits"
      data-elanous-block-id={block.blockId}
      data-elanous-search-query={block.query}
      data-elanous-accum-count={block.accumCount}
      className={cn(
        'rounded border border-border bg-muted/20 px-2 py-1 text-xs font-mono',
      )}
    >
      <div className="flex items-baseline gap-2 mb-1">
        <span aria-hidden="true">🔎</span>
        <span className="font-semibold">{block.query}</span>
        <span className="text-[10px] text-muted-foreground">
          {block.accumCount} hit{block.accumCount === 1 ? '' : 's'}
        </span>
        {block.truncated && (
          <span className="text-[10px] text-amber-300">truncated</span>
        )}
      </div>
      {hitsCount === 0 ? (
        <div className="text-[10px] text-muted-foreground italic">
          (no hits yet)
        </div>
      ) : (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {visible.map((hit, idx) => (
            <HitRow key={`${hit.filePath}:${hit.line}:${idx}`} hit={hit} />
          ))}
        </ul>
      )}
      {moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1 w-full rounded bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/60"
        >
          + {moreCount} more
        </button>
      )}
      {showAll && hitsCount > COLLAPSED_HITS && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-1 w-full rounded bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/60"
        >
          collapse
        </button>
      )}
    </div>
  );
}
