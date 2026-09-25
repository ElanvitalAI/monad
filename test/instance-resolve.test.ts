// 인스턴스 해석 4층 + §4d 계약 테스트 (P3 · 2026-07-26)
//
// 설계 = 내부 문서 `DESIGN-instance-leader-and-default-test-2026-07-26` §4b·§4d·§10 P3.
// 근본: **운영이 env 의 _부재_ 로 표현돼** "결정했다"와 "아무도 안 했다"를 구분 못 하는 것.
// 이 테스트는 그 결정을 층별로 고정한다.

import { describe, expect, test, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveInstance, configDirFollowingStateDir } from '../src/instance/resolve.js';
import { instanceNameForStateDir, encodeInstanceNameSegment } from '../src/instance-identity.js';
import { observeLeaderAxes } from '../src/instance/leader.js';
import { renderWhere } from '../src/cli/where-cli.js';

const PROD = '/home/u/.monad';
const LEADER = '/src/pilot/monad-agent';
const OTHER = '/src/axon/monad-agent';
const TEST_ROOT = '/src/axon/monad-agent/.monad-test';
const axesFor = (self: string, authority: string | null = LEADER) =>
  observeLeaderAxes({ authority, bunLink: authority, launchd: authority, self });

describe('resolveInstance — 4층 우선순위', () => {
  test('1층 — 명시 플래그가 항상 이긴다', () => {
    const r = resolveInstance({
      explicitFlagRoot: '/explicit/iso', stampedStateDir: PROD,
      axes: axesFor(LEADER), treeDerivedEnabled: true, prodRoot: PROD, depth: 0,
    });
    expect(r.layer).toBe('explicit-flag');
    expect(r.kind).toBe('test');
    expect(r.root).toBe('/explicit/iso');
  });

  test('2층 — 부모 스탬프가 트리 파생보다 우선(프로세스 트리가 한 우주에 머문다)', () => {
    const r = resolveInstance({
      stampedStateDir: TEST_ROOT, axes: axesFor(LEADER),
      treeDerivedEnabled: true, treeTestRoot: '/other/.monad-test', prodRoot: PROD, depth: 2,
    });
    expect(r.layer).toBe('parent-stamp');
    expect(r.root).toBe(TEST_ROOT);
    expect(r.kind).toBe('test');
  });

  test('2층 — 스탬프가 prod 루트면 prod (부재가 아니라 **명시된** 운영)', () => {
    const r = resolveInstance({ stampedStateDir: PROD, prodRoot: PROD, axes: axesFor(OTHER) });
    expect(r.layer).toBe('parent-stamp');
    expect(r.kind).toBe('prod');
  });

  test('3층 — 리더 트리 · depth 0 이면 prod', () => {
    const r = resolveInstance({
      treeDerivedEnabled: true, axes: axesFor(LEADER), depth: 0, prodRoot: PROD, treeTestRoot: TEST_ROOT,
    });
    expect(r.layer).toBe('tree-derived');
    expect(r.kind).toBe('prod');
  });

  test('★3층 — 비-리더 트리는 test (잊으면 안전한 쪽으로 떨어진다)', () => {
    const r = resolveInstance({
      treeDerivedEnabled: true, axes: axesFor(OTHER), depth: 0, prodRoot: PROD, treeTestRoot: TEST_ROOT,
    });
    expect(r.kind).toBe('test');
    expect(r.root).toBe(TEST_ROOT);
  });

  test('★3층 — 리더 트리라도 중첩(depth>0)이면 test (명시 없으면 운영 접수 금지)', () => {
    const r = resolveInstance({
      treeDerivedEnabled: true, axes: axesFor(LEADER), depth: 1, prodRoot: PROD, treeTestRoot: TEST_ROOT,
    });
    expect(r.kind).toBe('test');
  });

  test('★3층 — 권위 미지정이면 파생하지 않는다 (추측으로 우주를 가르지 않는다)', () => {
    const r = resolveInstance({
      treeDerivedEnabled: true, axes: axesFor(OTHER, null), depth: 0, prodRoot: PROD, treeTestRoot: TEST_ROOT,
    });
    expect(r.layer).toBe('default');
    expect(r.kind).toBe('prod');
  });

  test('4층 — 기본은 prod, 그리고 3층이 켜졌다면 무엇이 달라질지 미리 보여준다', () => {
    const r = resolveInstance({
      treeDerivedEnabled: false, axes: axesFor(OTHER), depth: 0, prodRoot: PROD, treeTestRoot: TEST_ROOT,
    });
    expect(r.layer).toBe('default');
    expect(r.kind).toBe('prod');
    expect(r.wouldBeIfTreeDerived?.kind).toBe('test');
    expect(r.wouldBeIfTreeDerived?.root).toBe(TEST_ROOT);
  });

  test('★기본 OFF — 트리 파생은 무성으로 켜지지 않는다(운영 경로 무변경)', () => {
    const r = resolveInstance({ axes: axesFor(OTHER), depth: 0, prodRoot: PROD, treeTestRoot: TEST_ROOT });
    expect(r.layer).toBe('default');
    expect(r.kind).toBe('prod');
  });
});

describe('instanceNameForStateDir — 로그 인스턴스 이름', () => {
  test('repo .monad-test 이름은 종전과 바이트 동일하다', () => {
    expect(instanceNameForStateDir('/repo/.monad-test')).toBe('test:repo');
  });

  test('임시 monad-drive state 루트는 부모 이름으로 구별한다', () => {
    expect(instanceNameForStateDir('/tmp/monad-drive-PGfXzo/state')).toBe('test:monad-drive-PGfXzo');
    const aaa = instanceNameForStateDir('/tmp/monad-drive-AAA/state');
    const bbb = instanceNameForStateDir('/tmp/monad-drive-BBB/state');
    expect(aaa).toBe('test:monad-drive-AAA');
    expect(bbb).toBe('test:monad-drive-BBB');
    expect(aaa).not.toBe(bbb);
  });

  test('비-monad-drive state 루트는 종전 이름을 보존한다', () => {
    expect(instanceNameForStateDir('/project/state')).toBe('test:state');
  });

  test('임시 monad-drive 루트 이름은 부모를 단사 인코딩해 가른다', () => {
    // ⛔ 종전 기대값은 손실 치환(`test:monad-drive-A-B-C-`)이었다. 그러면 `A B_C!` 와
    //    `A-B-C-` 가 **같은 이름**이 돼 가르려던 목적이 무너진다(무인 리뷰 must-fix).
    const name = instanceNameForStateDir('/tmp/monad-drive-A B_C!/state');
    expect(name).toMatch(/^[A-Za-z0-9-:]+$/);
    expect(name).not.toBe(instanceNameForStateDir('/tmp/monad-drive-A-B-C-/state'));
  });
});

describe('§4d — config-dir 은 state-dir 을 따라간다', () => {
  test('격리 state-dir 이면 config-dir 도 그 뿌리로 (축 어긋남 봉합)', () => {
    expect(configDirFollowingStateDir(undefined, TEST_ROOT, PROD)).toEqual({ dir: TEST_ROOT, followed: true });
  });

  test('★명시 --config-dir 이 있으면 손대지 않는다 (사람이 말한 것이 이긴다)', () => {
    expect(configDirFollowingStateDir('/explicit/cfg', TEST_ROOT, PROD)).toEqual({ dir: '/explicit/cfg', followed: false });
  });

  test('state-dir 이 prod 루트면 종전과 동일 (무변경)', () => {
    expect(configDirFollowingStateDir(undefined, PROD, PROD)).toEqual({ dir: PROD, followed: false });
  });

  test('state-dir 이 없으면 prod (무변경)', () => {
    expect(configDirFollowingStateDir(undefined, undefined, PROD)).toEqual({ dir: PROD, followed: false });
  });
});

describe('getMonadConfigDir — §4d 실배선', () => {
  test('★MONAD_STATE_DIR 이 격리 루트면 config-dir 이 따라간다', async () => {
    const prev = process.env.MONAD_STATE_DIR;
    const { getMonadConfigDir, resetMonadConfigDir } = await import('../src/monad-config-dir.js');
    try {
      resetMonadConfigDir();
      process.env.MONAD_STATE_DIR = '/tmp/iso-root';
      expect(getMonadConfigDir()).toBe('/tmp/iso-root');
    } finally {
      resetMonadConfigDir();
      if (prev === undefined) delete process.env.MONAD_STATE_DIR;
      else process.env.MONAD_STATE_DIR = prev;
    }
  });

  test('명시 override 가 state-dir 보다 우선', async () => {
    const prev = process.env.MONAD_STATE_DIR;
    const { getMonadConfigDir, setMonadConfigDir, resetMonadConfigDir } = await import('../src/monad-config-dir.js');
    try {
      process.env.MONAD_STATE_DIR = '/tmp/iso-root';
      setMonadConfigDir('/tmp/explicit');
      expect(getMonadConfigDir()).toBe('/tmp/explicit');
    } finally {
      resetMonadConfigDir();
      if (prev === undefined) delete process.env.MONAD_STATE_DIR;
      else process.env.MONAD_STATE_DIR = prev;
    }
  });
});

describe('renderWhere — 결과뿐 아니라 **왜** 를 보여준다', () => {
  const base = { selfTree: OTHER, authority: LEADER, isLeader: false, configDir: PROD, treeDerivedEnabled: false };

  test('층과 사유가 함께 보인다', () => {
    const r = resolveInstance({ stampedStateDir: TEST_ROOT, prodRoot: PROD, axes: axesFor(OTHER) });
    const s = renderWhere(r, { ...base, configDir: TEST_ROOT });
    expect(s).toContain('2층 · 부모 스탬프');
    expect(s).toContain('test (격리)');
    expect(s).toContain('✓ 같은 뿌리');
  });

  test('★축이 어긋나면 화면에서 바로 보인다', () => {
    const r = resolveInstance({ stampedStateDir: TEST_ROOT, prodRoot: PROD, axes: axesFor(OTHER) });
    const s = renderWhere(r, { ...base, configDir: PROD });   // config 만 prod
    expect(s).toContain('축 어긋남');
  });

  test('트리 파생 OFF 면 켰을 때 무엇이 달라지는지 미리 보여준다', () => {
    const r = resolveInstance({ axes: axesFor(OTHER), depth: 0, prodRoot: PROD, treeTestRoot: TEST_ROOT });
    const s = renderWhere(r, base);
    expect(s).toContain('트리 파생을 켜면');
    expect(s).toContain('instance.treeDerivedTest');
  });
});

// ── 실배선 — 스위치를 켜면 **실제로** 뿌리가 바뀌나 (must-fix · self review #5479) ──
//
// 종전 테스트는 순수 리졸버·렌더러만 봐서, resolveInstance 를 아무도 소비하지 않아도
// 전부 통과했다(미배선을 통과시키는 Goodhart). 여기서는 monadStateRoot/getMonadConfigDir 가
// 실제로 리졸버를 거치는지 — 그리고 **두 축이 같은 뿌리로 수렴**하는지 — 를 본다.
// ⚠️ 3층(트리 파생) 실배선은 **P3b 로 분리**됐다 — 리졸버가 config 를 읽으면
//    getMonadConfigDir → resolver → getUserConfig → getMonadConfigDir 런타임 재귀가 난다
//    (self review 발견 · src/instance/resolve.ts 상단 참조). 여기서는 §4d 실배선만 고정한다.
describe('실배선 — §4d: config-dir 이 state-dir 을 따라간다(축 어긋남 봉합)', () => {
  // ⚠️ **머신 스위치 상태에 의존하지 않게 쓴다**(2026-07-27).
  //    3층 스위치는 리졸버가 `~/.monad/config.json` 을 **고정 경로 raw** 로 읽는데, Bun 의
  //    `os.homedir()` 는 **HOME env 를 무시하고 시스템 값을 반환**한다(실측) — 즉 HOME 을 바꿔도
  //    격리가 안 된다. 실제로 대표가 스위치를 켜자 "트리 파생 OFF 면" 케이스가 깨졌다.
  //    ⇒ 스위치를 **읽어서** 그 상태에 맞는 계약을 단정한다(어느 쪽이든 §4d 는 성립해야 한다).
  const withEnv = async <T>(v: string | undefined, fn: () => Promise<T> | T): Promise<T> => {
    const prev = process.env.MONAD_STATE_DIR;
    const { resetMonadConfigDir } = await import('../src/monad-config-dir.js');
    const { resetEffectiveInstanceRoot } = await import('../src/instance/resolve.js');
    if (v === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = v;
    resetMonadConfigDir(); resetEffectiveInstanceRoot();
    try { return await fn(); } finally {
      if (prev === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = prev;
      resetMonadConfigDir(); resetEffectiveInstanceRoot();
    }
  };

  test('★env 스탬프가 있으면 두 축이 그 뿌리로 함께 간다 (§4d 축 어긋남 봉합)', async () => {
    await withEnv('/tmp/iso-wired', async () => {
      const { monadStateRoot } = await import('../src/autopilot/state-paths.js');
      const { getMonadConfigDir } = await import('../src/monad-config-dir.js');
      expect(monadStateRoot()).toBe('/tmp/iso-wired');
      expect(getMonadConfigDir()).toBe('/tmp/iso-wired');   // 종전엔 여기가 prod 로 갈라졌다
    });
  });

  test('★스탬프 없으면 두 축이 **함께** 간다 — 스위치 상태와 무관하게 §4d 성립', async () => {
    await withEnv(undefined, async () => {
      const { monadStateRoot } = await import('../src/autopilot/state-paths.js');
      const { getMonadConfigDir } = await import('../src/monad-config-dir.js');
      const { treeDerivedTestEnabled } = await import('../src/instance/resolve.js');

      // ★ 이 실배선 테스트가 **결정적으로** 고정하는 것은 §4d 하나다: 두 축이 절대 갈리지 않는다.
      expect(getMonadConfigDir()).toBe(monadStateRoot());

      // 스위치가 꺼져 있을 때의 기대만 추가로 못 박는다(운영 경로 무변경).
      if (!treeDerivedTestEnabled()) expect(monadStateRoot()).toBe(join(homedir(), '.monad'));
    });
  });

  // ⚠️ **왜 이 describe 에서는 ON 분기를 단정하지 않나** (리뷰 must-fix 2R·3R):
  //    스위치는 `~/.monad/config.json` 을 **고정 경로 raw** 로 읽는데 Bun 의 `os.homedir()` 는
  //    **in-process HOME 변경을 무시**한다(실측) → 이 in-process describe 안에서는 ON 을 결정적으로
  //    구성할 수 없다. 머신 값에 따라 분기하면 "OFF 인 CI 에서는 ON 검증이 아예 안 도는" Goodhart 다.
  //
  //    ⚠️ 단 **"실배선 ON 검증이 불가능"한 것은 아니다**(3R 에서 내 판단을 정정) — `os.homedir()` 는
  //    프로세스 시작 시점의 HOME 을 보므로 **subprocess 로 넘기면 통한다.** 아래
  //    "★스위치 ON + 리더=타 트리 → 세 축이 함께 전환된다 (실 전환 E2E)" 가 정확히 그 방식으로
  //    **격리 HOME + 타 트리 리더**를 구성해 ON 전환을 결정적으로 고정하고 있다.
  //
  //    ⇒ 층 분업: 이 describe = §4d 수렴(리졸버를 실제로 거치는가) · 아래 E2E = 실배선 ON 전환 ·
  //      순수 리졸버 describe = 층 우선순위 판정. 셋 다 머신 스위치 값과 무관하게 결정적이다.
  //
  //    **뮤테이션 증거**(3층 판정 `if (deps.treeDerivedEnabled && derived)` → `if (false && derived)`):
  //      스위치 ON 환경 → 4 fail(21 pass) · 스위치 OFF 환경 → **동일하게 4 fail** · 복원 → 25 pass.
  //      양쪽에서 같은 수가 나오는 것이 "머신 무관"의 실증이다.
  //    **재현**: `bash scripts/verify-tree-derived-mutation.sh`
  //      — 치환이 실제로 먹었는지와 ON/OFF 결과 일치를 **스스로 단정**하고, trap 으로 스위치·소스를
  //        무조건 원복한다(중단해도 안전). 원래 스위치가 없던 상태면 unset 으로 되돌린다.
  //      ⚠️ 손으로 할 거면 `--config-dir ~/.monad` 를 **반드시 명시**하라 — 3층이 켜진 비-리더
  //         트리에서 그냥 `config set` 하면 `.monad-test` 로 파생돼 실효 스위치가 안 바뀐다(오실증했다).
});

describe('3층 실배선 — 스위치 ON 이면 두 축이 함께 전환된다', () => {
  test('★명시 prod 루트는 test 로 오분류되지 않는다', () => {
    const prod = join(homedir(), '.monad');
    const r = resolveInstance({ explicitFlagRoot: prod, prodRoot: prod });
    expect(r.kind).toBe('prod');   // --config-dir ~/.monad 같은 prod 명시
  });

  test('★경로 정규화 — 후행 슬래시가 달라도 같은 prod 로 본다', () => {
    const prod = '/home/u/.monad';
    expect(resolveInstance({ stampedStateDir: '/home/u/.monad/', prodRoot: prod }).kind).toBe('prod');
    expect(configDirFollowingStateDir(undefined, '/home/u/.monad/', prod).followed).toBe(false);
  });

  test('★스위치 ON + 리더=타 트리 → 세 축이 함께 전환된다 (실 전환 E2E)', async () => {
    // ⚠️ 종전엔 typeof 만 확인하는 Goodhart 였다. 격리 HOME 을 만들어 **실제 전환**을 본다.
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const home = mkdtempSync(join(tmpdir(), 'p3-home-'));
    mkdirSync(join(home, '.monad'));
    writeFileSync(join(home, '.monad', 'config.json'), JSON.stringify({ instance: { treeDerivedTest: true } }));
    writeFileSync(join(home, '.monad', 'leader.json'), JSON.stringify({ tree: '/some/other/leader', promotedAt: 'x' }));
    const script = `
      const {effectiveInstanceRoot}=require('${process.cwd()}/src/instance/resolve.ts');
      const {monadStateRoot}=require('${process.cwd()}/src/autopilot/state-paths.ts');
      const {getMonadConfigDir}=require('${process.cwd()}/src/monad-config-dir.ts');
      console.log(JSON.stringify({e:effectiveInstanceRoot(),s:monadStateRoot(),c:getMonadConfigDir()}));
    `;
    const r = spawnSync('bun', ['-e', script], {
      encoding: 'utf8', timeout: 60_000, cwd: process.cwd(),
      env: {
        ...process.env, HOME: home,
        NODE_ENV: '', MONAD_STATE_DIR: '', MONAD_CONFIG_DIR: '', MONAD_NEXUS_DIR: '', MONAD_SESSION_ROOT: '',
      },
    });
    const out = JSON.parse((r.stdout ?? '').trim().split('\n').pop() ?? '{}') as { e?: string; s?: string; c?: string };
    expect(out.e?.endsWith('.monad-test')).toBe(true);
    expect(out.s).toBe(out.e);   // ★state 축
    expect(out.c).toBe(out.e);   // ★config 축 — 두 축이 한 뿌리로 수렴
  }, 90_000);

  test('★resetEffectiveInstanceRoot 로 메모가 실제로 무효화된다 (테스트 seam 계약)', async () => {
    const m = await import('../src/instance/resolve.js');
    const prev = process.env.MONAD_STATE_DIR;
    try {
      delete process.env.MONAD_STATE_DIR;
      m.resetEffectiveInstanceRoot();
      const first = m.effectiveInstanceRoot();
      m.resetEffectiveInstanceRoot();
      expect(m.effectiveInstanceRoot()).toBe(first);   // 재계산해도 같은 답(결정론)
    } finally {
      m.resetEffectiveInstanceRoot();
      if (prev === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = prev;
    }
  });

  test('★--config-dir 명시가 state 축에도 반영된다 (공통 뿌리 계약)', async () => {
    const m = await import('../src/instance/resolve.js');
    const { setMonadConfigDir, resetMonadConfigDir } = await import('../src/monad-config-dir.js');
    const { monadStateRoot } = await import('../src/autopilot/state-paths.js');
    const prev = process.env.MONAD_STATE_DIR;
    try {
      delete process.env.MONAD_STATE_DIR;
      m.resetEffectiveInstanceRoot();
      setMonadConfigDir('/tmp/explicit-common');
      expect(monadStateRoot()).toBe('/tmp/explicit-common');   // 종전엔 prod 로 갈라졌다
    } finally {
      resetMonadConfigDir(); m.resetEffectiveInstanceRoot();
      if (prev === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = prev;
    }
  });
});

// ── 자식 발견 — 리졸버 파생 루트가 레지스트리에 등록되는가 (FEATURE §9-3 나머지 절반) ──
//
// 실측 사건(2026-07-27): 3층 스위치가 켜진 뒤 워크트리 self-dev 자식은 env 없이 리졸버로
// `.monad-test` 우주를 정한다. 그런데 등록 게이트가 `MONAD_STATE_DIR` **존재 여부**를 봐서
// 자식이 로그를 쓰면서도 레지스트리에 안 잡혔고, 운영에서 `logs --all --include-test` 로도
// 보이지 않았다(격리는 됐는데 발견이 안 되는 상태 = 제1원칙 위반).
//
// ⚠️ 반드시 서브프로세스 — Bun 의 `os.homedir()` 는 in-process HOME 변경을 무시한다.
describe('registerStandaloneLogSink — 리졸버 파생 루트의 발견 가능성', () => {
  type Probe = { instances?: Array<Record<string, unknown>>; root?: string };

  /** 격리 HOME 에서 sink 를 등록시키고, 그 HOME 의 instances.json 을 돌려준다.
   *  `stateDir: 'prod'` 는 그 HOME 의 운영 루트를 명시(2층)해 스킵 가드를 겨눈다. */
  async function probe(stateDir: 'derive' | 'prod' | { at: string }): Promise<Probe> {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const home = mkdtempSync(join(tmpdir(), 'sink-home-'));
    try {
      mkdirSync(join(home, '.monad'));
      writeFileSync(join(home, '.monad', 'config.json'), JSON.stringify({ instance: { treeDerivedTest: true } }));
      writeFileSync(join(home, '.monad', 'leader.json'), JSON.stringify({ tree: '/some/other/leader', promotedAt: 'x' }));
      const script = `
        const {registerStandaloneLogSink}=require('${process.cwd()}/src/domains/standalone-log-sink.ts');
        const {effectiveInstanceRoot}=require('${process.cwd()}/src/instance/resolve.ts');
        const {readFileSync,existsSync}=require('node:fs');
        registerStandaloneLogSink('probe').then(()=>{
          const reg=process.env.HOME+'/.monad/logs/instances.json';
          const j=existsSync(reg)?JSON.parse(readFileSync(reg,'utf-8')):{instances:[]};
          console.log(JSON.stringify({instances:j.instances,root:effectiveInstanceRoot()}));
        });
      `;
      // ⚠️ 호스트 env 가 상위 층으로 새어 3층 파생을 우회하면 정상 구현도 실패한다(리뷰 지적).
      //   해석에 관여하는 env 를 전부 명시적으로 비운다 — 이 테스트가 보는 건 오직 리졸버다.
      const at = typeof stateDir === 'object' ? stateDir.at : stateDir === 'prod' ? join(home, '.monad') : '';
      const r = spawnSync('bun', ['-e', script], {
        encoding: 'utf8', timeout: 60_000, cwd: process.cwd(),
        env: {
          ...process.env, HOME: home,
          NODE_ENV: '', MONAD_STATE_DIR: at, MONAD_CONFIG_DIR: '', MONAD_NEXUS_DIR: '', MONAD_SESSION_ROOT: '',
        },
      });
      return JSON.parse((r.stdout ?? '').trim().split('\n').pop() ?? '{}') as Probe;
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  test('★env 없이 3층 파생 → 레지스트리에 등록된다 (kind=test·이름이 운영을 사칭 안 함)', async () => {
    const out = await probe('derive');
    expect(out.root?.endsWith('.monad-test')).toBe(true);
    const hit = (out.instances ?? []).find((e) => e.stateDir === out.root);
    expect(hit).toBeDefined();                       // ★종전엔 등록 자체가 없었다
    expect(hit!.kind).toBe('test');                  // ★이름 축과 같은 판정(관례 밖 루트도 test)
    expect(String(hit!.name).startsWith('test:')).toBe(true);
  }, 90_000);

  test('★운영 루트는 등록하지 않는다 (prod 데몬 레지스트리 항목 오염 방지 가드 유지)', async () => {
    const out = await probe('prod');
    expect(out.instances ?? []).toEqual([]);
  }, 90_000);

  // ★관례(`<repo>/.monad-test`) 밖 격리 루트 — 이름은 test:* 인데 kind 만 prod 로 등록되던
  //   자리(리뷰 must-fix). 명시 kind 는 resolveInstanceKind 의 이름 유추를 이기므로, 이게
  //   틀리면 그 인스턴스가 연합 기본 조회에 **운영으로 섞이고** --include-test 의미도 갈린다.
  test('★관례 밖 비-운영 루트도 kind=test (telegram-test 류)', async () => {
    const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const at = mkdtempSync(join(tmpdir(), 'aux-root-'));
    try {
      mkdirSync(join(at, 'telegram-test'));
      const out = await probe({ at: join(at, 'telegram-test') });
      const hit = (out.instances ?? []).find((e) => e.stateDir === join(at, 'telegram-test'));
      expect(hit).toBeDefined();
      expect(hit!.kind).toBe('test');                       // ★종전엔 'prod' 로 등록됐다
      expect(hit!.name).toBe('test:telegram-test');         //  이름 축과 일치
      expect(hit!.repoPath).toBeUndefined();                //  repoPath 는 repo 관례에만 붙는다
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  }, 90_000);
});

describe('encodeInstanceNameSegment — 가역성 (무인 리뷰 must-fix)', () => {
  it('손실 치환이면 충돌할 두 이름을 실제로 가른다', () => {
    const a = instanceNameForStateDir('/tmp/monad-drive-A_B/state');
    const b = instanceNameForStateDir('/tmp/monad-drive-A-B/state');
    expect(a).not.toBe(b);
  });
  it('정확한 인코딩 결과를 고정한다 (문자 집합 확인만으로는 잘못된 인코딩도 통과한다)', () => {
    // `_` = U+005F → `-00005f`
    expect(encodeInstanceNameSegment('monad-drive-A_B')).toBe('-monad--drive--A-00005fB');
    // `-` 는 `--`. 두 입력이 같은 출력을 낼 수 없다.
    expect(encodeInstanceNameSegment('monad-drive-A-B')).toBe('monad-drive-A-B');
  });
  it('비-BMP 도 단사다 (6자리 고정폭)', () => {
    // U+10000 vs U+1000 + '0' — 4자리 폭이면 둘 다 `--10000` 으로 접힌다.
    expect(encodeInstanceNameSegment('\u{10000}')).toBe('--010000');
    expect(encodeInstanceNameSegment('\u{1000}0')).toBe('--0010000');
    expect(encodeInstanceNameSegment('\u{10000}')).not.toBe(encodeInstanceNameSegment('\u{1000}0'));
  });
  it('허용 문자만 있는 이름은 그대로 둔다 (무회귀)', () => {
    expect(encodeInstanceNameSegment('monad-drive-PGfXzo')).toBe('monad-drive-PGfXzo');
    expect(encodeInstanceNameSegment('abc123')).toBe('abc123');
  });
  it('출력은 영숫자와 하이픈만이다', () => {
    for (const raw of ['monad-drive-A_B', 'monad-drive-한글', 'monad-drive-a b', 'monad-drive-x.y']) {
      expect(encodeInstanceNameSegment(raw)).toMatch(/^[A-Za-z0-9-]+$/);
    }
  });
});
