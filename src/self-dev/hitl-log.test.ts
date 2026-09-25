import { test, expect, describe } from 'bun:test';
import { recordHitlEvent, recordHitlToMemory, type SelfMemoryInject } from './hitl-log.js';

describe('recordHitlEvent (G7 · 회고 계측)', () => {
  test('side-effect only — throw 없이 완료(fail-soft)', () => {
    expect(() => recordHitlEvent({ kind: 'decision-surfaced', action: 'parked-review', detail: { count: 3 } })).not.toThrow();
  });
});

describe('recordHitlToMemory (G7 · 패턴 학습 주입)', () => {
  test('주입 fn 을 [HITL] 프리픽스·tool=self-dev-loop 로 호출', async () => {
    const calls: Array<Parameters<SelfMemoryInject>[0]> = [];
    const fake: SelfMemoryInject = async (input) => { calls.push(input); return {}; };
    await recordHitlToMemory('시스템 수리 후보 2건 — merge-conflict×2', { patterns: ['merge-conflict'] }, fake);
    expect(calls.length).toBe(1);
    expect(calls[0]!.tool).toBe('self-dev-loop');
    expect(calls[0]!.summary).toStartWith('[HITL]');
    expect(calls[0]!.kind).toBe('change');
    expect(calls[0]!.refs).toMatchObject({ patterns: ['merge-conflict'] });
  });

  test('주입 fn 이 throw 해도 fail-soft(루프 무영향)', async () => {
    const boom: SelfMemoryInject = async () => { throw new Error('memory db down'); };
    await expect(recordHitlToMemory('x', undefined, boom)).resolves.toBeUndefined();
  });
});
