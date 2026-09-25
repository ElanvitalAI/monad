// ── BlockStore (BL1) ──
//
// Session M 의 UB toolbelt 가 [Attach] 버튼을 노출만 하고 실제
// 동작은 stub 이었다. BL 트랙은 PTY stdout 을 "블록" 단위로
// 파싱해 세션별 ring buffer 에 저장, toolbelt 클릭이나 chat
// `@session:<id>` 에서 최신 블록을 LLM 프롬프트 context 로
// 주입할 수 있게 한다. Warp 의 block-as-context (CMD-UP) 패턴의
// monad 대응.
//
// 블록 경계는 파서 (BL2 claude-code JSONL, BL3 codex heuristic)
// 가 정의한다. 이 모듈은 경계 인식을 하지 않고 순수 저장소.
//
// 설계 원칙:
// - push(sessionId, block) 은 commit 된 블록만 받는다. in-flight
//   블록은 파서의 내부 상태. 이 스토어는 "완성된 것만" 본다.
// - ring buffer cap 은 세션별 기본 10. 환경변수
//   `MONAD_BLOCK_STORE_CAP` 으로 전역 override.
// - subscribe(cb) 는 block commit 마다 발화 — NT2 에서
//   notification-store 연결에 사용.

export interface Block {
  readonly id: string;
  readonly sessionId: string;
  /** Source parser. 'claude-code' | 'codex' | 'other'. */
  readonly kind: string;
  readonly startedAt: number;
  readonly endedAt: number;
  /** Collected plain text (deltas concatenated). Capped by the
   *  parser before push — see BL2 `TEXT_CAP_CHARS`. */
  readonly text: string;
  /** Raw event tags the parser saw while assembling (debug aid
   *  + future richer rendering). Optional — parsers may skip. */
  readonly events?: readonly string[];
  /** Optional free-form meta (tool names, error codes, …). */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** BL-E3 bookmark — when true, ring-buffer rotation skips this
   *  block. Flipped via BlockStore.pin/unpin. Default false. */
  pinned?: boolean;
}

export interface BlockStoreOpts {
  /** Per-session ring cap. Default 10. */
  capPerSession?: number;
  /** Injected clock — tests use a monotonic counter. */
  now?: () => number;
}

export type BlockStoreSubscriber = (block: Block) => void;

const DEFAULT_CAP = 10;

function envCap(): number | undefined {
  const raw = process.env['MONAD_BLOCK_STORE_CAP'];
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export class BlockStore {
  private readonly buffers = new Map<string, Block[]>();
  private readonly subs = new Set<BlockStoreSubscriber>();
  private readonly cap: number;
  private readonly now: () => number;
  private seq = 0;

  constructor(opts: BlockStoreOpts = {}) {
    this.cap = opts.capPerSession ?? envCap() ?? DEFAULT_CAP;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Create a new block id that is stable within one store instance. */
  nextId(): string {
    return `blk:${++this.seq}`;
  }

  push(sessionId: string, block: Omit<Block, 'id' | 'sessionId'>): Block {
    const committed: Block = {
      id: this.nextId(),
      sessionId,
      ...block,
    };
    let arr = this.buffers.get(sessionId);
    if (!arr) {
      arr = [];
      this.buffers.set(sessionId, arr);
    }
    arr.push(committed);
    // BL-E3 — rotation skips pinned blocks. Drop the oldest
    // non-pinned entry when over cap; if everything is pinned we
    // leave the buffer over cap rather than silently evicting a
    // bookmarked block (safer than clearing user intent).
    while (arr.length > this.cap) {
      const idx = arr.findIndex(b => !b.pinned);
      if (idx < 0) break;
      arr.splice(idx, 1);
    }
    for (const cb of this.subs) cb(committed);
    return committed;
  }

  /** BL-E3 — bookmark a block so ring rotation won't drop it.
   *  Returns true when the block was found + flipped. */
  pin(sessionId: string, blockId: string): boolean {
    const arr = this.buffers.get(sessionId);
    if (!arr) return false;
    const block = arr.find(b => b.id === blockId);
    if (!block) return false;
    if (block.pinned) return false;
    block.pinned = true;
    return true;
  }

  /** BL-E3 — remove a bookmark. Returns true when flipped. */
  unpin(sessionId: string, blockId: string): boolean {
    const arr = this.buffers.get(sessionId);
    if (!arr) return false;
    const block = arr.find(b => b.id === blockId);
    if (!block) return false;
    if (!block.pinned) return false;
    block.pinned = false;
    return true;
  }

  /** BL-E3 — snapshot of bookmarks for a session. */
  pinned(sessionId: string): Block[] {
    const arr = this.buffers.get(sessionId) ?? [];
    return arr.filter(b => b.pinned).slice();
  }

  getLatest(sessionId: string): Block | undefined {
    const arr = this.buffers.get(sessionId);
    return arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
  }

  list(sessionId: string, limit?: number): Block[] {
    const arr = this.buffers.get(sessionId) ?? [];
    if (limit === undefined || limit >= arr.length) return arr.slice();
    return arr.slice(arr.length - limit);
  }

  clear(sessionId: string): void {
    this.buffers.delete(sessionId);
  }

  clearAll(): void {
    this.buffers.clear();
  }

  /** Inspect the current `now()` without mutating — exposed so
   *  parsers can stamp `startedAt` / `endedAt` from the same clock. */
  clock(): number {
    return this.now();
  }

  subscribe(cb: BlockStoreSubscriber): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  /** Snapshot — diagnostic aid, e.g. UB3 [Status] toolbelt could
   *  use this to show the last N blocks alongside the status. */
  entries(): Array<[string, readonly Block[]]> {
    return [...this.buffers.entries()].map(([id, arr]) => [id, arr.slice()]);
  }
}
