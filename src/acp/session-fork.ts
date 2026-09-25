// ── Session Fork (codex ForkSnapshot 이식 · 2026-07-09) ───────────────────
//
// 대표: "codex의 세션 fork 기능을 도입하라." codex ForkSnapshot(codex-rs/core/src/
// thread_manager.rs) 개념 이식: 세션 히스토리(rollout)를 복제하고 절단 지점을 정해 분기.
// Self-Evolution 격리 구현에서 "한 세션을 fork해 병렬 다방향 실험"(worktree와 결합).
//
// 두 모드(codex 동형):
//   truncate-before-nth-user(n) — n번째 사용자 메시지 직전으로 시간여행(그 이후 버림)
//   interrupted — 현재 상태 그대로 fork(진행 중이면 aborted 마커 부착)
//
// lineage: parentSessionId·forkedFromIndex. persistent(JSONL) | ephemeral(메모리).
// 순수 히스토리 로직 + 주입 fs(persist 테스트). 언어이식 아니라 개념이식(codex=Rust).

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';
export interface SessionMessage {
  role: MessageRole;
  content: string;
  turnId?: string;
}

export type ForkMode =
  | { kind: 'truncate-before-nth-user'; n: number }
  | { kind: 'interrupted' };

export interface ForkedSession {
  id: string;
  parentId: string;
  mode: ForkMode;
  createdAt: string;
  forkedFromIndex: number;   // 원본에서 잘라낸 경계(이 index 이전만 유지)
  items: SessionMessage[];
}

/** 사용자 메시지의 위치(index) 목록 — 절단 계산 기반(codex user_message_positions). */
export function userMessagePositions(items: SessionMessage[]): number[] {
  const pos: number[] = [];
  items.forEach((m, i) => { if (m.role === 'user') pos.push(i); });
  return pos;
}

/** n번째(1-based) 사용자 메시지 직전으로 절단 — 그 index 이전 items 만 유지.
 *  n=1 → 첫 사용자 메시지 이전(=빈 히스토리·fresh). n=positions.length+1 → 전체 유지.
 *  범위 밖 n → 클램프. codex TruncateBeforeNthUserMessage 동형. */
export function truncateBeforeNthUser(items: SessionMessage[], n: number): { items: SessionMessage[]; boundary: number } {
  const pos = userMessagePositions(items);
  if (n <= 0) return { items: [], boundary: 0 };
  if (n > pos.length) return { items: [...items], boundary: items.length };
  const boundary = pos[n - 1]!;      // n번째 user 메시지 index
  return { items: items.slice(0, boundary), boundary };
}

/** 진행 중(마지막이 assistant/tool 이면 mid-turn) fork — aborted 마커 부착(codex Interrupted). */
export function forkInterrupted(items: SessionMessage[]): { items: SessionMessage[]; boundary: number } {
  const clone = [...items];
  const last = clone[clone.length - 1];
  if (last && (last.role === 'assistant' || last.role === 'tool')) {
    clone.push({ role: 'system', content: '[turn aborted — forked mid-turn]' });
  }
  return { items: clone, boundary: items.length };
}

/** 세션 fork — 모드에 따라 히스토리 복제·절단 + lineage 부여. */
export function forkSession(parentId: string, items: SessionMessage[], mode: ForkMode, now?: () => string): ForkedSession {
  const { items: forked, boundary } = mode.kind === 'truncate-before-nth-user'
    ? truncateBeforeNthUser(items, mode.n)
    : forkInterrupted(items);
  return {
    id: randomUUID(),
    parentId,
    mode,
    createdAt: now?.() ?? new Date().toISOString(),
    forkedFromIndex: boundary,
    items: forked,
  };
}

/** JSONL 영속(persistent fork) — 헤더(메타) + 메시지 라인. */
export function persistFork(path: string, session: ForkedSession): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines: string[] = [];
  lines.push(JSON.stringify({ type: 'fork-meta', id: session.id, parentId: session.parentId, mode: session.mode, createdAt: session.createdAt, forkedFromIndex: session.forkedFromIndex }));
  for (const m of session.items) lines.push(JSON.stringify({ type: 'msg', ...m }));
  writeFileSync(path, lines.join('\n') + '\n');
}

/** JSONL 복원. */
export function loadFork(path: string): ForkedSession {
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const meta = JSON.parse(lines[0]!) as any;
  const items: SessionMessage[] = lines.slice(1).map(l => {
    const { type, ...rest } = JSON.parse(l) as any;
    return rest as SessionMessage;
  });
  return { id: meta.id, parentId: meta.parentId, mode: meta.mode, createdAt: meta.createdAt, forkedFromIndex: meta.forkedFromIndex, items };
}
