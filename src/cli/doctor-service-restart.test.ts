// D5 `doctor --fix --yes --restart` — 판이 다를 때만 · 설치본에서만 · 재시작 뒤 daemonSha 로 다시 잰다.
import { describe, expect, test } from 'bun:test';
import { applyServiceRestart } from './doctor-fix.js';
import type { ReadinessDeps } from './doctor-readiness.js';

const CODE = 'abc123def4567890abc123def4567890abc123de';
const base: ReadinessDeps = { installPrefix: '/opt/monad', codeRevision: CODE, platform: 'darwin', health: { daemonSha: 'fffffffffff' } };

describe('applyServiceRestart', () => {
  test('restarts the launchd service and reports the verified daemonSha', async () => {
    const calls: string[] = [];
    const r = await applyServiceRestart({
      readiness: base, uid: 501,
      run: (cmd, args) => { calls.push(`${cmd} ${args.join(' ')}`); return { status: 0, stderr: '' }; },
      verify: async (commit) => ({ ok: commit === CODE, daemonSha: 'abc123def456' }),
    });
    expect(calls).toEqual(['launchctl kickstart -k gui/501/com.monad.nexus']);
    expect(r).toEqual({ result: 'restarted', reason: 'daemonSha abc123def456 now matches this code', daemonSha: 'abc123def456' });
  });

  test('linux uses the user systemd unit', async () => {
    const calls: string[] = [];
    await applyServiceRestart({
      readiness: { ...base, platform: 'linux' },
      run: (cmd, args) => { calls.push(`${cmd} ${args.join(' ')}`); return { status: 0, stderr: '' }; },
      verify: async () => ({ ok: true, daemonSha: 'abc123def456' }),
    });
    expect(calls).toEqual(['systemctl --user restart monad-nexus']);
  });

  test('does not restart when the service already runs this code, when unmeasured, or from a checkout', async () => {
    const never = () => { throw new Error('must not restart'); };
    expect((await applyServiceRestart({ readiness: { ...base, health: { daemonSha: 'abc123def456' } }, run: never })).result).toBe('skipped');
    expect((await applyServiceRestart({ readiness: { ...base, health: null }, run: never })).result).toBe('skipped');
    const checkout = await applyServiceRestart({ readiness: { ...base, installPrefix: null }, run: never });
    expect(checkout.result).toBe('skipped');
    expect(checkout.reason).toContain('monad self-update --restart');
  });

  test('a failed restart command or a daemon that comes back on another version is a failure', async () => {
    const failedRun = await applyServiceRestart({ readiness: base, run: () => ({ status: 3, stderr: 'boom' }), verify: async () => ({ ok: true }) });
    expect(failedRun.result).toBe('failed');
    expect(failedRun.reason).toContain('boom');
    const wrong = await applyServiceRestart({ readiness: base, run: () => ({ status: 0, stderr: '' }), verify: async () => ({ ok: false, reason: 'daemonSha 111 ≠ abc' }) });
    expect(wrong).toMatchObject({ result: 'failed' });
    expect(wrong.reason).toContain('does not run this code');
    const unmeasured = await applyServiceRestart({ readiness: base, run: () => ({ status: 0, stderr: '' }), verify: async () => ({ ok: false, unmeasured: true, reason: 'rest url 없음' }) });
    expect(unmeasured.reason).toContain('could not be measured');
  });
});
