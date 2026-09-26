// 운영 리더 권위 계약 테스트 (P1 · 2026-07-26)
//
// 설계 = 내부 문서 `DESIGN-instance-leader-and-default-test-2026-07-26` §5.
// 핵심 불변식: 권위는 파일 하나(leader.json), bun link/launchd 는 **관측 축**일 뿐이다.
// P1 은 관측·기록만 — 아무것도 거부하지 않는다(거부 게이트=P4).

import { describe, expect, test } from 'bun:test';
import {
  observeLeaderAxes, isLeaderTree, bootstrapLeader, normalizeTree,
} from '../src/instance/leader.js';
import { renderLeaderStatus } from '../src/cli/leader-cli.js';

const A = '/Users/j/source/leader/monad-agent';
const B = '/Users/j/source/axon/monad-agent';

describe('observeLeaderAxes — 권위 ⊗ 관측 3축', () => {
  test('세 축이 일치하면 정합', () => {
    const axes = observeLeaderAxes({ authority: A, bunLink: A, launchd: A, self: A });
    expect(axes.coherent).toBe(true);
    expect(axes.drift).toEqual([]);
  });

  test('bun link 만 어긋나면 그 축만 드리프트로 잡는다', () => {
    const axes = observeLeaderAxes({ authority: A, bunLink: B, launchd: A, self: A });
    expect(axes.coherent).toBe(false);
    expect(axes.drift).toEqual(['bun-link']);
  });

  test('launchd 만 어긋나면 — 사람은 새 트리, 데몬은 옛 트리(설계 §5a 이유 ④)', () => {
    const axes = observeLeaderAxes({ authority: A, bunLink: A, launchd: B, self: A });
    expect(axes.drift).toEqual(['launchd']);
  });

  test('권위가 없으면 드리프트를 판정하지 않는다 (기준이 없으므로)', () => {
    const axes = observeLeaderAxes({ authority: null, bunLink: A, launchd: B, self: B });
    expect(axes.coherent).toBe(true);
    expect(axes.drift).toEqual([]);
  });

  test('해석 불가 축(null)은 드리프트로 세지 않는다 (bun 미설치·plist 부재)', () => {
    const axes = observeLeaderAxes({ authority: A, bunLink: null, launchd: null, self: A });
    expect(axes.coherent).toBe(true);
  });
});

describe('isLeaderTree — 이 프로세스가 리더 트리인가', () => {
  test('리더 트리면 true', () => {
    expect(isLeaderTree(observeLeaderAxes({ authority: A, bunLink: A, launchd: A, self: A }))).toBe(true);
  });
  test('비-리더 트리면 false', () => {
    expect(isLeaderTree(observeLeaderAxes({ authority: A, bunLink: A, launchd: A, self: B }))).toBe(false);
  });
  test('★권위 파일이 없으면 판정 보류(null) — 추측으로 prod/test 를 가르지 않는다', () => {
    expect(isLeaderTree(observeLeaderAxes({ authority: null, bunLink: null, launchd: null, self: B }))).toBeNull();
  });
});

describe('bootstrapLeader — 권위 부재 시 3축 추론 1회 물질화', () => {
  test('launchd 를 우선 채택한다 (부팅 시 실제로 운영을 접수하는 축)', () => {
    let written: { tree: string } | undefined;
    const rec = bootstrapLeader('2026-07-26T00:00:00Z', {
      read: () => null,   // 🩸 주입 안 하면 이 기계의 실제 ~/.elanous/leader.json 을 읽어 리더 파일이 있는 기계에서 늘 빨강
      // 리더 트리 본인에서 부팅 — 무접촉 가드 통과(아래 별도 describe 가 비-리더 케이스 담당)
      axes: observeLeaderAxes({ authority: null, bunLink: B, launchd: A, self: A }),
      write: (r) => { written = r; },
    });
    expect(rec?.tree).toBe(normalizeTree(A));
    expect(rec?.bootstrapped).toBe(true);
    expect(written?.tree).toBe(normalizeTree(A));
  });

  test('launchd 가 없으면 bun link 로 폴백', () => {
    const rec = bootstrapLeader('2026-07-26T00:00:00Z', {
      read: () => null,   // 🩸 주입 안 하면 이 기계의 실제 ~/.elanous/leader.json 을 읽어 리더 파일이 있는 기계에서 늘 빨강
      axes: observeLeaderAxes({ authority: null, bunLink: B, launchd: null, self: B }),
      write: () => {},
    });
    expect(rec?.tree).toBe(normalizeTree(B));
  });

  test('★3축 전부 해석 불가면 추측하지 않는다 (권위 없이 계속 — 관측만)', () => {
    let wrote = false;
    const rec = bootstrapLeader('2026-07-26T00:00:00Z', {
      read: () => null,   // 🩸 주입 안 하면 이 기계의 실제 ~/.elanous/leader.json 을 읽어 리더 파일이 있는 기계에서 늘 빨강
      axes: observeLeaderAxes({ authority: null, bunLink: null, launchd: null, self: B }),
      write: () => { wrote = true; },
    });
    expect(rec).toBeNull();
    expect(wrote).toBe(false);
  });
});

describe('renderLeaderStatus — 드리프트가 눈에 보인다', () => {
  test('정합이면 ✅', () => {
    const s = renderLeaderStatus(observeLeaderAxes({ authority: A, bunLink: A, launchd: A, self: A }), null);
    expect(s).toContain('✅ 정합');
  });
  test('드리프트면 어긋난 축과 한 수 해법을 함께 보여준다', () => {
    const s = renderLeaderStatus(observeLeaderAxes({ authority: A, bunLink: B, launchd: A, self: A }), null);
    expect(s).toContain('드리프트');
    expect(s).toContain('leader claim');
  });
  test('비-리더 트리에서 실행하면 그 사실이 표시된다', () => {
    const s = renderLeaderStatus(observeLeaderAxes({ authority: A, bunLink: A, launchd: A, self: B }), null);
    expect(s).toContain('비-리더');
  });
});

describe('bootstrapLeader — 운영 무접촉 가드', () => {
  test('★비-리더 트리에서는 운영 스토어(~/.elanous)에 쓰지 않는다 (관측만)', () => {
    let wrote = false;
    const rec = bootstrapLeader('2026-07-26T00:00:00Z', {
      read: () => null,   // 🩸 주입 안 하면 이 기계의 실제 ~/.elanous/leader.json 을 읽어 리더 파일이 있는 기계에서 늘 빨강
      // 추론=A(pilot) 인데 이 프로세스는 B(axon) → 써서는 안 된다
      axes: observeLeaderAxes({ authority: null, bunLink: A, launchd: A, self: B }),
      write: () => { wrote = true; },
    });
    expect(wrote).toBe(false);
    expect(rec).toBeNull();
  });

  test('리더 트리 본인이면 물질화한다', () => {
    let wrote = false;
    const rec = bootstrapLeader('2026-07-26T00:00:00Z', {
      read: () => null,   // 🩸 주입 안 하면 이 기계의 실제 ~/.elanous/leader.json 을 읽어 리더 파일이 있는 기계에서 늘 빨강
      axes: observeLeaderAxes({ authority: null, bunLink: A, launchd: A, self: A }),
      write: () => { wrote = true; },
    });
    expect(wrote).toBe(true);
    expect(rec?.tree).toBe(normalizeTree(A));
  });
});

// ── claim 실행 경로 (must-fix · self review #5475) ──────────────────────────
//
// 종전 테스트는 관측/렌더만 봤다 → claim 의 계약(순서·조기종료·부분적용 방지)이 무검증이었다.
import { registerLeaderCommands } from '../src/cli/leader-cli.js';
import { Command } from 'commander';

function runClaim(argv: string[], opts: {
  axesSelf: string; prev?: { tree: string } | null; linkFails?: boolean;
}): { logs: string[]; errs: string[]; wrote: { tree: string } | null; linked: string | null } {
  const logs: string[] = []; const errs: string[] = [];
  let wrote: { tree: string } | null = null; let linked: string | null = null;
  const program = new Command();
  program.exitOverride();
  registerLeaderCommands(program, {
    out: { log: (s) => logs.push(s), error: (s) => errs.push(s) },
    now: () => '2026-07-26T00:00:00Z',
    runBunLink: (t) => { if (opts.linkFails) throw new Error('link boom'); linked = t; },
    write: (r) => { wrote = r; },
  });
  program.parse(['node', 'elanous', 'leader', 'claim', ...argv]);
  return { logs, errs, wrote, linked };
}

describe('leader claim — 승격 계약', () => {
  test('기본은 dry-run — 아무것도 쓰지 않는다', () => {
    const r = runClaim([], { axesSelf: B });
    expect(r.wrote).toBeNull();
    expect(r.linked).toBeNull();
    expect(r.logs.join('\n')).toContain('dry-run');
  });

  test('★계획에 미구현을 약속하지 않는다 — plist 는 옮기지 않는다고 명시', () => {
    const r = runClaim([], { axesSelf: B });
    const plan = r.logs.join('\n');
    expect(plan).toContain('launchd plist는 이 명령이 옮기지 않습니다');
    expect(plan).not.toContain('--with-plist');
  });

  test('★bun link 를 먼저 — 실패하면 권위를 기록하지 않는다(부분 적용 방지)', () => {
    const r = runClaim(['--yes'], { axesSelf: B, linkFails: true });
    expect(r.wrote).toBeNull();
    expect(r.errs.join('\n')).toContain('권위를 기록하지 않고 중단');
  });

  test('--yes 면 link 후 권위를 기록한다', () => {
    const r = runClaim(['--yes'], { axesSelf: B });
    expect(r.linked).not.toBeNull();
    expect(r.wrote).not.toBeNull();
  });
});

describe('observeLeaderAtBoot — tree-role 관측(isLeaderTree 실소비)', () => {
  test('비-리더 트리도 조용히 통과하되 역할은 남는다 (P1 은 거부하지 않는다)', async () => {
    const { observeLeaderAtBoot } = await import('../src/instance/leader.js');
    const axes = observeLeaderAtBoot({
      emit: 'log',
      axes: observeLeaderAxes({ authority: A, bunLink: A, launchd: A, self: B }),
    });
    expect(axes.self).toBe(normalizeTree(B));
    expect(isLeaderTree(axes)).toBe(false);   // 관측만 — throw 없음
  });
});

// 🆕 2026-09-24 — 설치본은 cwd 가 비-리더 워크트리여도 리더(운영)다.
import { isInstalledCopyScript } from '../src/instance/leader.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync as rmTmp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
describe('installed copy — 설치본은 운영 코드', () => {
  test('isLeaderTree is true for an installed copy even when self (cwd tree) is a non-leader tree', () => {
    const axes = observeLeaderAxes({ authority: '/leader', bunLink: null, launchd: null, self: '/other-worktree', selfInstalled: true });
    expect(isLeaderTree(axes)).toBe(true);
    expect(isLeaderTree({ ...axes, selfInstalled: false })).toBe(false);
  });
  test('no authority still means undecided, installed or not', () => {
    expect(isLeaderTree(observeLeaderAxes({ authority: null, bunLink: null, launchd: null, self: '/x', selfInstalled: true }))).toBeNull();
  });
  test('isInstalledCopyScript: node_modules/elanous without a git tree above → true; inside a git tree → false', () => {
    const root = mkdtempSync(joinPath(tmpdir(), 'elanous-installed-'));
    try {
      const installed = joinPath(root, 'versions/1.0.0-abc/node_modules/elanous/bin');
      mkdirSync(installed, { recursive: true });
      writeFileSync(joinPath(installed, 'elanous.mjs'), '');
      expect(isInstalledCopyScript(joinPath(installed, 'elanous.mjs'))).toBe(true);
      const tree = joinPath(root, 'repo');
      mkdirSync(joinPath(tree, '.git'), { recursive: true });
      mkdirSync(joinPath(tree, 'node_modules/elanous/bin'), { recursive: true });
      writeFileSync(joinPath(tree, 'node_modules/elanous/bin/elanous.mjs'), '');
      expect(isInstalledCopyScript(joinPath(tree, 'node_modules/elanous/bin/elanous.mjs'))).toBe(false);
      expect(isInstalledCopyScript('')).toBe(false);
      expect(isInstalledCopyScript(joinPath(root, 'missing.mjs'))).toBe(false);
    } finally { rmTmp(root, { recursive: true, force: true }); }
  });
  test('injected self without selfInstalled defaults to not-installed (tests stay deterministic)', () => {
    expect(observeLeaderAxes({ authority: '/a', bunLink: null, launchd: null, self: '/a' }).selfInstalled).toBe(false);
  });
});

// T6(2026-09-24): 전역 링크·launchd·데몬이 설치본으로 옮긴 뒤 세 축이 «해석 불가»로 경고했다 — 설치본은 값이다.
import { installedCopyRoot, observeLeaderAxes as observeAxesT6 } from '../src/instance/leader.js';
import { realpathSync } from 'node:fs';
describe('leader status — installed-copy axes (T6)', () => {
  test('installedCopyRoot names the package root of an installed copy and nothing else', () => {
    const dir = realpathSync(mkdtempSync(joinPath(tmpdir(), 'leader-installed-')));
    try {
      const script = joinPath(dir, 'versions', '1.0.0-abc', 'node_modules', 'elanous', 'bin', 'elanous.mjs');
      mkdirSync(joinPath(script, '..'), { recursive: true });
      writeFileSync(script, '');
      expect(installedCopyRoot(script)).toBe(joinPath(dir, 'versions', '1.0.0-abc', 'node_modules', 'elanous'));
      expect(installedCopyRoot(joinPath(dir, 'tree', 'bin', 'elanous.mjs'))).toBeNull();
    } finally { rmTmp(dir, { recursive: true, force: true }); }
  });

  test('installed axes are neither unresolved nor drift, and render as 설치본 with a coherent verdict', () => {
    const axes = observeAxesT6({
      authority: '/r/pilot', bunLink: null, launchd: null, running: null, self: '/r/axon',
      installed: { 'bun-link': '/i/current/node_modules/elanous', launchd: '/i/current/node_modules/elanous', running: '/i/current/node_modules/elanous' },
    });
    expect(axes.unresolved).toEqual([]);
    expect(axes.drift).toEqual([]);
    expect(Object.keys(axes.installed ?? {}).sort()).toEqual(['bun-link', 'launchd', 'running']);
    const text = renderLeaderStatus(axes, null);
    expect(text).toContain('bun link           : 설치본 (/i/current/node_modules/elanous)');
    expect(text).not.toContain('해석 불가');
    expect(text).toContain('✅ 정합');
  });

  test('an axis that is neither a tree nor an installed copy stays unresolved', () => {
    const axes = observeAxesT6({ authority: '/r/pilot', bunLink: null, launchd: '/r/pilot', self: '/r/pilot', installed: { 'bun-link': null } });
    expect(axes.unresolved).toEqual(['bun-link']);
  });
});
