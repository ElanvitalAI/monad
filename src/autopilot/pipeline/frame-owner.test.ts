// P5.1 — 프레임 저널 owner(컨트롤러) drift 감지 순수 테스트
import { describe, expect, it } from 'bun:test';
import { detectControllerDrift } from './frame-owner.js';
import type { PipelineFrame } from './frame-types.js';

const f = (seq: number, via?: 'coordinator' | 'sequential'): PipelineFrame => ({
  frameId: `m:${seq}`, missionId: 'm', seq, stageIndex: 0, stage: 'research',
  status: 'done', timestamp: `2026-07-20T10:0${seq}:00Z`, op: 'push', inputsSnapshot: {} as never, version: 0,
  ...(via ? { via } : {}),
});

describe('detectControllerDrift', () => {
  it('단일 컨트롤러 → drift 없음', () => {
    const o = detectControllerDrift([f(1, 'sequential'), f(2, 'sequential')]);
    expect(o.owners).toEqual(['sequential']);
    expect(o.drift).toBe(false);
    expect(o.tagged).toBe(2);
  });

  it('두 컨트롤러 혼합 → drift(owner 단일성 위반)', () => {
    const o = detectControllerDrift([f(1, 'sequential'), f(2, 'coordinator')]);
    expect(o.owners.sort()).toEqual(['coordinator', 'sequential']);
    expect(o.drift).toBe(true);
    expect(o.counts.coordinator).toBe(1);
    expect(o.counts.sequential).toBe(1);
  });

  it('pre-P5(via undefined) 프레임은 집계 제외', () => {
    const o = detectControllerDrift([f(1), f(2), f(3, 'coordinator')]);
    expect(o.tagged).toBe(1);
    expect(o.owners).toEqual(['coordinator']);
    expect(o.drift).toBe(false);
  });

  it('빈 저널 → drift 없음·tagged 0', () => {
    const o = detectControllerDrift([]);
    expect(o.drift).toBe(false);
    expect(o.tagged).toBe(0);
  });
});
