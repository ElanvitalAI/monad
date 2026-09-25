// PR #5 — cap-policy LRU freeze candidate 산출.

import { describe, expect, test } from 'bun:test';
import {
  applyCapPolicy,
  DESKTOP_CAP,
  MOBILE_CAP,
} from '../apps/pwa/src/lib/workspace/cap-policy.js';
import {
  initialWorkspaceState,
  workspaceReducer,
  makeChatTab,
} from '../apps/pwa/src/lib/workspace/store.js';
import type { WorkspaceState } from '../apps/pwa/src/lib/workspace/types.js';

function buildState(n: number): WorkspaceState {
  let s = initialWorkspaceState;
  for (let i = 0; i < n; i++) {
    s = workspaceReducer(s, {
      type: 'addTab',
      tab: makeChatTab({ id: `t${i}`, sessionId: `s${i}`, createdAt: i * 1000 }),
    });
  }
  return s;
}

describe('applyCapPolicy', () => {
  test('cap 미만 → 후보 없음', () => {
    const s = buildState(3);
    const d = applyCapPolicy(s, DESKTOP_CAP, new Map());
    expect(d.freezeCandidates).toEqual([]);
  });

  test('cap 초과 시 가장 오래된 비활성 탭이 후보', () => {
    const s = buildState(9);
    // 마지막 add 가 active → t8 protect.
    const last = new Map<string, number>([
      ['t0', 100],
      ['t1', 200],
      ['t2', 300],
      ['t3', 400],
      ['t4', 500],
      ['t5', 600],
      ['t6', 700],
      ['t7', 800],
      ['t8', 900],
    ]);
    const d = applyCapPolicy(s, DESKTOP_CAP, last);
    // 9 alive · cap 8 → 1 후보. t0 가 가장 오래됨.
    expect(d.freezeCandidates).toEqual(['t0']);
  });

  test('activeId 는 항상 LRU 보호', () => {
    const s = buildState(9);
    // t0 가 active 라고 가정 — activate dispatch.
    const sActive = workspaceReducer(s, { type: 'activateTab', id: 't0' });
    const last = new Map<string, number>([
      ['t0', 1000], // 명시적으로 가장 최근
      ['t1', 200],
      ['t2', 300],
      ['t3', 400],
      ['t4', 500],
      ['t5', 600],
      ['t6', 700],
      ['t7', 800],
      ['t8', 900],
    ]);
    // activeId t0 — 1개 freeze 필요. lastActivatedAt asc 순회 시 t1
    // 이 가장 작음 (200) 이지만, sortable 은 모든 탭 포함이라 t0 의 ts
    // 이 다른 탭보다 큰지와 무관하게 active 보호 로직이 t0 를 skip.
    const d = applyCapPolicy(sActive, DESKTOP_CAP, last);
    expect(d.freezeCandidates).not.toContain('t0');
    expect(d.freezeCandidates).toEqual(['t1']);
  });

  test('mobile cap (5)', () => {
    const s = buildState(7);
    const last = new Map<string, number>(
      Array.from({ length: 7 }, (_, i) => [`t${i}`, (i + 1) * 100]),
    );
    const d = applyCapPolicy(s, MOBILE_CAP, last);
    // 7 alive · cap 5 → 2 후보. activate 한 적 없으므로 t6 가 default
    // active (마지막 add) — 보호. 결과: t0, t1.
    expect(d.freezeCandidates).toEqual(['t0', 't1']);
  });

  test('이미 frozen 인 탭은 alive 카운트에서 제외', () => {
    let s = buildState(9);
    s = workspaceReducer(s, { type: 'freezeTab', id: 't0' });
    // 8 alive (t0 frozen) · cap 8 → 후보 없음
    const d = applyCapPolicy(s, DESKTOP_CAP, new Map());
    expect(d.freezeCandidates).toEqual([]);
  });

  test('lastActivatedAt 누락된 탭은 createdAt 으로 fallback', () => {
    const s = buildState(9);
    // last 빈 map — 모든 탭이 createdAt 으로만 정렬. t0 createdAt=0 가
    // 가장 오래됨.
    const d = applyCapPolicy(s, DESKTOP_CAP, new Map());
    expect(d.freezeCandidates[0]).toBe('t0');
  });
});
