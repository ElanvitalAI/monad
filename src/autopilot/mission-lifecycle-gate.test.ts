// LG0 — 미션 생애주기 게이트 검증 (2026-07-19)
import { test, expect, describe } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TaskStore } from '../task-orchestrator/store.js';
import { createMission } from './mission-registry.js';
import { missionLifecycleGate } from './mission-lifecycle-gate.js';

/** 게이트/updateMissionStatus 와 동일 접근(TaskStore.getMission → autopilot.apmStatus). */
function apmStatus(store: TaskStore, id: string): string | undefined {
  return (store.getMission(id) as { autopilot?: { apmStatus?: string } } | undefined)?.autopilot?.apmStatus;
}

describe('LG0 — 미션 생애주기 게이트(전이 단일 관문)', () => {
  test('게이트가 상태전이(updateMissionStatus 무회귀 래핑)', () => {
    const store = new TaskStore({ path: ':memory:' });
    const m = createMission(store, { goal: 'LG0 게이트 테스트', source: 'manual', triage: { executionModel: 'task' } });
    expect(apmStatus(store, m.id)).toBe('proposed');
    missionLifecycleGate(store, m.id, 'running', 'test-approve');
    expect(apmStatus(store, m.id)).toBe('running');
    missionLifecycleGate(store, m.id, 'done', 'test-complete');
    expect(apmStatus(store, m.id)).toBe('done');
    store.close();
  });

  test('없는 미션 전이는 fail-soft(throw 없음)', () => {
    const store = new TaskStore({ path: ':memory:' });
    expect(() => missionLifecycleGate(store, 'apm_nonexistent', 'running', 'test')).not.toThrow();
    store.close();
  });

  test('관측 배선(제1원칙 3박자) — transition + no-op smell', () => {
    const src = readFileSync(join(import.meta.dir, 'mission-lifecycle-gate.ts'), 'utf8');
    expect(src).toMatch(/debug\.log\('mission\.lifecycle',\s*'transition'/);
    expect(src).toContain('from');   // 자기인지 from→to
    expect(src).toContain('reason'); // 자기인지 계기
    expect(src).toMatch(/debug\.log\('mission\.lifecycle',\s*'transition-noop'/); // wiring smell
  });
});

describe('LG0 — 전역 불변식(전이 창구 단일화)', () => {
  function collectTsFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st: ReturnType<typeof statSync>; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (name !== 'node_modules') collectTsFiles(p, out); }
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
    }
    return out;
  }

  test('updateMissionStatus 직접 호출은 게이트/정의 모듈에만(우회 0)', () => {
    const root = join(import.meta.dir, '..', '..');
    const allowed = new Set([
      join(root, 'src/autopilot/mission-registry.ts'),        // 정의
      join(root, 'src/autopilot/mission-lifecycle-gate.ts'),  // 게이트(래핑)
    ]);
    const offenders: string[] = [];
    for (const dir of [join(root, 'src'), join(root, 'scripts')]) {
      for (const f of collectTsFiles(dir)) {
        if (allowed.has(f)) continue;
        if (/\bupdateMissionStatus\s*\(/.test(readFileSync(f, 'utf8'))) offenders.push(f.replace(root + '/', ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});
