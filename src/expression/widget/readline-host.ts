// ReadlineHost — abstract input pump consumed by `InteractiveModal
// Session`. Two impls live alongside:
//
//   - `createNodeReadlineHost(stream)` — wraps Node's `readline` for
//     the standalone process path (e.g. external `monad setup`).
//   - `createTestReadlineHost(events)` — fully synchronous; flushes
//     pre-recorded line/key events. Used in unit tests and
//     deterministic snapshot scenarios.
//
// The session never reads from `process.stdin` directly. That keeps
// it host-agnostic — the same session can run inside the dashboard's
// modal-lifecycle (where input comes from the routed key dispatch)
// or in a child process, with neither path knowing about the other.
//
// The host emits two event kinds:
//
//   - `'line'` — a complete answer line (after Enter), useful for
//     text / secret / number / list-* fields.
//   - `'key'`  — a single keypress, useful for confirm prompts,
//     pickers, and modal navigation.
//
// `close()` is idempotent — sessions call it on cancel / done.

import { createInterface, type Interface as ReadlineInterface } from 'readline';
import type { ModalKey } from './key-route.js';

// `ModalKey` is exposed via the `'key'` event variant of
// `ReadlineEvent` so future hosts (dashboard widget path) can emit
// rich keypress payloads without changing the consumer surface.
export type { ModalKey };

export type ReadlineEvent =
  | { kind: 'line'; value: string }
  | { kind: 'key'; key: ModalKey };

export type ReadlineListener = (ev: ReadlineEvent) => void;

export interface ReadlineHost {
  /** Subscribe to input events. Returns an unsubscribe function. */
  on(listener: ReadlineListener): () => void;
  /** Stop accepting input + release any underlying resources. */
  close(): void;
  /** True after `close()` has been called at least once. */
  readonly closed: boolean;
}

// ── Test impl ───────────────────────────────────────────────────────

export interface TestReadlineHost extends ReadlineHost {
  /** Flush a pre-recorded sequence of events synchronously. */
  emit(ev: ReadlineEvent): void;
  /** Flush several events in order. */
  emitAll(events: ReadonlyArray<ReadlineEvent>): void;
}

export function createTestReadlineHost(): TestReadlineHost {
  const listeners = new Set<ReadlineListener>();
  let closed = false;
  const host: TestReadlineHost = {
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(ev) {
      if (closed) return;
      for (const l of [...listeners]) l(ev);
    },
    emitAll(events) {
      for (const ev of events) host.emit(ev);
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
    },
    get closed() {
      return closed;
    },
  };
  return host;
}

// ── Node impl ───────────────────────────────────────────────────────

export interface NodeReadlineHostOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/** Line-based readline host. Keypress events are deliberately omitted
 *  for this revision — the first consumer (setup wizard) is line-only.
 *  When the dashboard widget path lands we'll add a `KeypressNodeHost`
 *  variant rather than make this option-shaped. */
export function createNodeReadlineHost(opts: NodeReadlineHostOptions = {}): ReadlineHost {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const rl: ReadlineInterface = createInterface({ input, output });
  const listeners = new Set<ReadlineListener>();
  let closed = false;

  const onLine = (line: string) => {
    if (closed) return;
    for (const l of [...listeners]) l({ kind: 'line', value: line });
  };
  rl.on('line', onLine);

  // ⛔⭐⭐⭐ 비-TTY(백그라운드) stdin 은 EOF 에서 'close' 만 쏘고 'line' 은 «영영» 안 온다.
  //  'line' 만 듣고 있으면 질문 promise 가 안 풀리고, 이벤트 루프가 비면서 프로세스가
  //  «exit 0 으로 조용히» 죽는다 — 30분 타임아웃보다 나쁘다(그건 abandoned 로 관측을 남긴다).
  //  ⇒ EOF 를 «취소»로 옮긴다. 새 이벤트 종류를 만들지 않고 기존 어휘(escape=cancel)를 쓴다.
  //  실측 2026-08-04([S]): timeoutMs 를 6배로 올려도 종료 시각이 안 늘어 「타임아웃이 아님」이 갈렸다.
  const onClose = () => {
    if (closed) return;
    for (const l of [...listeners]) l({ kind: 'key', key: { name: 'escape' } });
    // ⭐ 스스로 닫는다 — 열어 두면 다음 질문이 또 매달린다.
    closed = true;
    listeners.clear();
  };
  rl.on('close', onClose);

  return {
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      rl.off('line', onLine);
      rl.off('close', onClose);
      try {
        rl.close();
      } catch { /* ignore — host must be idempotent */ }
    },
    get closed() {
      return closed;
    },
  };
}
