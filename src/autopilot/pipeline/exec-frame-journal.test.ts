// S4(실행 적응 2026-07-19) — 실행 프레임 저널 round-trip 검증(관측·리플레이 토대).
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFrameDir } from './frame-journal.js';
import { recordExecPhase, readExecFrames, nextExecSeq, execFramePath, loadLatestExecFrame, recordPendingWrite, collectPendingWrites } from './exec-frame-journal.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'execframe-')); setFrameDir(dir); });
afterEach(() => { setFrameDir(null); try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('exec-frame-journal — S4 실행 프레임 저널', () => {
  test('recordExecPhase → readExecFrames round-trip·seq 단조·필드 보존', () => {
    recordExecPhase('m1', { phaseId: 'p1', phaseTitle: '조사', op: 'phase-start', status: 'running' });
    recordExecPhase('m1', { phaseId: 'p1', phaseTitle: '조사', op: 'phase-done', status: 'done', artifacts: ['https://pr/1'], note: 'ok', framework: 'se-isolated' });
    const f = readExecFrames('m1');
    expect(f.length).toBe(2);
    expect(f[0]!.seq).toBe(0);
    expect(f[1]!.seq).toBe(1);
    expect(f[0]!.op).toBe('phase-start');
    expect(f[1]!.op).toBe('phase-done');
    expect(f[1]!.status).toBe('done');
    expect(f[1]!.artifacts).toEqual(['https://pr/1']);
    expect(f[1]!.framework).toBe('se-isolated');
    expect(f[1]!.frameId).toBe('m1:exec:1'); // exec 네임스페이스(빌드 frameId 와 분리)
  });

  test('nextExecSeq 단조 증가', () => {
    expect(nextExecSeq('m2')).toBe(0);
    recordExecPhase('m2', { phaseId: 'p', phaseTitle: 't', op: 'phase-done', status: 'done' });
    expect(nextExecSeq('m2')).toBe(1);
  });

  test('deviation(satisfied_skip·S1) 보존', () => {
    recordExecPhase('m3', { phaseId: 'p', phaseTitle: 't', op: 'skip', status: 'skipped', deviation: { kind: 'satisfied_skip', note: '이미 충족' } });
    const f = readExecFrames('m3');
    expect(f[0]!.deviation?.kind).toBe('satisfied_skip');
    expect(f[0]!.deviation?.note).toBe('이미 충족');
  });

  test('malformed 라인 skip(손상이 리플레이를 오염시키지 않는다)', () => {
    recordExecPhase('m4', { phaseId: 'p1', phaseTitle: 't', op: 'phase-done', status: 'done' });
    appendFileSync(execFramePath('m4'), 'not-json-line\n', 'utf8'); // 손상 라인 주입
    recordExecPhase('m4', { phaseId: 'p2', phaseTitle: 't2', op: 'phase-done', status: 'done' });
    const f = readExecFrames('m4');
    expect(f.length).toBe(2); // 손상 라인 제외·정상 2개만
    expect(f.map((x) => x.phaseId)).toEqual(['p1', 'p2']);
  });

  test('loadLatestExecFrame → 마지막 seq / 빈 미션 → null·빈 배열', () => {
    expect(readExecFrames('none')).toEqual([]);
    expect(loadLatestExecFrame('none')).toBeNull();
    recordExecPhase('m5', { phaseId: 'a', phaseTitle: 't', op: 'phase-start', status: 'running' });
    recordExecPhase('m5', { phaseId: 'a', phaseTitle: 't', op: 'phase-done', status: 'done' });
    expect(loadLatestExecFrame('m5')?.op).toBe('phase-done');
  });
});

describe('put_writes — 부분 write 보존 / 고아 방지 (조율자 격상 P0)', () => {
  test('pending-write 프레임 기록·op/status·artifacts 보존', () => {
    recordPendingWrite('w1', { phaseId: 'p1', phaseTitle: '구현', artifacts: ['https://pr/9', 'origin/se/p1'], framework: 'se-isolated', note: 'PR push' });
    const f = readExecFrames('w1');
    expect(f.length).toBe(1);
    expect(f[0]!.op).toBe('pending-write');
    expect(f[0]!.status).toBe('running');
    expect(f[0]!.artifacts).toEqual(['https://pr/9', 'origin/se/p1']);
  });

  test('고아 회수 — phase-done 없는 pending-write 만 반환(크래시 시나리오)', () => {
    // p1: pending-write 후 phase-done → consolidate(정상 종결)
    recordPendingWrite('w2', { phaseId: 'p1', phaseTitle: 'A', artifacts: ['https://pr/1'] });
    recordExecPhase('w2', { phaseId: 'p1', phaseTitle: 'A', op: 'phase-done', status: 'done', artifacts: ['https://pr/1'] });
    // p2: pending-write 후 크래시(phase-done 없음) → 고아
    recordPendingWrite('w2', { phaseId: 'p2', phaseTitle: 'B', artifacts: ['https://pr/2', 'origin/se/p2'] });
    const orphans = collectPendingWrites('w2');
    expect(orphans.length).toBe(1);
    expect(orphans[0]!.phaseId).toBe('p2');
    expect(orphans[0]!.artifacts).toEqual(['https://pr/2', 'origin/se/p2']);
  });

  test('같은 페이즈 pending-write 다건 → artifacts 누적(중복 제거)', () => {
    recordPendingWrite('w3', { phaseId: 'p', phaseTitle: 'C', artifacts: ['https://pr/a'] });
    recordPendingWrite('w3', { phaseId: 'p', phaseTitle: 'C', artifacts: ['https://pr/a', 'https://pr/b'] });
    const orphans = collectPendingWrites('w3');
    expect(orphans.length).toBe(1);
    expect(orphans[0]!.artifacts.sort()).toEqual(['https://pr/a', 'https://pr/b']);
  });

  test('skip(satisfied) 도 consolidate — 스킵된 페이즈는 고아 아님', () => {
    recordPendingWrite('w4', { phaseId: 'p', phaseTitle: 'D', artifacts: ['https://pr/x'] });
    recordExecPhase('w4', { phaseId: 'p', phaseTitle: 'D', op: 'skip', status: 'skipped', deviation: { kind: 'satisfied_skip', note: '이미 충족' } });
    expect(collectPendingWrites('w4')).toEqual([]);
  });

  test('phaseId 필터 — 특정 페이즈 고아만 조회', () => {
    recordPendingWrite('w5', { phaseId: 'p1', phaseTitle: 'A', artifacts: ['https://pr/1'] });
    recordPendingWrite('w5', { phaseId: 'p2', phaseTitle: 'B', artifacts: ['https://pr/2'] });
    expect(collectPendingWrites('w5', { phaseId: 'p2' }).map((o) => o.phaseId)).toEqual(['p2']);
  });
});
