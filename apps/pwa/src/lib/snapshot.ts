/**
 * BACKLOG #3 — surface snapshot helper (chat input · scroll position ·
 * xterm scrollback).
 *
 * Workspace 의 LRU freeze (cap 8 desktop / 5 mobile) 가 비활성 탭의
 * React subtree 를 unmount 하면 컴포넌트 state 가 통째 reset 된다.
 * 본 helper 가 surface 별로 localStorage 에 가벼운 snapshot 을 두어
 * 재 mount 시 사용자 가시 컨텍스트 (입력 중 텍스트 · 스크롤 위치 ·
 * 터미널 스크롤백) 를 복원한다.
 *
 * Key 형식: `monad.pwa.snapshot.<surface>.<id>` — `surface` 는
 * `chatInput` | `chatScroll` | `xtermScrollback`, `id` 는 tabId 또는
 * terminalId. tabId 미지정 시 'singleton'.
 *
 * Persistence policy:
 * - per-entry cap 256 KB (xterm serialize buffer 최대 케이스 cover).
 *   초과 시 silent drop (snapshot 가치 < UI hang 방지).
 * - 글로벌 cleanup 은 BACKLOG follow-up — 현재는 key collision 없이
 *   기존 키 그대로 유지. 사용자 device storage 압박 시 발생할 수 있는
 *   문제는 dogfood 후 follow-up.
 */

const KEY_PREFIX = 'monad.pwa.snapshot.';
const MAX_ENTRY_BYTES = 256 * 1024;

export type SnapshotSurface = 'chatInput' | 'chatScroll' | 'xtermScrollback';

export function snapshotKey(surface: SnapshotSurface, id: string | undefined): string {
  return `${KEY_PREFIX}${surface}.${id && id.length > 0 ? id : 'singleton'}`;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSnapshot<T>(key: string): T | null {
  const ls = getStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    try { ls.removeItem(key); } catch { /* ignore quota errors */ }
    return null;
  }
}

export function saveSnapshot<T>(key: string, value: T): void {
  const ls = getStorage();
  if (!ls) return;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }
  if (serialized.length > MAX_ENTRY_BYTES) return;
  try {
    ls.setItem(key, serialized);
  } catch {
    /* quota exceeded — drop snapshot rather than throwing */
  }
}

export function clearSnapshot(key: string): void {
  const ls = getStorage();
  if (!ls) return;
  try { ls.removeItem(key); } catch { /* ignore */ }
}

/** Test seam: exposed limit for size-cap assertions. */
export const __INTERNAL_MAX_BYTES = MAX_ENTRY_BYTES;
