import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./market-posture-cycle.ts', import.meta.url), 'utf8');

describe('market-posture cycle self-registration contract', () => {
  test('registers the permanent DEFCON posture loop with its mission and schedule identity', () => {
    expect(source).toContain("const { registerLoopAgentSafe } = await import('../src/domains/loop-agent-registry.js');");
    expect(source).toContain('registerLoopAgentSafe({');
    expect(source).toContain("loopId: 'autonomous:market-posture'");
    expect(source).toContain("loopKind: 'autonomous'");
    expect(source).toContain("lifecycle: 'permanent'");
    expect(source).toContain("missionId: 'apm_defcon-regime-watch-loop_5d6ca7'");
    expect(source).toContain("scheduleIds: ['af5511a6a40e']");
  });
});
