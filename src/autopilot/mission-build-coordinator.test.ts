import { describe, it, expect } from 'bun:test';
import { supersedeDecision, type Versioned } from './mission-build-coordinator.js';

// 축A A2 — blackboard decisions coherence(MESI 축소). frame 시간여행(#4510~·frame-rewind)이 이 순수
// 함수를 재사용하므로 회귀 가드가 중요(직전엔 테스트 0). supersedeDecision: 새 값이 다른 version 이면
// 옛 것 supersededBy 마킹(S→I)·같은 version 이면 갱신만·이미 supersede 됐으면 재마킹 안 함.
describe('supersedeDecision (축A A2 MESI 축소·frame 시간여행 의존)', () => {
  it('prev 없으면 current 만(신규 결정)', () => {
    const r = supersedeDecision<string>(undefined, 'v1', 1);
    expect(r.current).toEqual({ value: 'v1', version: 1 });
    expect(r.superseded).toBeUndefined();
  });

  it('같은 version 이면 supersede 없이 갱신만', () => {
    const prev: Versioned<string> = { value: 'v1', version: 1 };
    const r = supersedeDecision(prev, 'v2', 1);
    expect(r.current).toEqual({ value: 'v2', version: 1 });
    expect(r.superseded).toBeUndefined();
  });

  it('다른 version 이면 옛 것 supersededBy 마킹(S→I)', () => {
    const prev: Versioned<string> = { value: 'v1', version: 1 };
    const r = supersedeDecision(prev, 'v2', 2);
    expect(r.current).toEqual({ value: 'v2', version: 2 });
    expect(r.superseded).toEqual({ value: 'v1', version: 1, supersededBy: 2 });
  });

  it('이미 supersede 된 prev 는 재마킹 안 함(멱등·중복 무효화 방지)', () => {
    const prev: Versioned<string> = { value: 'v1', version: 1, supersededBy: 2 };
    const r = supersedeDecision(prev, 'v3', 3);
    expect(r.current).toEqual({ value: 'v3', version: 3 });
    expect(r.superseded).toBeUndefined();
  });
});
