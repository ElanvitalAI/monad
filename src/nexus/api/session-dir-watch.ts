// ── 라이브 세션 cross-process 워처 (S3b · 2026-07-10) ──────────────────────
//
// S3a(session-store-events)는 데몬 in-process onSessionCreated/onMessageAppended
// 만 SSE 로 브릿지한다 → 텔레그램 등 데몬 안에서 도는 세션만 즉시 갱신되고, 별
// 프로세스(CLI `elanous`·agent-cli)가 디스크에 쓴 세션은 놓쳐 PWA 가 10s 폴링 폴백에
// 의존했다. 이 워처는 sessionRoot() 를 fs.watch 로 감시해 그 갭을 메운다:
//   - 새 {id}.jsonl 등장 → session.created(source=external)
//   - 기존 {id}.jsonl 변경 → session.updated(세션별 스로틀 · in-process 와 동일)
// 분류 로직은 순수 함수(classifyWatchEvent)로 분리해 fs.watch 타이밍 없이 테스트.
// 설계: 내부 문서 `DESIGN-live-session-management-2026-07-09` §S3(cross-process).

import { watch, readdirSync, type FSWatcher } from 'node:fs';
import { sessionRoot } from '../../session/index.js';
import type { NexusEventBus } from './event-bus.js';

const UPDATE_THROTTLE_MS = 2000;

export interface SessionWatchState {
  known: Set<string>;              // 관측된 세션 id(신규 감지 기준)
  lastUpdate: Map<string, number>; // 세션별 마지막 update 발행 시각(스로틀)
}

export function makeSessionWatchState(seedIds: Iterable<string> = []): SessionWatchState {
  return { known: new Set(seedIds), lastUpdate: new Map() };
}

export type WatchEmit =
  | { kind: 'session.created' | 'session.updated'; sessionId: string }
  | null;

/** fs.watch 파일명 이벤트 → 발행할 세션 이벤트(순수·부작용은 state 변이만).
 *  .jsonl 아니면 무시. 미관측 id=created(등록). 관측 id=updated(스로틀 내 재발화 억제). */
export function classifyWatchEvent(
  state: SessionWatchState,
  filename: string | null,
  nowMs: number,
  throttleMs: number = UPDATE_THROTTLE_MS,
): WatchEmit {
  if (!filename || !filename.endsWith('.jsonl')) return null;
  const sessionId = filename.slice(0, -'.jsonl'.length);
  if (!sessionId) return null;
  if (!state.known.has(sessionId)) {
    state.known.add(sessionId);
    state.lastUpdate.set(sessionId, nowMs); // 생성 직후 update 중복 억제
    return { kind: 'session.created', sessionId };
  }
  const last = state.lastUpdate.get(sessionId);
  if (last !== undefined && nowMs - last < throttleMs) return null; // 세션별 스로틀
  state.lastUpdate.set(sessionId, nowMs);
  return { kind: 'session.updated', sessionId };
}

/** 데몬 부팅에서 1회 호출 — sessionRoot() fs.watch 를 eventBus 로 브릿지. 해제 함수 반환.
 *  fail-soft: watch 불가/에러여도 크래시 없이 폴링 폴백 유지(unwatch no-op 반환). */
export function wireSessionDirWatch(
  bus: Pick<NexusEventBus, 'publish'>,
  opts: { root?: string; now?: () => number; throttleMs?: number } = {},
): () => void {
  const root = opts.root ?? sessionRoot();
  const now = opts.now ?? Date.now;
  const throttleMs = opts.throttleMs ?? UPDATE_THROTTLE_MS;

  let seed: string[] = [];
  try { seed = readdirSync(root).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -'.jsonl'.length)); } catch { /* dir 아직 없음 */ }
  const state = makeSessionWatchState(seed);

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(root, (_event, filename) => {
      try {
        const emit = classifyWatchEvent(state, filename == null ? null : String(filename), now(), throttleMs);
        if (!emit) return;
        bus.publish({
          ts: now(),
          kind: emit.kind,
          detail: emit.kind === 'session.created'
            ? { sessionId: emit.sessionId, source: 'external' }
            : { sessionId: emit.sessionId },
        });
      } catch { /* 이벤트 처리 실패가 워처를 죽이면 안 됨 */ }
    });
    watcher.on('error', () => { /* fail-soft — watch 에러가 부팅/데몬을 죽이면 안 됨 */ });
  } catch { /* watch 미지원/권한 — 폴링 폴백 유지 */ }

  return () => { try { watcher?.close(); } catch { /* */ } };
}
