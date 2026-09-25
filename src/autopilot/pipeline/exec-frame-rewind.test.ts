// 조율자 격상 P5 — 실행 프레임 되감기(exec goto/rewind) 검증.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFrameDir } from './frame-journal.js';
import { recordExecPhase, readExecFrames, appendExecFrame } from './exec-frame-journal.js';
import { rewindExec, gotoExecPhase, effectiveExecFrames } from './exec-frame-rewind.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'execrewind-')); setFrameDir(dir); });
afterEach(() => { setFrameDir(null); try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

// 3페이즈 진행 저널 구성.
function seed(mid: string): void {
  recordExecPhase(mid, { phaseId: 'p1', phaseTitle: 'A', op: 'phase-start', status: 'running' });
  recordExecPhase(mid, { phaseId: 'p1', phaseTitle: 'A', op: 'phase-done', status: 'done' });
  recordExecPhase(mid, { phaseId: 'p2', phaseTitle: 'B', op: 'phase-start', status: 'running' });
  recordExecPhase(mid, { phaseId: 'p2', phaseTitle: 'B', op: 'phase-done', status: 'failed' });
}

describe('exec-frame-rewind — 실행 되감기(P5)', () => {
  test('gotoExecPhase — 그 페이즈로 되감기·이후 프레임 supersededBy 마킹', () => {
    seed('m1');
    const plan = gotoExecPhase(readExecFrames('m1'), 'p1', '2026-07-19T12:00:00.000Z');
    expect(plan.ok).toBe(true);
    expect(plan.targetPhaseId).toBe('p1');
    // p1-done(seq1) 이후 p2 프레임 2개 supersede + 되감기 기록 1 = 3 append
    expect(plan.framesToAppend.length).toBe(3);
    const superseded = plan.framesToAppend.filter((f) => f.supersededBy !== undefined);
    expect(superseded.length).toBe(2); // p2 start/done
  });

  test('되감기 후 active 프레임에서 p2 가 무효화됨', () => {
    seed('m2');
    const plan = gotoExecPhase(readExecFrames('m2'), 'p1', '2026-07-19T12:00:00.000Z');
    for (const f of plan.framesToAppend) appendExecFrame(f);
    const active = effectiveExecFrames(readExecFrames('m2'));
    // 유효 상태에서 p2 의 phase-done(failed)은 supersede 재-append 로 무효화됨
    const activeP2Done = active.filter((f) => f.phaseId === 'p2' && f.op === 'phase-done' && f.status === 'failed');
    expect(activeP2Done.length).toBe(0); // 되감겨 무효
    // p1 은 유효(되감기 재개 지점)
    expect(active.some((f) => f.phaseId === 'p1')).toBe(true);
  });

  test('rewindExec — N 이벤트 전으로', () => {
    seed('m3');
    const plan = rewindExec(readExecFrames('m3'), 1, '2026-07-19T12:00:00.000Z'); // 활성 4개 → 1개 전 = seq2(p2-start)
    expect(plan.ok).toBe(true);
    expect(plan.targetSeq).toBe(2);
  });

  test('빈 저널 → ok=false', () => {
    expect(rewindExec(readExecFrames('none'), 1, '2026-07-19T12:00:00.000Z').ok).toBe(false);
    expect(gotoExecPhase(readExecFrames('none'), 'x', '2026-07-19T12:00:00.000Z').ok).toBe(false);
  });

  test('없는 페이즈 goto → ok=false', () => {
    seed('m4');
    expect(gotoExecPhase(readExecFrames('m4'), 'nope', '2026-07-19T12:00:00.000Z').ok).toBe(false);
  });
});
