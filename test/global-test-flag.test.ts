// 전역 `--test` 입구 계약 테스트 (P2 · 2026-07-26)
//
// 설계 = 내부 문서 `DESIGN-instance-leader-and-default-test-2026-07-26` §10 P2.
// 핵심: 격리 기계(applyIsolatedRoot)는 이미 있었고 **공개 입구만 없었다**. 이 파일은
//   ①추출 계약 ②소유권 경계(기존 5개 명령 동작 무변경) ③루트 해석(worktree 포함)
//   ④fail-closed(레포 밖에서 조용히 prod 로 흐르지 않음) ⑤ratchet(테이블 누락 차단)
// 을 고정한다.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractTestFlag, commandPath, commandOwnsTestFlag, findTreeRoot, resolveTestRoot,
  applyTestFlagFromArgv, OWNED_TEST_FLAG_PATHS, declaredTestFlagPaths, uncoveredTestFlagPaths, staleTestFlagPaths,
} from '../src/cli/test-flag.js';

const argvOf = (...rest: string[]) => ['node', 'monad', ...rest];

describe('commandPath / commandOwnsTestFlag — 소유권 경계', () => {
  test('플래그 이전의 연속 비-플래그 토큰이 명령 경로', () => {
    expect(commandPath(argvOf('logs', 'timeline', '--since', '1h'))).toEqual(['logs', 'timeline']);
    expect(commandPath(argvOf('--test'))).toEqual([]);   // 명령 없음 → 비-소유
  });

  test('소유 명령(기존 5개)은 전역 격리기가 손대지 않는다', () => {
    for (const p of OWNED_TEST_FLAG_PATHS) {
      expect(commandOwnsTestFlag(argvOf(...p, '--test'))).toBe(true);
    }
  });

  test('★session 계열은 --test 가 다른 루트(~/.monad/telegram-test) — 무성 의미변경 금지', () => {
    expect(commandOwnsTestFlag(argvOf('session', 'watch', '--test'))).toBe(true);
    expect(commandOwnsTestFlag(argvOf('session', 'compact', '--test'))).toBe(true);
  });

  test('그 외 명령은 전역 격리기가 가져간다', () => {
    for (const c of [['ops', 'status'], ['autopilot', 'list'], ['self', 'implement'], ['config', 'get'], ['chat']]) {
      expect(commandOwnsTestFlag(argvOf(...c, '--test'))).toBe(false);
    }
  });
});

describe('extractTestFlag — 추출 계약', () => {
  test('비-소유 명령에서는 토큰을 제거한다 (Commander 가 unknown option 으로 죽지 않게)', () => {
    const r = extractTestFlag(argvOf('ops', 'status', '--test'));
    expect(r.found).toBe(true);
    expect(r.ownedByCommand).toBe(false);
    expect(r.argv).toEqual(argvOf('ops', 'status'));
  });

  test('★소유 명령에서는 토큰을 남긴다 (그 명령이 계속 해석)', () => {
    const r = extractTestFlag(argvOf('logs', '--test'));
    expect(r.ownedByCommand).toBe(true);
    expect(r.argv).toEqual(argvOf('logs', '--test'));
  });

  test('--test=<dir> 로 루트를 직접 지정할 수 있다', () => {
    const r = extractTestFlag(argvOf('ops', 'status', '--test=/tmp/iso'));
    expect(r.explicitDir).toBe('/tmp/iso');
    expect(r.argv).toEqual(argvOf('ops', 'status'));
  });

  test('★값 문법은 --test=<dir> 하나 — 공백 형태는 뒤 토큰을 삼키지 않는다(모호함 제거)', () => {
    const r = extractTestFlag(argvOf('ops', 'status', '--test', 'iso'));
    expect(r.explicitDir).toBeUndefined();
    expect(r.argv).toEqual(argvOf('ops', 'status', 'iso'));
  });

  test('★전역과 소유 플래그가 함께 있으면 위치별로 가른다', () => {
    // 앞의 --test = 전역(추출) · 뒤의 --test = session watch 소유(보존)
    const r = extractTestFlag(['node', 'monad', '--test', 'session', 'watch', '--test']);
    expect(r.found).toBe(true);
    expect(r.argv).toEqual(['node', 'monad', 'session', 'watch', '--test']);
  });

  test('★--test 가 명령 앞이면 전역 플래그 — 소유로 보지 않는다', () => {
    // 소유로 보고 남기면 루트의 --test 선언이 session 을 값으로 삼켜 격리도 명령도 깨진다.
    const r = extractTestFlag(['node', 'monad', '--test', 'session', 'watch']);
    expect(r.argv).toEqual(['node', 'monad', 'session', 'watch']);
  });

  test('★비-소유 명령의 인자가 우연히 소유 명령 이름이어도 오판하지 않는다 (운영 오염 방지)', () => {
    // 이전 판본은 argv 어디서든 'logs' 를 찾아 소유로 오판 → 격리를 건너뛰고 운영으로 흘렀다.
    const r = extractTestFlag(argvOf('config', 'get', 'logs', '--test'));
    expect(r.ownedByCommand).toBe(false);
    expect(r.argv).toEqual(argvOf('config', 'get', 'logs'));
  });

  test('★선행 전역 옵션이 있어도 소유 명령을 잃지 않는다', () => {
    const r = extractTestFlag(['node', 'monad', '--verbose', 'session', 'watch', '--test']);
    expect(r.ownedByCommand).toBe(true);
    expect(r.argv).toContain('--test');
  });

  test('★`--` 이후는 명령의 리터럴 인자 — 건드리지 않는다(표준 argv 경계)', () => {
    const r = extractTestFlag(argvOf('chat', '--', '--test'));
    expect(r.argv).toEqual(argvOf('chat', '--', '--test'));
  });

  test('--test 가 없으면 argv 무변경', () => {
    const r = extractTestFlag(argvOf('ops', 'status'));
    expect(r.found).toBe(false);
    expect(r.argv).toEqual(argvOf('ops', 'status'));
  });
});

describe('findTreeRoot / resolveTestRoot — worktree 포함 해석', () => {
  test('.git 이 디렉토리인 트리', () => {
    const root = mkdtempSync(join(tmpdir(), 'tf-repo-'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    expect(findTreeRoot(join(root, 'src', 'deep'))).toBe(root);
    expect(resolveTestRoot(join(root, 'src'))).toBe(join(root, '.monad-test'));
  });

  test('★.git 이 파일인 worktree 도 잡는다 → worktree 전용 격리(병렬 self-dev 충돌 0)', () => {
    const wt = mkdtempSync(join(tmpdir(), 'tf-wt-'));
    writeFileSync(join(wt, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
    expect(findTreeRoot(wt)).toBe(wt);
    expect(resolveTestRoot(wt)).toBe(join(wt, '.monad-test'));
  });

  test('트리 밖이면 null', () => {
    expect(findTreeRoot('/')).toBeNull();
  });

  test('명시 dir 이 트리 해석보다 우선', () => {
    expect(resolveTestRoot('/', '/tmp/explicit')).toBe('/tmp/explicit');
  });

  test('★--test=<dir> 경로 정규화 — ~ 확장 + 상대경로 절대화', () => {
    expect(resolveTestRoot('/', '~/iso')).toBe(join(homedir(), 'iso'));
    expect(resolveTestRoot('/base', './rel')).toBe('/base/rel');
    expect(resolveTestRoot('/base', 'iso')).toBe('/base/iso');   // 일반 상대경로도 동일 계약
  });
});

describe('applyTestFlagFromArgv — 적용과 fail-closed', () => {
  const withArgv = <T>(argv: string[], fn: () => T): T => {
    const prev = process.argv;
    process.argv = argv;
    try { return fn(); } finally { process.argv = prev; }
  };

  test('비-소유 명령이면 격리 루트를 적용하고 argv 에서 토큰을 뺀다', () => {
    const root = mkdtempSync(join(tmpdir(), 'tf-apply-'));
    mkdirSync(join(root, '.git'));
    let applied: string | undefined;
    const out = withArgv(argvOf('ops', 'status', '--test'), () =>
      applyTestFlagFromArgv({ cwd: root, apply: (d) => { applied = d; } }));
    expect(out).toBe(join(root, '.monad-test'));
    expect(applied).toBe(join(root, '.monad-test'));
  });

  test('★소유 명령 뒤의 --test 는 그 명령 것 — 격리 적용 안 함(동작 무변경)', () => {
    let applied = false;
    const out = withArgv(argvOf('logs', '--test'), () =>
      applyTestFlagFromArgv({ cwd: '/tmp', apply: () => { applied = true; } }));
    expect(out).toBeUndefined();
    expect(applied).toBe(false);
  });

  test('★배선 — 명령 **앞**의 전역 --test 는 소유 명령이어도 격리를 적용한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'tf-pre-'));
    mkdirSync(join(root, '.git'));
    let applied: string | undefined;
    const out = withArgv(['node', 'monad', '--test', 'session', 'watch'], () =>
      applyTestFlagFromArgv({ cwd: root, apply: (d) => { applied = d; } }));
    expect(out).toBe(join(root, '.monad-test'));   // 종전엔 undefined = 운영으로 흘렀다
    expect(applied).toBe(join(root, '.monad-test'));
    expect(process.argv).toEqual(process.argv);    // (withArgv 가 복원)
  });

  test('★배선 — 혼합 입력: 앞은 격리 적용, 뒤의 소유 토큰은 보존', () => {
    const root = mkdtempSync(join(tmpdir(), 'tf-mix-'));
    mkdirSync(join(root, '.git'));
    let applied: string | undefined;
    let seenArgv: string[] = [];
    withArgv(['node', 'monad', '--test', 'session', 'watch', '--test'], () => {
      applyTestFlagFromArgv({ cwd: root, apply: (d) => { applied = d; } });
      seenArgv = [...process.argv];
    });
    expect(applied).toBe(join(root, '.monad-test'));
    expect(seenArgv).toEqual(['node', 'monad', 'session', 'watch', '--test']);
  });

  test('★전역 값은 소유 토큰 값에 오염되지 않는다', () => {
    const r = extractTestFlag(['node', 'monad', '--test=/tmp/global', 'session', 'watch', '--test=/tmp/owned']);
    expect(r.globalExplicitDir).toBe('/tmp/global');
    expect(r.argv).toContain('--test=/tmp/owned');
  });

  test('★레포 밖에서 --test 는 fail-closed — 조용히 prod 로 흐르지 않는다', () => {
    let failed = '';
    let applied = false;
    withArgv(argvOf('ops', 'status', '--test'), () =>
      applyTestFlagFromArgv({
        cwd: '/',
        apply: () => { applied = true; },
        fail: ((m: string) => { failed = m; return undefined as never; }),
      }));
    expect(applied).toBe(false);
    expect(failed).toContain('격리 루트를 정할 수 없습니다');
  });

  test('--test 가 없으면 no-op', () => {
    let applied = false;
    const out = withArgv(argvOf('ops', 'status'), () =>
      applyTestFlagFromArgv({ cwd: '/tmp', apply: () => { applied = true; } }));
    expect(out).toBeUndefined();
    expect(applied).toBe(false);
  });
});

// ── ratchet — 테이블이 실제 Commander 선언과 일치해야 한다 ────────────────────
//
// 누군가 새 명령에 `.option('--test')` 를 달고 테이블에 안 넣으면, 전역 추출기가 토큰을 먹어
// 그 명령이 플래그를 **조용히 못 보게** 된다. 소스에서 선언 지점을 세어 테이블과 대조한다.
// ⚠️ 종전 ratchet 은 '문자열 출현 **개수** == 테이블 크기' 였다 — 주석까지 세고 선언 교체를
//    놓치는 Goodhart 테스트였다(리뷰 지적). 개수가 아니라 **선언 지점 집합**을 고정한다.
//    소유권 테이블은 접두 매칭이라 선언 수와 1:1 이 아니므로(예: logs 하나가 timeline 도 덮음)
//    두 관심사를 분리해 각각 단언한다.
describe('소유권 정합 — Commander 트리 실순회 (텍스트 grep 아님)', () => {
  const cmd = (name: string, opts: string[], children: unknown[] = []) =>
    ({ name: () => name, options: opts.map((long) => ({ long })), commands: children }) as never;

  test('선언된 --test 경로를 트리에서 정확히 모은다 (multiline·문법 무관)', () => {
    const root = cmd('monad', ['--test'], [
      cmd('logs', ['--test'], [cmd('timeline', ['--test'])]),
      cmd('ops', [], [cmd('status', [])]),
    ]);
    expect(declaredTestFlagPaths(root)).toEqual([['logs'], ['logs', 'timeline']]);
  });

  test('테이블이 덮으면 누락 0 (접두 매칭 — logs 가 timeline 도 덮는다)', () => {
    const root = cmd('monad', [], [cmd('logs', ['--test'], [cmd('timeline', ['--test'])])]);
    expect(uncoveredTestFlagPaths(root, [['logs']])).toEqual([]);
  });

  test('★테이블을 잊은 새 명령을 잡는다 (이게 진짜 보장)', () => {
    const root = cmd('monad', [], [cmd('brandnew', ['--test'])]);
    expect(uncoveredTestFlagPaths(root, [['logs']])).toEqual([['brandnew']]);
  });

  test('★역방향 — 테이블에만 있는 stale 항목을 잡는다 (소유자 없는데 격리를 건너뛰면 운영 오염)', () => {
    const root = cmd('monad', [], [cmd('logs', ['--test'])]);
    expect(staleTestFlagPaths(root, [['logs'], ['gone', 'away']])).toEqual([['gone', 'away']]);
    expect(staleTestFlagPaths(root, [['logs']])).toEqual([]);
    // ★부모 선언이 사라지고 자식만 남은 경우 — 접두 매칭이면 놓친다
    const childOnly = cmd('monad', [], [cmd('logs', [], [cmd('timeline', ['--test'])])]);
    expect(staleTestFlagPaths(childOnly, [['logs']])).toEqual([['logs']]);
  });

  test('★값-받는 선행 전역 플래그의 값을 명령으로 오인하지 않는다', () => {
    const r = extractTestFlag(['node', 'monad', '--config-dir', '/tmp/x', 'session', 'watch', '--test']);
    expect(r.ownedByCommand).toBe(true);   // session watch 소유 유지
  });

  test('행동 계약 — 소유 경로는 토큰 보존, 비-소유는 제거', () => {
    for (const p of OWNED_TEST_FLAG_PATHS) {
      expect(extractTestFlag(argvOf(...p, '--test')).argv).toContain('--test');
    }
    for (const c of [['ops', 'status'], ['self', 'implement'], ['config', 'get', 'logs']]) {
      expect(extractTestFlag(argvOf(...c, '--test')).argv).not.toContain('--test');
    }
  });
});

// ── 통합 — 실 엔트리포인트에서 --test 가 두 축을 함께 격리하나 (should-fix) ──
describe('통합 — 실 바이너리 --test 배선', () => {
  test('★--test=<dir> 로 실행하면 그 루트의 config 을 읽는다 (state·config 동시 격리 실증)', async () => {
    const { execFileSync } = await import('node:child_process');
    const iso = mkdtempSync(join(tmpdir(), 'tf-e2e-'));
    // 격리 루트에 test-safe config 를 미리 심는다 → 운영 config 물질화 경로를 타지 않는다.
    // 운영 config 의 provider 는 openai-codex — 그와 **다른 유효값**을 심어 출처를 가른다.
    writeFileSync(join(iso, 'config.json'), JSON.stringify({ llm: { provider: 'anthropic' } }));
    const out = execFileSync('bun', ['bin/monad.mjs', 'config', 'get', 'llm.provider', `--test=${iso}`], {
      encoding: 'utf8', timeout: 60_000, env: { ...process.env, MONAD_STATE_DIR: '' },
    });
    // ① config 축 — 운영 config(openai-codex)이 아니라 격리 루트의 값이 나와야 한다.
    expect(out.trim()).toBe('anthropic');
    // ⚠️ state 축은 여기서 단언하지 않는다 — `config get` 은 state 산출물을 만들지 않으므로
    //    파일 존재로 우기면 거짓 근거가 된다. '두 축 동시' 는 아래 인프로세스 테스트가 증명한다.
  }, 90_000);

  test('★실 Commander 트리 감사 — 미포함 경로가 있으면 CI 가 막는다', async () => {
    // ⚠️ 종전엔 성공 실행의 stderr 를 수집하지 않아(catch 에서만 읽음) 경고가 나도 항상
    //    통과했다(리뷰 지적). spawnSync 로 **성공/실패 무관 항상** 수집하고, 감사 훅의
    //    exit code + JSON 으로 판정한다.
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('bun', ['bin/monad.mjs', 'leader', 'status'], {
      encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, MONAD_TEST_FLAG_AUDIT: '1' },
    });
    const payload = JSON.parse((r.stdout ?? '').trim().split('\n').pop() ?? '{}') as { uncovered?: string[]; stale?: string[] };
    expect(payload.uncovered).toEqual([]);   // 정방향: 선언했는데 테이블에 없음
    expect(payload.stale).toEqual([]);       // ★역방향: 테이블에만 있음(더 위험 — 운영 오염)
    expect(r.status).toBe(0);                // 감사 훅이 exit 1 로 CI 를 막는다
  }, 90_000);

  test('★bare --test 가 git 루트의 .monad-test 를 고른다 (실 바이너리)', async () => {
    const { spawnSync } = await import('node:child_process');
    const { existsSync: ex, mkdirSync: mk } = await import('node:fs');
    const repo = mkdtempSync(join(tmpdir(), 'tf-bare-'));
    mk(join(repo, '.git'));
    mk(join(repo, '.monad-test'));
    writeFileSync(join(repo, '.monad-test', 'config.json'), JSON.stringify({ llm: { provider: 'anthropic' } }));
    const r = spawnSync('bun', [join(process.cwd(), 'bin/monad.mjs'), 'config', 'get', 'llm.provider', '--test'], {
      encoding: 'utf8', timeout: 60_000, cwd: repo,
      env: { ...process.env, MONAD_STATE_DIR: '' },
    });
    expect((r.stdout ?? '').trim()).toBe('anthropic');   // 트리의 .monad-test config 을 읽었다
    expect(ex(join(repo, '.monad-test'))).toBe(true);
  }, 90_000);

  test('★두 축 동시 격리 — applyIsolatedRoot 가 state-dir 과 config-dir 을 한 뿌리로 세운다', async () => {
    const iso = mkdtempSync(join(tmpdir(), 'tf-axes-'));
    writeFileSync(join(iso, 'config.json'), JSON.stringify({ llm: { provider: 'anthropic' } }));
    const prevState = process.env.MONAD_STATE_DIR;
    process.env.MONAD_STATE_DIR = '';
    try {
      const { applyIsolatedRoot } = await import('../src/cli/test-state-dir-flag.js');
      const { getMonadConfigDir } = await import('../src/monad-config-dir.js');
      applyIsolatedRoot(iso);
      expect(process.env.MONAD_STATE_DIR).toBe(iso);   // state 축
      expect(getMonadConfigDir()).toBe(iso);           // config 축
    } finally {
      // ⚠️ assertion 이 던져도 반드시 복구 — 안 하면 후속 테스트가 순서 의존으로 오염된다.
      const { resetMonadConfigDir } = await import('../src/monad-config-dir.js');
      const { setTestStateRoot } = await import('../src/nexus/paths.js');
      resetMonadConfigDir();
      setTestStateRoot(null);
      if (prevState === undefined) delete process.env.MONAD_STATE_DIR;
      else process.env.MONAD_STATE_DIR = prevState;
    }
  });
});
