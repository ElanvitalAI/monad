// 조율자 격상 P0 조각2 — build↔exec 단일 thread 통합 리더 검증.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFrameDir, appendFrame } from './frame-journal.js';
import { recordExecPhase, recordPendingWrite, appendExecFrame } from './exec-frame-journal.js';
import { readMissionThread, summarizeMissionThread } from './mission-thread.js';
import type { PipelineFrame } from './frame-types.js';
import type { ExecutionFrame } from './exec-frame-types.js';
import { emptyBlackboard } from '../mission-build-coordinator.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'thread-')); setFrameDir(dir); });
afterEach(() => { setFrameDir(null); try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

// 빌드 프레임 헬퍼(최소 필드) — timestamp 로 정렬되므로 명시적으로 준다.
function buildFrame(missionId: string, seq: number, ts: string): PipelineFrame {
  return {
    frameId: `${missionId}:${seq}`, missionId, seq, stageIndex: seq,
    stage: 'decompose', status: 'done', timestamp: ts, op: 'push',
    inputsSnapshot: emptyBlackboard(), version: 0,
  };
}

// exec 프레임 헬퍼(timestamp 명시) — recordExecPhase 는 wall-clock 을 쓰므로, 결정론 정렬 검증엔 직접 append.
function execFrame(missionId: string, seq: number, ts: string, phaseTitle: string): ExecutionFrame {
  return { frameId: `${missionId}:exec:${seq}`, missionId, seq, phaseId: `p${seq}`, phaseTitle, op: 'phase-start', status: 'running', timestamp: ts, version: 0 };
}

describe('mission-thread — build↔exec 단일 thread 통합(P0 조각2)', () => {
  test('두 저널을 시간순으로 병합·layer 태그', () => {
    // build 는 과거 ts(고정)·exec 는 그 뒤 ts → build 먼저(결정론).
    appendFrame(buildFrame('m1', 0, '2026-07-19T10:00:00.000Z'));
    appendFrame(buildFrame('m1', 1, '2026-07-19T10:01:00.000Z'));
    appendExecFrame(execFrame('m1', 0, '2026-07-19T10:02:00.000Z', '구현A'));
    const thread = readMissionThread('m1');
    expect(thread.length).toBe(3);
    expect(thread.map((e) => e.layer)).toEqual(['build', 'build', 'exec']); // 시간순 — build 먼저
    expect(thread[2]!.label).toBe('구현A');
  });

  test('같은 timestamp tie-break — build 가 exec 앞', () => {
    const ts = '2026-07-19T10:00:00.000Z';
    // exec 를 먼저 기록해도, 같은 ts 면 build 가 앞서야 한다(빌드가 실행에 선행).
    appendExecFrame(execFrame('m2', 0, ts, 'X'));
    appendFrame(buildFrame('m2', 0, ts));
    const full = readMissionThread('m2');
    expect(full.map((e) => e.layer)).toEqual(['build', 'exec']); // 동일 ts → build 우선
  });

  test('summarizeMissionThread — layer 수·전이·고아 pending-write', () => {
    appendFrame(buildFrame('m3', 0, '2026-07-19T10:00:00.000Z'));
    recordExecPhase('m3', { phaseId: 'p1', phaseTitle: '구현', op: 'phase-start', status: 'running' });
    recordPendingWrite('m3', { phaseId: 'p1', phaseTitle: '구현', artifacts: ['https://pr/1'] }); // 미종결=고아
    const s = summarizeMissionThread('m3');
    expect(s.buildFrames).toBe(1);
    expect(s.execFrames).toBe(2); // phase-start + pending-write
    expect(s.transitioned).toBe(true);
    expect(s.orphanPendingWrites).toBe(1);
  });

  test('exec 만 있는 미션(외부빌드)도 thread 성립', () => {
    recordExecPhase('m4', { phaseId: 'p', phaseTitle: 'only-exec', op: 'phase-done', status: 'done', artifacts: ['https://pr/9'] });
    const thread = readMissionThread('m4');
    expect(thread.length).toBe(1);
    expect(thread[0]!.layer).toBe('exec');
    expect(thread[0]!.artifacts).toEqual(['https://pr/9']);
    const s = summarizeMissionThread('m4');
    expect(s.transitioned).toBe(false); // build 프레임 없음
    expect(s.current?.label).toBe('only-exec');
  });

  test('빈 미션 → 빈 thread·요약 null current', () => {
    expect(readMissionThread('none')).toEqual([]);
    const s = summarizeMissionThread('none');
    expect(s.current).toBeNull();
    expect(s.transitioned).toBe(false);
  });
});
