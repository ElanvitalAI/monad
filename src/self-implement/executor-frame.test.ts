import { describe, expect, test } from 'bun:test';
import { buildExecutorSelfReportFrame } from './executor-frame.js';
import { execSurfaceId } from './executor-contract.js';
import { validateSelfReportFrame } from '../capture/self-report-frame.js';

describe('buildExecutorSelfReportFrame — G9 P3b (executor 화면 → 프레임 버스)', () => {
  test('surfaceId = exec:<ptyId> (P3a execSurfaceId 소비·Q1 규약)', () => {
    const f = buildExecutorSelfReportFrame({ ptyId: 'goal_a1b2', rendered: 'hi', at: 100, instance: 'inst-x' });
    expect(f.surfaceId).toBe(execSurfaceId('goal_a1b2'));
    expect(f.surfaceId).toBe('exec:goal_a1b2');
    expect(f.kind).toBe('headless');
    expect(f.mode).toBe('forwarded');
    expect(f.instance).toBe('inst-x');
    expect(f.at).toBe(100);
  });

  test('runId 있으면 스탬프(K4·run join), 없으면 필드 생략(round-trip 정합)', () => {
    const withRun = buildExecutorSelfReportFrame({ ptyId: 'p_1', runId: 'run-9', rendered: 'x', at: 1, instance: 'i' });
    expect(withRun.runId).toBe('run-9');
    const noRun = buildExecutorSelfReportFrame({ ptyId: 'p_1', rendered: 'x', at: 1, instance: 'i' });
    expect('runId' in noRun).toBe(false);
  });

  test('cols/rows 는 렌더 텍스트에서 파생(rows=줄수·cols=최대폭)', () => {
    const f = buildExecutorSelfReportFrame({ ptyId: 'p', rendered: 'ab\nabcd\nx', at: 0, instance: 'i' });
    expect(f.rows).toBe(3);
    expect(f.cols).toBe(4);
  });

  test('산출 프레임이 SelfReportFrame 계약을 통과(validate=null)', () => {
    const f = buildExecutorSelfReportFrame({ ptyId: 'codex_ff', runId: 'r', rendered: 'screen', at: 5, instance: 'i' });
    expect(validateSelfReportFrame(f)).toBeNull();
  });

  test('pngRef 있으면 스탬프(키프레임 캡처), 없으면 생략(never inline·on-demand)', () => {
    const withPng = buildExecutorSelfReportFrame({ ptyId: 'p', rendered: 'x', at: 1, instance: 'i', pngRef: '/kf/kf-r-p-000-done.png' });
    expect(withPng.pngRef).toBe('/kf/kf-r-p-000-done.png');
    expect(validateSelfReportFrame(withPng)).toBeNull();
    const noPng = buildExecutorSelfReportFrame({ ptyId: 'p', rendered: 'x', at: 1, instance: 'i' });
    expect('pngRef' in noPng).toBe(false);
  });
});
