// walker 미션 boundary 격리(2026-07-21) 회귀 가드 — 절대경로 누수 봉쇄가
// opt-in(boundary)일 때만 작동하고 기본은 무회귀임을 못박는다.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  setSessionCwd,
  getSessionBoundary,
  isWriteAllowedInBoundary,
  initSessionWorkingDir,
  __resetSessionWorkingDir,
} from './working-dir.js';

describe('session working-dir boundary (walker 격리)', () => {
  beforeEach(() => __resetSessionWorkingDir());

  it('boundary 비활성 = 절대경로 항상 허용(무회귀)', () => {
    initSessionWorkingDir(process.cwd());
    expect(getSessionBoundary()).toBeNull();
    expect(isWriteAllowedInBoundary('/anywhere/else/x.md')).toBe(true);
    expect(isWriteAllowedInBoundary(`${process.cwd()}/y.md`)).toBe(true);
  });

  it('setSessionCwd 기본(옵션 없음) = boundary off(종전 동작)', () => {
    setSessionCwd(process.cwd(), 'tool');
    expect(getSessionBoundary()).toBeNull();
    expect(isWriteAllowedInBoundary('/other/tree/x.md')).toBe(true);
  });

  it('boundary 활성 = 경계 안 허용·밖 절대경로 거부', () => {
    const wt = process.cwd();
    setSessionCwd(wt, 'tool', { boundary: true });
    expect(getSessionBoundary()).toBe(wt);
    expect(isWriteAllowedInBoundary(wt)).toBe(true); // 경계 자신
    expect(isWriteAllowedInBoundary(`${wt}/sub/dir/x.md`)).toBe(true); // 하위
    expect(isWriteAllowedInBoundary('/totally/other/x.md')).toBe(false); // 밖
  });

  it('prefix 함정 회피 — 경계와 이름만 겹치는 형제 디렉토리는 거부', () => {
    const wt = process.cwd();
    setSessionCwd(wt, 'tool', { boundary: true });
    // `<wt>-worktrees/...` 는 `<wt>/` 로 시작하지 않으므로 밖(정확한 경계).
    expect(isWriteAllowedInBoundary(`${wt}-worktrees/foo/x.md`)).toBe(false);
  });

  it('boundary off 로 재설정하면 다시 전역 허용', () => {
    const wt = process.cwd();
    setSessionCwd(wt, 'tool', { boundary: true });
    expect(isWriteAllowedInBoundary('/other/x.md')).toBe(false);
    setSessionCwd(wt, 'tool', { boundary: false });
    expect(getSessionBoundary()).toBeNull();
    expect(isWriteAllowedInBoundary('/other/x.md')).toBe(true);
  });
});
