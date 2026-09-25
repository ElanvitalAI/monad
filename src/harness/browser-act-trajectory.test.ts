import { describe, expect, test } from 'bun:test';
import { describeTrajectory, readTrajectory, stepMatchesActor } from './browser-act-trajectory.js';
import { coordinatesMatch, judgeReplayStep, summarizeReplay } from './browser-act-replay.js';

/** 실물 꼴 그대로 — ⛔ `data` 는 «문자열»이다. */
function row(d: Record<string, unknown>, ts = '2026-08-28T00:00:00.000Z'): string {
  return JSON.stringify({ ts, category: 'harness.browser-act', event: 'executed', data: JSON.stringify(d) });
}
const STEP = { url: 'https://example.com', target: 'a', coordinates: { x: 10, y: 20 }, personaId: 'newsbot', captureOutcome: 'ok' };

describe('trajectory recording', () => {
  test('re-reads existing observations as a trajectory — it does not invent a new format', () => {
    // 📌 RFC §4.2 의 결정: 「C2 는 playwright 를 안 더한다 — 이미 남는 관측을 궤적으로 되읽는다」
    const r = readTrajectory(row(STEP));
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ url: 'https://example.com', target: 'a', coordinates: { x: 10, y: 20 }, ok: true });
  });

  test('orders steps by when they happened, not by how the store returned them', () => {
    // ⛔ 관측은 «최신순»으로 온다 — 재생은 «일어난 순서»여야 한다.
    const jsonl = [
      row({ ...STEP, target: 'second' }, '2026-08-28T00:00:02.000Z'),
      row({ ...STEP, target: 'first' }, '2026-08-28T00:00:01.000Z'),
    ].join('\n');
    expect(readTrajectory(jsonl).steps.map((s) => s.target)).toEqual(['first', 'second']);
  });

  test('keeps failed actions in the trajectory — a refusal is also a record of intent', () => {
    const r = readTrajectory(row({ ...STEP, ok: false, failureReason: 'execution-failed', coordinates: null }));
    expect(r.steps[0]).toMatchObject({ ok: false, failureReason: 'execution-failed', coordinates: null });
  });

  test('reads _meta.limitReached before discarding it — a truncated trajectory is not the whole one', () => {
    // ⛔ 이 저장소가 2026-08-27 에 «세 번» 밟은 자리.
    const jsonl = [JSON.stringify({ _meta: { type: 'log-query-limit', limitReached: true } }), row(STEP)].join('\n');
    const r = readTrajectory(jsonl);
    expect(r.diagnostics.truncated).toBe(true);
    expect(describeTrajectory(r)).toContain('부분');
  });

  test('counts what it dropped and why — a short trajectory must say what it did not take', () => {
    const jsonl = [
      row(STEP),
      row({ ...STEP, personaId: 'investor' }),
      row({ ...STEP, url: '' }),
      'not json at all',
    ].join('\n');
    const r = readTrajectory(jsonl, { personaId: 'newsbot' });
    expect(r.steps).toHaveLength(1);
    expect(r.diagnostics.skipped['other-persona']).toBe(1);
    expect(r.diagnostics.skipped['missing-url-or-target']).toBe(1);
    expect(describeTrajectory(r)).toContain('뺀 행');
  });
});

describe('trajectory replay', () => {
  const then: { coordinates: { x: number; y: number } | null; captureOutcome: string | null; ok: boolean } =
    { coordinates: { x: 10, y: 20 }, captureOutcome: 'ok', ok: true };
  const judge = (now: typeof then, tolerancePx = 8) =>
    judgeReplayStep({ index: 0, url: 'u', target: 'a', then, now, tolerancePx });

  test('says where it differed, not merely whether it passed', () => {
    expect(judge({ ...then, coordinates: { x: 12, y: 20 } }).outcome).toBe('same');
    expect(judge({ ...then, coordinates: { x: 99, y: 20 } }).outcome).toBe('differs');
    expect(judge({ ...then, captureOutcome: 'timeout' }).detail).toContain('화면 ok → timeout');
  });

  test('never reads "could not observe" as "differed"', () => {
    // ⛔⭐ 실측 2026-08-28: 조작은 성공했는데 조회가 그 행을 못 잡아 좌표가 null 로 왔고,
    //    그것이 「좌표 {…} → null」이라는 ***거짓 갈림***으로 나왔다.
    const r = judge({ coordinates: null, captureOutcome: null, ok: true });
    expect(r.outcome).toBe('unobserved');
    expect(r.detail).toContain('판정 불가');
  });

  test('separates "this action failed now" from "it differed"', () => {
    expect(judge({ coordinates: null, captureOutcome: null, ok: false }).outcome).toBe('failed');
  });

  test('counts the unobserved in the denominator — hiding them inflates the match rate', () => {
    const v = summarizeReplay([
      judge(then),
      judge({ coordinates: null, captureOutcome: null, ok: true }),
    ]);
    expect(v.same).toBe(1);
    expect(v.unobserved).toBe(1);
    expect(v.detail).toContain('못 봤다 1');
  });

  test('does not read an empty replay as "everything matched"', () => {
    expect(summarizeReplay([]).detail).toContain('하나도');
  });

  test('tolerates sub-pixel render jitter but not a real move', () => {
    expect(coordinatesMatch({ x: 10, y: 20 }, { x: 10.4, y: 20.2 }, 1)).toBe(true);
    expect(coordinatesMatch({ x: 10, y: 20 }, { x: 40, y: 20 }, 1)).toBe(false);
    expect(coordinatesMatch(null, null, 1)).toBe(true);
    expect(coordinatesMatch({ x: 1, y: 1 }, null, 1)).toBe(false);
  });
});

/**
 * 🔬⭐⭐⭐ **탐침과 봇을 가른다** (2026-08-30 · 37차 · RFC §23b-4 의 `P3`)
 *
 * 🚨 계기 — ***궤적이 「그 봇이 한 것」이 아니었다***:
 * ```
 * 📏 실측 2026-08-30   newsbot 궤적 104걸음 = 카나리아 탐침 87(84%) + 봇의 진짜 조작 17
 *                      관측 11행 전부 kind=bot — 탐침과 봇이 ***한 글자도 안 달랐다***
 * ```
 * 🪞 36차가 이 자리에서 «세 번» 반증됐다. 셋 다 «경계»를 고치려 했고, 뿌리는 «누가»였다.
 *
 * ⛔ 이 시험이 «가장 세게» 무는 것: ***옛 행(귀속 칸이 «없는» 것)을 빼지 않는가.***
 *    빼면 과거가 통째로 사라지고, 그것은 「없다」를 지어내는 것이다.
 */
describe('🔬 stepMatchesActor — 「모르면 봇의 것」', () => {
  test('all 은 «전부» 통과 — 무엇도 안 숨긴다', () => {
    for (const k of ['bot', 'probe', 'run', 'entry-point', null, undefined]) {
      expect(stepMatchesActor(k, 'all')).toBe(true);
    }
  });

  test('probe 는 «적혀 있는 것»만 — 모르는 것을 탐침으로 지어내지 않는다', () => {
    expect(stepMatchesActor('probe', 'probe')).toBe(true);
    for (const k of ['bot', 'run', null, undefined]) expect(stepMatchesActor(k, 'probe')).toBe(false);
  });

  test('⛔⭐ bot 은 「탐침이라 «적힌» 것」만 뺀다 — 옛 행(undefined)은 «남긴다»', () => {
    expect(stepMatchesActor('probe', 'bot')).toBe(false);
    expect(stepMatchesActor(undefined, 'bot')).toBe(true);   // ⛔ 이 줄이 과거를 지킨다
    expect(stepMatchesActor(null, 'bot')).toBe(true);
    expect(stepMatchesActor('bot', 'bot')).toBe(true);
    expect(stepMatchesActor('run', 'bot')).toBe(true);
  });
});

describe('🔬 readTrajectory — 뺀 것을 «이름을 대고» 센다', () => {
  const probeRow = row({ ...STEP, target: 'probe-click', attribution: { kind: 'probe', entryPoint: 'x' } });
  const botRow = row({ ...STEP, target: '.titleline > a', attribution: { kind: 'bot', entryPoint: 'x' } });
  const oldRow = row({ ...STEP, target: 'legacy' });          // 귀속 칸이 «없던» 시절

  test('기본은 bot — 탐침을 빼고 ***그 수를 이름을 대고 낸다***', () => {
    const r = readTrajectory([probeRow, botRow].join('\n'));
    expect(r.steps.map((s) => s.target)).toEqual(['.titleline > a']);
    expect(r.diagnostics.skipped['canary-probe']).toBe(1);
    expect(describeTrajectory(r)).toContain('canary-probe=1');
  });

  test('⛔⭐ 옛 행은 «안 뺀다» — 실측 104걸음이 전부 그 꼴이었다', () => {
    const r = readTrajectory([oldRow, probeRow].join('\n'));
    expect(r.steps.map((s) => s.target)).toEqual(['legacy']);
    expect(r.diagnostics.skipped['canary-probe']).toBe(1);
  });

  test('actor=probe 는 «내 탐침»만 — 카나리아의 recorded 검사가 이것을 쓴다', () => {
    const r = readTrajectory([probeRow, botRow, oldRow].join('\n'), { actor: 'probe' });
    expect(r.steps.map((s) => s.target)).toEqual(['probe-click']);
    expect(r.diagnostics.skipped['not-a-probe']).toBe(2);
  });

  test('actor=all 은 «전부» — 「무엇이 있었나」를 물을 때', () => {
    expect(readTrajectory([probeRow, botRow, oldRow].join('\n'), { actor: 'all' }).steps).toHaveLength(3);
  });

  test('페르소나 필터와 «같이» 걸린다 — 둘은 다른 축이다', () => {
    const other = row({ ...STEP, personaId: 'investor', attribution: { kind: 'bot', entryPoint: 'x' } });
    const r = readTrajectory([probeRow, botRow, other].join('\n'), { personaId: 'newsbot' });
    expect(r.steps).toHaveLength(1);
    expect(r.diagnostics.skipped['other-persona']).toBe(1);
    expect(r.diagnostics.skipped['canary-probe']).toBe(1);
  });

  test('⛔ 탐침«만» 있는 봇은 걸음 0 — 그것이 ***사실***이다(그 봇은 스스로 조작한 적이 없다)', () => {
    // 📏 실측: botlab-4 · assistant · investor 가 그 상태다. 옛 판은 그것을 「조작했다」로 보였다.
    const r = readTrajectory(probeRow);
    expect(r.steps).toHaveLength(0);
    expect(describeTrajectory(r)).toContain('걸음 0개');
    expect(describeTrajectory(r)).toContain('canary-probe=1');   // ⛔ 「0」의 «이유»를 같이 낸다
  });
});
