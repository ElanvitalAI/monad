import { describe, it, expect } from 'bun:test';
import { decideStuckResolution, CORE_LANDED_RATIO, type StuckResolutionInput } from './mission-stuck-resolution.js';

const base: StuckResolutionInput = {
  doneCount: 0, failedCount: 0, totalCount: 10, remainingCount: 0,
  transientFailedCount: 0, escalateFailedCount: 0,
};

describe('decideStuckResolution — 진전 불가 자율 종결(P2)', () => {
  it('실패 없음 → continue(종결 대상 아님)', () => {
    expect(decideStuckResolution({ ...base, failedCount: 0 }).action).toBe('continue');
  });

  it('실패가 전부 일시적(transient) → continue(재구동 여지·프리매처 종결 방지)', () => {
    const r = decideStuckResolution({ ...base, doneCount: 3, failedCount: 2, transientFailedCount: 2 });
    expect(r.action).toBe('continue');
    expect(r.terminalStatus).toBeUndefined();
  });

  it('escalate 실패(보안/모순) 존재 → stop(failed)·자율 종결 금지', () => {
    const r = decideStuckResolution({ ...base, doneCount: 8, failedCount: 1, escalateFailedCount: 1 });
    expect(r.action).toBe('stop');
    expect(r.terminalStatus).toBe('failed'); // 핵심 랜딩됐어도 사람 필요면 STOP
  });

  it('★ 미실행 goal 페이즈 잔존(remaining>0) → continue(프리매처 abandon 방지·대표 705308 통찰)', () => {
    // done 은 저가치 prefix(setup/테스트)이고 진짜 골이 backlog 면, done-ratio 로 종결하면 안 됨.
    const r = decideStuckResolution({ ...base, doneCount: 7, failedCount: 1, totalCount: 10, remainingCount: 2 });
    expect(r.action).toBe('continue'); // 남은 골 재구동 여지
    expect(r.terminalStatus).toBeUndefined();
  });

  it('핵심 랜딩(done/total ≥ 60%·done≥2) + 잔여 0 → graceful-land(done)', () => {
    const r = decideStuckResolution({ ...base, doneCount: 7, failedCount: 3, totalCount: 10, remainingCount: 0 });
    expect(r.action).toBe('graceful-land');
    expect(r.terminalStatus).toBe('done'); // 부분완료 정직 인정
  });

  it('일부 랜딩(0<ratio<60%·done≥1) + 잔여 0 → descope(done·carry)', () => {
    const r = decideStuckResolution({ ...base, doneCount: 3, failedCount: 7, totalCount: 10, remainingCount: 0 });
    expect(r.action).toBe('descope');
    expect(r.terminalStatus).toBe('done');
  });

  it('랜딩 0 + 잔여 0 + 교착 → stop(failed·자율 진행 불가)', () => {
    const r = decideStuckResolution({ ...base, doneCount: 0, failedCount: 10, totalCount: 10, remainingCount: 0 });
    expect(r.action).toBe('stop');
    expect(r.terminalStatus).toBe('failed');
  });

  it('경계 — done/total 정확히 60%·done≥2·잔여 0 → graceful-land', () => {
    const r = decideStuckResolution({ ...base, doneCount: 6, failedCount: 4, totalCount: 10, remainingCount: 0 });
    expect(r.action).toBe('graceful-land');
  });

  it('경계 — done=1(핵심 미달)·잔여 0 → descope not graceful', () => {
    const r = decideStuckResolution({ ...base, doneCount: 1, failedCount: 9, totalCount: 10, remainingCount: 0 });
    expect(r.action).toBe('descope'); // done<2 라 graceful 아님
  });

  it('705308형 — done prefix 크지만 진짜 골(digest·delivery)이 backlog 잔존 → continue(abandon 방지)', () => {
    // 페이즈 0~11 done(setup+테스트·저가치), 12~18 은 backlog(URL digest+delivery·고가치·remaining>0).
    const r = decideStuckResolution({ doneCount: 11, failedCount: 1, totalCount: 19, remainingCount: 6, transientFailedCount: 0, escalateFailedCount: 0 });
    expect(r.action).toBe('continue'); // 진짜 골 남았으니 종결 금지
    expect(r.reason).toContain('종결 보류');
  });

  it('escalate 는 remaining 잔존이어도 즉시 stop(보안/모순은 사람 필요)', () => {
    const r = decideStuckResolution({ ...base, doneCount: 5, failedCount: 1, totalCount: 10, remainingCount: 4, escalateFailedCount: 1 });
    expect(r.action).toBe('stop');
  });

  it('CORE_LANDED_RATIO 는 0.6', () => expect(CORE_LANDED_RATIO).toBe(0.6));
});
