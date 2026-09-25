// 병렬 실행 라인 오케스트레이터 — fake spawn(실 서브프로세스 무접촉)으로 병렬·동시성·상태 검증.
import { test, expect, describe } from 'bun:test';
import { orchestrateHarness } from './orchestrate-harness.js';
import type { DevHarnessJobSpawn, DevHarnessJobDone } from '../task-orchestrator/surfaces/dev-harness.js';

/** exitCode 를 objective 에 따라 정하는 fake spawn(즉시 resolve). */
function fakeSpawn(exitFor: (obj: string) => number = () => 0, track?: { active: number; max: number }): DevHarnessJobSpawn {
  return (input) => {
    if (track) { track.active++; track.max = Math.max(track.max, track.active); }
    const done = new Promise<DevHarnessJobDone>((resolve) => {
      queueMicrotask(() => {
        if (track) track.active--;
        resolve({ exitCode: exitFor(input.objective), output: `out:${input.objective}` });
      });
    });
    return { address: `dev-harness:${input.spaceId}`, done };
  };
}

describe('orchestrateHarness (병렬 실행 라인)', () => {
  test('전 잡 병렬 실행 → done', async () => {
    const results = await orchestrateHarness({
      jobs: [{ objective: 'A' }, { objective: 'B', domain: 'web' }, { objective: 'C', domain: 'invest' }],
      spawn: fakeSpawn(),
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'done')).toBe(true);
    expect(results.find((r) => r.objective === 'B')?.domain).toBe('web');
  });

  test('실패 잡 → status failed(다른 잡은 계속)', async () => {
    const results = await orchestrateHarness({
      jobs: [{ objective: 'ok1' }, { objective: 'bad' }, { objective: 'ok2' }],
      spawn: fakeSpawn((obj) => (obj === 'bad' ? 1 : 0)),
    });
    expect(results.find((r) => r.objective === 'bad')?.status).toBe('failed');
    expect(results.filter((r) => r.status === 'done')).toHaveLength(2);
  });

  test('동시성 캡 존중 — max 동시 ≤ concurrency', async () => {
    const track = { active: 0, max: 0 };
    await orchestrateHarness({
      jobs: Array.from({ length: 8 }, (_, i) => ({ objective: `job${i}` })),
      concurrency: 3,
      spawn: fakeSpawn(() => 0, track),
    });
    expect(track.max).toBeLessThanOrEqual(3);
    expect(track.max).toBeGreaterThan(1);   // 실제로 병렬(1보다 큼)
  });

  test('빈 jobs → 빈 결과(즉시 resolve)', async () => {
    expect(await orchestrateHarness({ jobs: [], spawn: fakeSpawn() })).toEqual([]);
  });

  test('domain 없는 잡 = 코드(domain undefined)', async () => {
    const results = await orchestrateHarness({ jobs: [{ objective: '코드 수정' }], spawn: fakeSpawn() });
    expect(results[0]!.domain).toBeUndefined();
    expect(results[0]!.status).toBe('done');
  });

  test('onEvent 콜백 수신(task lifecycle)', async () => {
    const kinds: string[] = [];
    await orchestrateHarness({ jobs: [{ objective: 'X' }], spawn: fakeSpawn(), onEvent: (ev) => kinds.push(ev.kind) });
    expect(kinds).toContain('task-completed');
  });

  test('★ G9 P2 — autoReview 가 spawn input 까지 전파(병렬 라인 무인 리뷰 진입)', async () => {
    const seen: Array<{ objective: string; autoReview?: boolean }> = [];
    const capturingSpawn: DevHarnessJobSpawn = (input) => {
      seen.push({ objective: input.objective, autoReview: input.autoReview });
      return { address: `dev-harness:${input.spaceId}`, done: Promise.resolve({ exitCode: 0, output: '' }) };
    };
    await orchestrateHarness({
      jobs: [{ objective: 'X', autoReview: true }, { objective: 'Y' }],
      spawn: capturingSpawn,
    });
    // job X 만 autoReview → surface → adapter → spawn input 까지 관통. Y 는 미설정 → undefined.
    expect(seen.find((s) => s.objective === 'X')?.autoReview).toBe(true);
    expect(seen.find((s) => s.objective === 'Y')?.autoReview).toBeUndefined();
  });
});
