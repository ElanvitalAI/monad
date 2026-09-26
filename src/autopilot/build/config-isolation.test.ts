// ── Self-Evolution · config 격리 회귀 가드 (2026-07-09) ───────────────────
//
// 대표 강조: "config 격리가 잘되는지 확인. 구현상 헛점으로 메인 config 을 날려서는 안 됨."
// SHA 프로토콜(reference_test_isolation_sha_protocol): 메인 ~/.elanous/config.json 의 SHA 를
// 캡처 → 격리 override 설정/해제 사이클 → 메인 config 이 절대 안 바뀌었는지 assert.
// override 가 config 경로를 격리로 리다이렉트하고, reset 이 정식 복원함을 증명.

import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setElanousConfigDir, resetElanousConfigDir } from '../../elanous-config-dir.js';
import { userConfigPath } from '../../user-config.js';
import { planIsolatedInstance, buildTestConfig } from './isolated-instance.js';

const MAIN_CONFIG = join(homedir(), '.elanous/config.json');

function sha(path: string): string | null {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex'); } catch { return null; }
}

describe('config 격리 SHA 가드 — 메인 무오염 보증', () => {
  test('override 는 config 경로를 격리로 리다이렉트, reset 은 정식 복원, 메인 SHA 불변', () => {
    const before = existsSync(MAIN_CONFIG) ? sha(MAIN_CONFIG) : null;
    const productionPath = userConfigPath();

    const plan = planIsolatedInstance(join(homedir(), 'source/leader/monad-agent'), 'iso-guard');
    setElanousConfigDir(plan.configDir);
    try {
      const isolatedPath = userConfigPath();
      // 격리 경로가 worktree 하위이고 정식과 다름.
      expect(isolatedPath).toContain('.worktrees');
      expect(isolatedPath).toContain('.elanous-se');
      expect(isolatedPath).not.toBe(productionPath);
      expect(dirname(isolatedPath)).not.toBe(dirname(productionPath));
    } finally {
      resetElanousConfigDir();
    }

    // reset 후 정식 경로 복원.
    expect(userConfigPath()).toBe(productionPath);
    // 메인 config 파일 SHA 불변(격리 작업이 메인을 절대 건드리지 않음).
    const after = existsSync(MAIN_CONFIG) ? sha(MAIN_CONFIG) : null;
    expect(after).toBe(before);
  });

  test('테스트 config 는 매매/발송/자율 전부 disarmed(격리 데몬 실집행 불가)', () => {
    const c = buildTestConfig(31450) as any;
    expect(c.dispatch.enabled).toBe(false);
    expect(c.finance.dispatch.enabled).toBe(false);
    expect(c.finance.dig.autoGoal.enabled).toBe(false);
    expect(c.autopilot.merge.armed).toBe(false);
    expect(c.autopilot.reboot.armed).toBe(false);
  });
});
