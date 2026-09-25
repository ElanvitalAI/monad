// ── V3 (Phase 2 Bundle 1) — capability-naming tests ──

import { describe, expect, test } from 'bun:test';
import {
  describeCapability,
  describeCapabilityShort,
} from '../../src/voice/capability-naming';
import { deriveTerminalCapability } from '../../src/terminal/posture';

const FULL_CAP = { canRead: true, canInterrupt: true, canWrite: true, canInspect: true };

describe('describeCapability — Korean lane', () => {
  test('user-interactive vw → 키보드 직접 쓸 수 있다', () => {
    const out = describeCapability({
      exposure: { userExposure: 'user-interactive', agentInteractive: true },
      capability: FULL_CAP,
      surfaceKind: 'vw',
    });
    expect(out).toContain('키보드로 직접');
    expect(out).toContain('VW 터미널');
  });

  test('observe-only vw → 키보드 입력 못 가져, ctrl-C 가능', () => {
    const exposure = { userExposure: 'observe-only' as const, agentInteractive: true };
    const out = describeCapability({
      exposure,
      capability: deriveTerminalCapability(exposure),
      surfaceKind: 'vw',
    });
    expect(out).toContain('출력만');
    expect(out).toContain('ctrl-C');
  });

  test('hidden bg → 백그라운드 모니터링 전용', () => {
    const exposure = { userExposure: 'hidden' as const, agentInteractive: true };
    const out = describeCapability({
      exposure,
      capability: deriveTerminalCapability(exposure),
      surfaceKind: 'bg',
    });
    expect(out).toContain('백그라운드');
    expect(out).toContain('백그라운드 셸');
  });

  test('unavailable → 종료된 셸', () => {
    const exposure = { userExposure: 'unavailable' as const, agentInteractive: false };
    const out = describeCapability({
      exposure,
      capability: deriveTerminalCapability(exposure),
    });
    expect(out).toContain('종료');
  });

  test('omit surfaceKind → 일반 "터미널"', () => {
    const out = describeCapability({
      exposure: { userExposure: 'user-interactive', agentInteractive: true },
      capability: FULL_CAP,
    });
    expect(out).toContain('터미널');
    expect(out).not.toContain('VW');
  });
});

describe('describeCapability — English lane', () => {
  test('user-interactive → goes straight through', () => {
    const out = describeCapability({
      exposure: { userExposure: 'user-interactive', agentInteractive: true },
      capability: FULL_CAP,
      surfaceKind: 'vw',
      lane: 'en',
    });
    expect(out).toContain('VW terminal');
    expect(out).toContain('keyboard input goes straight');
  });

  test('observe-only → read-only with interrupt hint', () => {
    const exposure = { userExposure: 'observe-only' as const, agentInteractive: true };
    const out = describeCapability({
      exposure,
      capability: deriveTerminalCapability(exposure),
      surfaceKind: 'vw',
      lane: 'en',
    });
    expect(out).toContain('read-only');
    expect(out).toContain('ctrl-C');
  });

  test('hidden → background-only', () => {
    const exposure = { userExposure: 'hidden' as const, agentInteractive: true };
    const out = describeCapability({
      exposure,
      capability: deriveTerminalCapability(exposure),
      lane: 'en',
    });
    expect(out).toContain('background-only');
  });

  test('unavailable → has already ended', () => {
    const exposure = { userExposure: 'unavailable' as const, agentInteractive: false };
    const out = describeCapability({
      exposure,
      capability: deriveTerminalCapability(exposure),
      lane: 'en',
    });
    expect(out).toContain('ended');
  });
});

describe('describeCapabilityShort', () => {
  test('user-interactive ko → 활성', () => {
    const exposure = { userExposure: 'user-interactive' as const, agentInteractive: true };
    expect(describeCapabilityShort({
      exposure,
      capability: deriveTerminalCapability(exposure),
    })).toBe('활성');
  });

  test('observe-only ko → 읽기 전용', () => {
    const exposure = { userExposure: 'observe-only' as const, agentInteractive: true };
    expect(describeCapabilityShort({
      exposure,
      capability: deriveTerminalCapability(exposure),
    })).toBe('읽기 전용');
  });

  test('hidden ko → 백그라운드 모니터링', () => {
    const exposure = { userExposure: 'hidden' as const, agentInteractive: true };
    expect(describeCapabilityShort({
      exposure,
      capability: deriveTerminalCapability(exposure),
    })).toBe('백그라운드 모니터링');
  });

  test('unavailable ko → 종료된 셸', () => {
    const exposure = { userExposure: 'unavailable' as const, agentInteractive: false };
    expect(describeCapabilityShort({
      exposure,
      capability: deriveTerminalCapability(exposure),
    })).toBe('종료된 셸');
  });

  test('observe-only en → read-only', () => {
    const exposure = { userExposure: 'observe-only' as const, agentInteractive: true };
    expect(describeCapabilityShort({
      exposure,
      capability: deriveTerminalCapability(exposure),
      lane: 'en',
    })).toBe('read-only');
  });
});
