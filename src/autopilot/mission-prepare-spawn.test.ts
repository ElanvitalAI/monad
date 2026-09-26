// ── 재분해 관측 로그 경로 테스트 (2026-07-13) ──────────────────────────────
import { describe, expect, it } from 'bun:test';
import { missionPrepareLogPath } from './mission-prepare-spawn.js';
import { elanousStateRoot } from './state-paths.js';
import { join } from 'node:path';

describe('missionPrepareLogPath', () => {
  it('미션 id hash 세그먼트로 미션별 경로', () => {
    const p = missionPrepareLogPath('apm_적응형-투자-c_a6230f');
    expect(p).toContain('mission-prepare-a6230f.log');
    // ⚠️ 뿌리를 **하드코딩하지 않는다**(2026-07-27 정정) — 종전엔 `.elanous/conatus` 를 단언해
    //    *"이 프로세스는 운영 우주"* 를 암묵 가정했다. `bunfig` preload(#c2e895a · 2026-07-25)가
    //    `ELANOUS_STATE_DIR` 미설정 시 전역 격리 tmp 를 강제하면서 그 가정이 깨져 계속 빨간 채였다.
    //    시험 대상은 **뿌리가 어디냐가 아니라 그 아래 conatus 세그먼트**이므로 리졸버에 맞춰 단언한다.
    expect(p).toContain(join(elanousStateRoot(), 'conatus'));
  });
  it('ascii 아닌 문자 제거(파일명 안전)', () => {
    const p = missionPrepareLogPath('apm_한글슬러그_hash123');
    expect(p).toContain('mission-prepare-hash123.log');
    expect(/[가-힣]/.test(p)).toBe(false);
  });
  it('_ 없는 id 폴백', () => {
    const p = missionPrepareLogPath('plainid');
    expect(p).toContain('mission-prepare-plainid.log');
  });

  // ★ 인스턴스 스코프(ISO·2026-07-14) — ELANOUS_STATE_DIR 존중(homedir 고정 은퇴).
  it('ELANOUS_STATE_DIR 설정 시 test 루트 아래로(로그 누수 방지)', () => {
    const saved = process.env.ELANOUS_STATE_DIR;
    try {
      process.env.ELANOUS_STATE_DIR = '/tmp/elanous-test-root';
      const p = missionPrepareLogPath('apm_x_abc123');
      expect(p).toBe('/tmp/elanous-test-root/conatus/mission-prepare-abc123.log');
    } finally {
      if (saved === undefined) delete process.env.ELANOUS_STATE_DIR;
      else process.env.ELANOUS_STATE_DIR = saved;
    }
  });
});
