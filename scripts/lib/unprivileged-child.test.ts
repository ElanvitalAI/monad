// ⭐ 「권한을 낮췄다」는 판정 자체를 문다 — 이 심이 틀리면 EACCES 회귀가 «조용히 거짓 통과»한다.
//   (Bun 의 `uid` 옵션이 무시된 채로 root 가 재면 `chmod 000` 이 그냥 읽혀 「읽힘」이 정답처럼 보인다.)
import { describe, expect, it } from 'bun:test';
import { readinessProbeArgv, resolveUnprivilegedLauncher, shellQuote, unprivilegedCandidates } from './unprivileged-child.js';

describe('resolveUnprivilegedLauncher', () => {
  it('passes argv through untouched when the runner is already unprivileged', () => {
    const launcher = resolveUnprivilegedLauncher({ getuid: () => 501, env: {}, probeUid: () => { throw new Error('must not probe'); } });
    expect(launcher).not.toBeNull();
    expect(launcher!.via).toBe('already-unprivileged');
    expect(launcher!.uid).toBe(501);
    expect(launcher!.wrap(['bun', 'x.ts'])).toEqual(['bun', 'x.ts']);
  });

  // ⛔⭐ 이 테스트가 이 파일의 존재 이유다 — 「명령이 성공했다」와 「uid 가 내려갔다」는 다른 자다.
  it('rejects a strategy that reports success while still running as root', () => {
    const probed: string[][] = [];
    const launcher = resolveUnprivilegedLauncher({
      getuid: () => 0,
      env: {},
      probeUid: (argv) => { probed.push([...argv]); return argv[0] === 'su' ? 65534 : 0; }, // sudo 는 «0 을 보고»한다
    });
    expect(launcher!.via).toBe('su');
    expect(launcher!.uid).toBe(65534);
    expect(probed[0]![0]).toBe('sudo');   // 먼저 시도했고
    expect(probed.at(-1)![0]).toBe('su'); // 0 이라 버린 뒤 다음으로 갔다
  });

  it('skips a strategy whose tool is absent (probe returns null) and keeps going', () => {
    const launcher = resolveUnprivilegedLauncher({
      getuid: () => 0,
      env: { SUDO_USER: 'user', SUDO_UID: '501', SUDO_GID: '20' },
      probeUid: (argv) => (argv[0] === 'setpriv' ? 501 : null),
    });
    expect(launcher!.via).toBe('setpriv');
    expect(launcher!.user).toBe('user');
    expect(launcher!.wrap(['bun', 'x.ts'])).toEqual(['setpriv', '--reuid=501', '--regid=20', '--clear-groups', '--', 'bun', 'x.ts']);
  });

  it('returns null — not a fake success — when no strategy actually drops privileges', () => {
    expect(resolveUnprivilegedLauncher({ getuid: () => 0, env: {}, probeUid: () => null })).toBeNull();
    expect(resolveUnprivilegedLauncher({ getuid: () => 0, env: {}, probeUid: () => 0 })).toBeNull();
  });

  it('prefers the sudo invoker over the generic accounts and never targets root', () => {
    expect(unprivilegedCandidates({ SUDO_USER: 'user', SUDO_UID: '501', SUDO_GID: '20' }).map((c) => c.name)).toEqual(['user', 'nobody', 'daemon']);
    expect(unprivilegedCandidates({ SUDO_USER: 'root' }).map((c) => c.name)).toEqual(['nobody', 'daemon']);
    // 숫자가 아닌 SUDO_UID 는 setpriv 후보에서 «조용히 0 으로 접히지 않는다» (root 로 낮추는 사고 방지).
    expect(unprivilegedCandidates({ SUDO_USER: 'user', SUDO_UID: 'nope', SUDO_GID: '20' })[0]!.uid).toBeNull();
  });

  // ⛔⭐ 실측 사고를 못 박는다 — uid 는 내려갔는데 `~/.bun/bin/bun`(홈 0700)을 «실행조차 못 한» 경우가 있다.
  //   그때 자식은 안 뜨고, 회귀는 「권한 오류를 못 잰다」가 아니라 「자식이 없다」로 틀린 자리를 가리킨다.
  it('asks readiness and uid in one child so an unreachable runtime disqualifies the strategy', () => {
    expect(readinessProbeArgv(undefined)).toEqual(['id', '-u']);
    expect(readinessProbeArgv({ executable: ['/opt/bun'], readable: ['/repo/probe.ts'] }))
      .toEqual(['/bin/sh', '-c', "test -x '/opt/bun' && test -r '/repo/probe.ts' && id -u"]);

    const seen: string[][] = [];
    const launcher = resolveUnprivilegedLauncher({
      getuid: () => 0,
      env: { SUDO_USER: 'user', SUDO_UID: '501', SUDO_GID: '20' },
      requires: { executable: ['/opt/bun'] },
      // `nobody` 는 런타임에 못 닿아 `test -x` 에서 끊기고(null), 스위트를 부른 사람은 닿는다.
      probeUid: (argv) => { seen.push([...argv]); return argv.includes('user') ? 501 : null; },
    });
    expect(launcher!.user).toBe('user');
    expect(seen[0]).toContain("test -x '/opt/bun' && id -u");
  });

  it('quotes su -c payloads so paths with spaces and quotes survive the shell hop', () => {
    expect(shellQuote('/tmp/a b/probe.ts')).toBe("'/tmp/a b/probe.ts'");
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
    const launcher = resolveUnprivilegedLauncher({ getuid: () => 0, env: {}, probeUid: (argv) => (argv[0] === 'su' ? 65534 : null) });
    expect(launcher!.wrap(['bun', '/tmp/a b/probe.ts'])).toEqual(['su', '-s', '/bin/sh', 'nobody', '-c', "'bun' '/tmp/a b/probe.ts'"]);
  });
});
