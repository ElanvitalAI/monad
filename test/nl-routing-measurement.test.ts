import { describe, expect, test } from 'bun:test';
import { verifyPtySession } from '../scripts/lib/nl-routing-live.js';
import {
  closedTurnBoundary,
  medianPassVerdict,
  passSummary,
  toolsForSessionTurn,
  turnStartedAfter,
  wilsonInterval,
} from '../scripts/lib/nl-routing-measurement.js';
import { measureScreeningRun, screeningFailureReason } from '../scripts/lib/nl-routing-screening.js';

const item = { id: 't1', tier: 'T1', prompt: 'probe', accept: ['Grep'] };

describe('NL routing measurement boundaries', () => {
  test('scores only tool-selected rows from the started session and exact run', () => {
    const start = '2026-08-01T00:00:01.000Z';
    const done = '2026-08-01T00:00:03.000Z';
    const logs = [
      { id: 10, ts: start, event: 'execute.begin', session_id: 'target', runId: 'run-target' },
      { id: 11, ts: '2026-08-01T00:00:01.100Z', event: 'tool-selected', session_id: 'other-session', tool: 'Wrong' },
      { id: 12, ts: '2026-08-01T00:00:01.200Z', event: 'tool-selected', session_id: 'target', runId: 'older-run', tool: 'Wrong' },
      { id: 13, ts: '2026-08-01T00:00:01.300Z', event: 'tool-selected', session_id: 'target', tool: 'Grep' },
      { id: 14, ts: done, event: 'execute.ok', session_id: 'target', runId: 'run-target' },
      { id: 15, ts: '2026-08-01T00:00:04.000Z', event: 'tool-selected', session_id: 'target', runId: 'run-target', tool: 'Late' },
    ].map((row) => JSON.stringify(row)).join('\n');

    const boundary = turnStartedAfter(logs, new Set<string>(), 'target');
    expect(boundary).toEqual({ startId: 10, instance: '', timestamp: start, runId: 'run-target' });
    const closed = closedTurnBoundary(logs, boundary!, 'target');
    expect(closed).toEqual({ startId: 10, instance: '', timestamp: start, runId: 'run-target', completedAt: done });
    expect(toolsForSessionTurn(logs, 'target', closed!)).toEqual(['Grep']);
  });

  test('reads persisted session_id when verifying a PTY bridge', () => {
    const execute = () => JSON.stringify({
      event: 'lifecycle.bridge-attached',
      session_id: 'target',
      data: { ptyId: 'pty-1' },
    });
    expect(verifyPtySession(execute, 'pty-1', 'target')).toBe(true);
  });

  test('does not close a turn from a different run in the same session', () => {
    const logs = [
      { id: 20, ts: '2026-08-01T00:01:00.000Z', event: 'execute.begin', session_id: 'target', runId: 'run-current' },
      { id: 21, ts: '2026-08-01T00:01:01.000Z', event: 'execute.ok', session_id: 'target', runId: 'run-nested' },
      { id: 22, ts: '2026-08-01T00:01:02.000Z', event: 'tool-selected', session_id: 'target', runId: 'run-nested', tool: 'Grep' },
    ].map((row) => JSON.stringify(row)).join('\n');
    const boundary = turnStartedAfter(logs, new Set<string>(), 'target');
    expect(boundary).not.toBeNull();
    expect(closedTurnBoundary(logs, boundary!, 'target')).toBeNull();
  });

  test('uses the median repeated outcome for the live authority verdict', () => {
    expect(medianPassVerdict([{ outcome: 'pass' }, { outcome: 'no-fire' }, { outcome: 'pass' }], 3)).toBe('pass');
    expect(medianPassVerdict([{ outcome: 'pass' }, { outcome: 'no-fire' }, { outcome: 'pass' }, { outcome: 'no-fire' }], 4)).toBe('pass');
    expect(medianPassVerdict([{ outcome: 'pass' }, { outcome: 'no-fire' }], 3)).toBe('unmeasurable');
  });

  test('records the measurement machine load average and core count', async () => {
    const machineLoad = { loadAverage: [773, 512, 256] as [number, number, number], coreCount: 16 };
    const record = await measureScreeningRun(item, 6, 0, async () => ({
      toolBreakdown: { Grep: {} },
      turnCount: 1,
      durationMs: 25,
    }), machineLoad);
    expect(record).toMatchObject({ machineLoad });
  });

  // ⛔⭐⭐ `MEAS-T15` 회귀 — 종전엔 레코드의 부하가 **호출부가 넘긴 런-시작 값의 복사본**이라
  //    런 내부에서 부하가 올라도 어느 레코드에도 안 적혔다. 이 테스트는 **그 복사가 다시 생기면**
  //    깨진다: 주입된 `load` 와 샘플러가 **다른 값**을 낼 때 레코드가 둘을 **따로** 담아야 한다.
  test('samples this record\'s own load instead of reusing the caller-supplied run snapshot', async () => {
    const runSnapshot = { loadAverage: [1, 1, 1] as [number, number, number], coreCount: 8 };
    const samples = [
      { loadAverage: [20, 20, 20] as [number, number, number], coreCount: 8 },
      { loadAverage: [30, 30, 30] as [number, number, number], coreCount: 8 },
    ];
    let next = 0;
    // ⭐ should-fix 수용 — **시간적 순서**까지 고정한다. 값만 보면 `start`·`end` 를 둘 다
    //    실행 뒤에 재도 통과할 수 있다(그러면 "실행 중 부하가 올랐다" 를 못 잡는다).
    const order: string[] = [];
    const record = await measureScreeningRun(item, 6, 0, async () => {
      order.push('evaluate');
      return { toolBreakdown: { Grep: {} }, turnCount: 1, durationMs: 25 };
    }, runSnapshot, () => {
      order.push('sample');
      return samples[Math.min(next++, samples.length - 1)]!;
    });

    expect(record?.machineLoad).toEqual(runSnapshot);   // 런 스냅샷은 그대로 보존된다
    expect(record?.loadAtStart).toEqual(samples[0]);    // ⭐ 레코드 자신의 부하 — 복사본이 아니다
    expect(record?.loadAtEnd).toEqual(samples[1]);      // ⭐ 실행 중 부하가 올랐다는 사실이 남는다
    // ⛔ 샘플 하나는 실행 **앞**, 하나는 **뒤** — 뒤처리 뒤로 밀리는 것도 여기서 안 잡히므로
    //    구현은 `await` 직후에 잰다(그 계약은 코드 주석이 canonical).
    expect(order).toEqual(['sample', 'evaluate', 'sample']);
  });

  test('defaults the per-record load sampler so callers cannot silently lose it', async () => {
    const record = await measureScreeningRun(item, 6, 0, async () => ({
      toolBreakdown: { Grep: {} },
      turnCount: 1,
      durationMs: 25,
    }));
    expect(record?.loadAtStart.coreCount).toBeGreaterThan(0);
    expect(record?.loadAtEnd.loadAverage).toHaveLength(3);
  });

  test('reports observed pass counts and a 95% Wilson interval without categorical labels', async () => {
    const record = await measureScreeningRun(item, 6, 0, async () => {
      throw new Error('runner rejected');
    });
    expect(record).toBeNull();
    expect(passSummary([{ outcome: 'pass' }, { outcome: 'wrong-tool' }, { outcome: 'pass' }], 3)).toEqual({ passes: 2, runs: 3, expectedRuns: 3 });
    expect(passSummary(record === null ? [] : [record], 1)).toEqual({ passes: 0, runs: 0, expectedRuns: 1 });
    expect(wilsonInterval(3, 3)).toEqual({ lower: expect.closeTo(0.4385, 4), upper: 1 });
    expect(wilsonInterval(0, 3)).toEqual({ lower: 0, upper: expect.closeTo(0.5615, 4) });
    expect(wilsonInterval(4, 3)).toBeNull();
  });
});

// ⛔⭐ 2026-07-30 — 실패 사유가 버려지면 자를 재는 자가 침묵한다(실측: 30/30 실패에 이유 0줄).
describe('screening 실패 사유 보관', () => {
  test('실패한 실행의 이유를 이름으로 되찾을 수 있다', async () => {
    const record = await measureScreeningRun(
      { id: 'X-01', tier: 'T1', prompt: 'probe', accept: ['Read'] },
      6, 0,
      () => { throw new Error("Cannot find module 'zod/v4'\n두 번째 줄은 버린다"); },
    );
    expect(record).toBeNull();
    // ⭐ 판정(=측정 불가)은 그대로이고, **이유가 곁에 남는다**.
    expect(screeningFailureReason('X-01', 6, 0)).toBe("Cannot find module 'zod/v4'");
    // ⛔ 실패한 적 없는 실행은 사유가 없다(있는 척하지 않는다).
    expect(screeningFailureReason('X-01', 6, 1)).toBeUndefined();
  });

  // ⭐ 7R should-fix — 경계 둘을 고정한다: **200자 절단** ⊕ **같은 실행을 두 번 물어도 같은 답**.
  test('사유는 200자로 자르고, 조회해도 사라지지 않는다', async () => {
    const long = 'X'.repeat(500);
    const record = await measureScreeningRun(
      { id: 'X-02', tier: 'T1', prompt: 'probe', accept: ['Read'] },
      6, 0,
      () => { throw new Error(long); },
    );
    expect(record).toBeNull();
    const first = screeningFailureReason('X-02', 6, 0);
    expect(first).toHaveLength(200);
    // ⛔ 조회가 소비가 아니다 — 두 번째 조회도 같은 값이다.
    expect(screeningFailureReason('X-02', 6, 0)).toBe(first);
  });

  // ⭐ Error 가 아닌 것을 던져도 사유가 남는다(문자열화 · 첫 줄).
  test('Error 가 아닌 throw 도 사유로 남는다', async () => {
    await measureScreeningRun(
      { id: 'X-03', tier: 'T1', prompt: 'probe', accept: ['Read'] },
      6, 0,
      () => { throw 'plain string failure\n버리는 줄'; },
    );
    expect(screeningFailureReason('X-03', 6, 0)).toBe('plain string failure');
  });
});

// ⭐ `I-16`(2026-07-31) — **미발사 런의 답문을 원자료에 보존한다.** ⛔ 해석·채점은 하지 않는다.
//    왜: `MEAS-T17` 이 *"세는 방식으로는 이 질문(미발사의 성격)이 안 닫힌다"* 를 냈다(칸당 199 필요).
//    ⇒ 남은 길은 **읽는 것**이고, 읽으려면 먼저 **버리지 않아야** 한다.
describe('I-16 — 미발사 답문 보존', () => {
  const item = { id: 'n1', tier: 'T1', prompt: 'probe', accept: ['Grep'] };

  test('⭐ 미발사면 답문을 그대로 싣는다', async () => {
    const record = await measureScreeningRun(item, 6, 0, async () => ({
      toolBreakdown: {}, turnCount: 1, durationMs: 10, text: '먼저 무엇을 조회할지 여쭤봐도 될까요?',
    }));
    expect(record?.outcome).toBe('no-fire');
    expect(record?.noFireText).toBe('먼저 무엇을 조회할지 여쭤봐도 될까요?');
    expect(record?.noFireTextTruncatedFrom).toBeUndefined();
  });

  test('⛔ 발사한 런에는 없다 — 이름이 `noFireText` 인 것은 의도다(F7 방지)', async () => {
    const record = await measureScreeningRun(item, 6, 0, async () => ({
      toolBreakdown: { Grep: 1 }, turnCount: 1, durationMs: 10, text: '조회했습니다',
    }));
    expect(record?.outcome).toBe('pass');
    expect(record?.noFireText).toBeUndefined();
  });

  test('⛔ 답문이 비면 필드를 만들지 않는다 — 빈 문자열과 부재를 같은 값으로 만들지 않는다', async () => {
    const record = await measureScreeningRun(item, 6, 0, async () => ({
      toolBreakdown: {}, turnCount: 1, durationMs: 10, text: '',
    }));
    expect(record?.outcome).toBe('no-fire');
    expect(record).not.toHaveProperty('noFireText');
  });

  test('⛔ 자르되 조용히 자르지 않는다 — 원래 길이를 남긴다', async () => {
    const long = 'X'.repeat(9000);
    const record = await measureScreeningRun(item, 6, 0, async () => ({
      toolBreakdown: {}, turnCount: 1, durationMs: 10, text: long,
    }));
    expect(record?.noFireText).toHaveLength(8000);
    expect(record?.noFireTextTruncatedFrom).toBe(9000);
  });

  // ⛔⭐ 리뷰 1R — `slice` 는 UTF-16 코드 단위라 **경계의 이모지를 반으로 쪼갠다.**
  //    자르는 목적은 **크기 상한**이지 손상이 아니다.
  test('⛔ 절단이 보조 평면 문자를 반으로 쪼개지 않는다(코드포인트 경계)', async () => {
    // 코드포인트 9000개 — 전부 서로게이트 쌍이라 UTF-16 길이는 18000 이다.
    const emoji = '🙂'.repeat(9000);
    const record = await measureScreeningRun(item, 6, 0, async () => ({
      toolBreakdown: {}, turnCount: 1, durationMs: 10, text: emoji,
    }));
    const kept = record!.noFireText!;
    expect(Array.from(kept)).toHaveLength(8000);          // ⭐ 코드포인트 기준 상한
    expect(kept).not.toContain('\uFFFD');                 // 대체 문자가 안 생긴다
    expect(kept.endsWith('🙂')).toBe(true);                // ⛔ 마지막 글자가 온전하다
    expect(record?.noFireTextTruncatedFrom).toBe(9000);   // ⚠️ 코드포인트로 세므로 18000 이 아니다
  });

  // ⛔⭐⭐ **보존이 판정을 건드리지 않는다** — 이 단언이 `I-16` 의 안전선이다.
  //    러너가 답문을 읽고 분류하기 시작하면 그 분류가 곧 자가 되고 아무도 검증하지 않는다(Goodhart).
  test('⛔⭐ 답문 내용이 outcome 을 바꾸지 않는다 — 러너는 읽지 않는다', async () => {
    const asIfSuccess = await measureScreeningRun(item, 6, 0, async () => ({
      toolBreakdown: {}, turnCount: 1, durationMs: 10, text: 'Grep 을 실행했고 성공했습니다',
    }));
    // 답문이 "성공" 을 주장해도 판정은 **발사 여부**로만 난다.
    expect(asIfSuccess?.outcome).toBe('no-fire');
    expect(asIfSuccess?.noFireText).toContain('성공');
  });
});
