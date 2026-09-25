// ── T2 (Phase 1) — Caret context store ──
//
// Tiny ring buffer that the caret-focus consumer pushes "where did
// the user click last" metadata into. The next-turn prompt builder
// reads it (`drainCaret()`) and prepends a `<caret>row=N col=M
// surface=X</caret>` segment so the LLM can reason about pointer
// context.
//
// We keep this dependency-free + sync because the consumer chain is
// sync, and the prompt builder reads on the next turn boundary. No
// I/O involved — the entire mechanism is in-process.

export interface CaretContextEntry {
  readonly surfaceId: string;
  readonly paneKind: 'terminal' | 'external-terminal' | 'preview-terminal';
  readonly row: number;
  readonly col: number;
  /** Wall-clock — useful for the prompt to know recency. */
  readonly at: number;
}

export interface CaretContextStore {
  push(entry: CaretContextEntry): void;
  /** Snapshot without clearing. */
  peek(): readonly CaretContextEntry[];
  /** Snapshot + clear. Call when the next prompt is built. */
  drain(): readonly CaretContextEntry[];
  /** Diagnostic — current size. */
  size(): number;
}

const DEFAULT_RING_SIZE = 4;

export function createCaretContextStore(
  opts: { ringSize?: number } = {},
): CaretContextStore {
  const ring: CaretContextEntry[] = [];
  const cap = opts.ringSize ?? DEFAULT_RING_SIZE;

  return {
    push(entry) {
      ring.push(entry);
      while (ring.length > cap) ring.shift();
    },
    peek() {
      return ring.slice();
    },
    drain() {
      const snapshot = ring.slice();
      ring.length = 0;
      return snapshot;
    },
    size() {
      return ring.length;
    },
  };
}

/** Format the caret ring into a single prompt fragment. Returns null
 *  when the store is empty so the prompt builder can skip emission. */
export function formatCaretPromptFragment(
  entries: readonly CaretContextEntry[],
): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((e) =>
    `  caret surface=${e.surfaceId} pane=${e.paneKind} row=${e.row} col=${e.col}`,
  );
  return `<recent-mouse-context>\n${lines.join('\n')}\n</recent-mouse-context>`;
}
