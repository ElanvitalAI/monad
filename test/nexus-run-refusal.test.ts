// ── P4 거부 게이트 (DESIGN §6) ───────────────────────────────────────────────
//
// ⚠️ 이 게이트의 오판은 **비대칭**이다. launchd `com.monad.nexus` 는 KeepAlive 로 재기동하므로
// 잘못 거부하면 운영 데몬이 **크래시 루프로 내려앉는다.** 그래서 아래 테스트의 절반은
// "거부하는가"가 아니라 **"거부하지 않는가"** 를 고정한다 — 그쪽이 위험한 방향이기 때문이다.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { decideNexusRunRefusal, renderNexusRunRefusal, evaluateNexusRunRefusal } from '../src/instance/nexus-run-refusal';
import { readLeaderRefusal, type LeaderRefusalRecord } from '../src/instance/leader';
import { renderLeaderStatus } from '../src/cli/leader-cli';

const HOME_ROOT = '/Users/x/.monad';
const LEADER = '/Users/x/source/leader/monad-agent';
const OTHER = '/Users/x/source/axon/monad-agent';
const TEST_ROOT = '/Users/x/source/axon/monad-agent/.monad-test';

const base = { selfTree: OTHER, leaderTree: LEADER, root: HOME_ROOT, homeRoot: HOME_ROOT, depth: 0 };

// ⭐ 파일 **전체 범위**의 운영 무접촉 가드 (리뷰 must-fix #5492 2R) — 종전엔 한 테스트 안의 두 호출
//    전후만 비교해서, **다른 테스트가 오염시켜도** before===after 로 통과했다. 여기서 스냅샷을 잡고
//    afterAll 에서 대조하면 이 파일의 **어떤** 테스트가 실 파일을 건드려도 잡힌다.
//    (실증: 파괴적 테스트를 재도입하는 뮤테이션에서 정확히 이 가드가 실패한다.)
const REAL_REFUSAL = join(homedir(), '.monad', 'leader-refusal.json');
const REAL_LEADER = join(homedir(), '.monad', 'leader.json');
const snap = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf-8') : null);
let refusalAtStart: string | null = null;
let leaderAtStart: string | null = null;

// ⚠️ 한계(리뷰 should-fix 3R · 숨기지 않는다): ①테스트가 오염 후 **복원**하면 못 잡는다
//    ②러너 병렬화나 실행 중인 데몬의 정상 쓰기와 경합하면 오탐이 날 수 있다. 그래도 두는 이유는
//    이 파일에서 실제로 오염이 **일어났었기** 때문이고, 오탐은 조사로 이어져 해가 적기 때문이다.
//    근본 차단은 각 케이스가 seam 을 주입하는 쪽(위 테스트들)이고 이건 마지막 그물이다.
beforeAll(() => { refusalAtStart = snap(REAL_REFUSAL); leaderAtStart = snap(REAL_LEADER); });
afterAll(() => {
  // 실패하면 "이 파일의 테스트 중 하나가 운영을 건드렸다"는 뜻이다.
  expect(snap(REAL_REFUSAL)).toBe(refusalAtStart);
  expect(snap(REAL_LEADER)).toBe(leaderAtStart);
});

describe('decideNexusRunRefusal — 좁게 거부', () => {
  test('① 비-리더 트리 + 운영 뿌리 + depth 0 → 거부', () => {
    const d = decideNexusRunRefusal(base);
    expect(d.refuse).toBe(true);
    expect(d.why).toContain('비-리더');
  });

  test('② 비-리더 트리 + **테스트 뿌리** → 통과 (--test 는 막지 않는다)', () => {
    const d = decideNexusRunRefusal({ ...base, root: TEST_ROOT });
    expect(d.refuse).toBe(false);
    expect(d.observeAllowed).toBe(true);   // 아슬아슬한 통과라 관측은 남긴다
  });

  test('③ 리더 트리 + 운영 뿌리 → 통과', () => {
    const d = decideNexusRunRefusal({ ...base, selfTree: LEADER });
    expect(d.refuse).toBe(false);
    expect(d.observeAllowed).toBe(false);   // 평범한 정상 기동 — 노이즈 안 만든다
  });

  test('④ ⭐ 권위 판정 불가(leaderTree=null) → **통과**(fail-open 불변식)', () => {
    // 여기서 거부하면 leader.json 이 없는 머신의 운영 데몬이 KeepAlive 크래시 루프에 빠진다.
    const d = decideNexusRunRefusal({ ...base, leaderTree: null });
    expect(d.refuse).toBe(false);
    expect(d.observeAllowed).toBe(true);
  });

  test('⑤ 중첩(depth>0) + 운영 뿌리 → 거부 (액자 안에서 운영 접수 금지)', () => {
    const d = decideNexusRunRefusal({ ...base, selfTree: LEADER, depth: 2 });
    expect(d.refuse).toBe(true);
    expect(d.why).toContain('중첩');
  });

  test('⑥ 중첩(depth>0) + **테스트 뿌리** → 통과 (워크트리 PTY 자식을 죽이지 않는다)', () => {
    expect(decideNexusRunRefusal({ ...base, root: TEST_ROOT, depth: 3 }).refuse).toBe(false);
    expect(decideNexusRunRefusal({ ...base, selfTree: LEADER, root: TEST_ROOT, depth: 3 }).refuse).toBe(false);
  });

  test('경로 표기 차이(후행 슬래시)로 리더를 비-리더로 오판하지 않는다', () => {
    const d = decideNexusRunRefusal({ ...base, selfTree: `${LEADER}/`, root: `${HOME_ROOT}/` });
    expect(d.refuse).toBe(false);
  });
});

describe('renderNexusRunRefusal — 안내', () => {
  test('비-리더 거부는 claim 과 nexus install 을 함께 안내한다', () => {
    const out = renderNexusRunRefusal(base, decideNexusRunRefusal(base));
    expect(out).toContain('monad leader claim --yes');
    expect(out).toContain('monad nexus install');
    expect(out).toContain('--test');
    expect(out).toContain(LEADER);
  });

  test('중첩 거부는 claim 이 아니라 --test 를 안내한다(원인이 다르므로)', () => {
    const input = { ...base, selfTree: LEADER, depth: 2 };
    const out = renderNexusRunRefusal(input, decideNexusRunRefusal(input));
    expect(out).toContain('--test');
    expect(out).not.toContain('monad leader claim');
  });
});

describe('evaluateNexusRunRefusal — 기록·관측 껍질', () => {
  test('⑦ 거부 시 사유를 기록하고 관측한다 (완화 ②)', () => {
    const events: string[] = [];
    let written: LeaderRefusalRecord | null = null;
    const out = evaluateNexusRunRefusal({
      ...base, now: () => '2026-07-26T00:00:00.000Z',
      write: (r) => { written = r; }, clear: () => { events.push('clear'); },
      log: (e) => { events.push(e); },
    });
    expect(out).toBeTruthy();
    expect(events).toEqual(['nexus-run-refused']);
    expect(written).not.toBeNull();
    expect(written!.why).toContain('비-리더');
    expect(written!.selfTree).toBe(OTHER);
    expect(written!.leaderTree).toBe(LEADER);
  });

  test('통과 시 스테일 거부 기록을 지운다(과거를 현재로 오인시키지 않게)', () => {
    const events: string[] = [];
    const out = evaluateNexusRunRefusal({
      ...base, selfTree: LEADER,
      write: () => { events.push('write'); }, clear: () => { events.push('clear'); },
      log: (e) => { events.push(e); },
    });
    expect(out).toBeNull();
    expect(events).toEqual(['clear']);        // write 없음 · 평범한 통과라 관측도 없음
  });

  test('아슬아슬한 통과는 관측을 남긴다 — "왜 안 막았나"가 진단의 핵심', () => {
    const events: string[] = [];
    evaluateNexusRunRefusal({ ...base, root: TEST_ROOT, clear: () => {}, log: (e) => { events.push(e); } });
    expect(events).toEqual(['nexus-run-allowed-nonleader']);
  });

  test('⭐ 게이트가 예외를 던져도 통과시킨다 — 게이트 버그가 데몬을 못 뜨게 하면 안 된다', () => {
    const events: string[] = [];
    const out = evaluateNexusRunRefusal({
      ...base,
      write: () => { throw new Error('디스크 폭발'); },
      log: (e) => { events.push(e); },
    });
    // write 가 던져도 안내를 반환하지 않고(=거부를 강행하지 않고) 통과로 흡수한다.
    expect(out).toBeNull();
    expect(events).toContain('nexus-run-gate-error');
  });

  // ⛔ 삭제됨(리뷰 must-fix #5492) — 종전 이 자리에 `writeLeaderRefusal` 실구현을 호출하는 테스트가
  //    있었고, 그건 HOME 을 격리하지 않아 **실제 `~/.monad/leader-refusal.json` 을 가짜 레코드로
  //    덮어썼다**(실측 확인 후 삭제). "운영 무접촉" 주장과 정면으로 모순되는 파괴적 테스트였다.
  //    fail-soft 성질은 위 '게이트가 예외를 던져도 통과' 케이스가 seam 주입으로 이미 덮는다.
});

describe('leader status — 최근 거부 표시 (완화 ②)', () => {
  const axes = {
    authority: LEADER, bunLink: LEADER, launchd: LEADER, running: null, self: OTHER,
    coherent: true, drift: [], unresolved: [],
  };

  test('⑧ 거부 기록이 있으면 status 가 사유를 보여준다', () => {
    const out = renderLeaderStatus(axes, null, {
      refusedAt: '2026-07-26T00:00:00.000Z', selfTree: OTHER, leaderTree: LEADER,
      root: HOME_ROOT, depth: 0, why: '비-리더 트리의 운영 데몬 접수 금지',
    });
    expect(out).toContain('최근 거부');
    expect(out).toContain('비-리더 트리의 운영 데몬 접수 금지');
    expect(out).toContain(OTHER);
  });

  test('거부 기록이 없으면 그 섹션이 아예 안 나온다(무회귀)', () => {
    expect(renderLeaderStatus(axes, null)).not.toContain('최근 거부');
  });
});

// ── CLI 배선 (must-fix #5492: 주입 기반 단위 판정만으로는 실 wiring 을 입증 못 한다) ──────────
describe('ratchet — nexus run 액션이 게이트를 실제로 통과시킨다', () => {
  const INDEX = 'src/index.ts';

  /** `nexus run` 액션 본문에서 게이트 호출과 exit 배선을 확인. 주석은 걷어낸다. */
  function nexusRunActionSource(): string {
    const src = readFileSync(INDEX, 'utf-8');
    const anchor = src.indexOf("nexusCmd\n  .command('run'");
    expect(anchor).toBeGreaterThan(-1);   // 앵커가 사라지면 가드가 죽으므로 먼저 고정
    // 다음 nexusCmd 선언 전까지가 이 액션의 범위(넉넉히 자른다).
    const next = src.indexOf('\nnexusCmd', anchor + 20);
    const block = src.slice(anchor, next > 0 ? next : anchor + 40000);
    return block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  test('★ 게이트를 호출하고 **그 결과로** exit 1 한다(같은 분기여야 함)', () => {
    const body = nexusRunActionSource();
    // ⚠️ `process.exit(1)` 이 액션 어딘가에 있기만 하면 통과하는 느슨한 단정은 Goodhart 다
    //    (실측: exit 를 지우는 뮤테이션이 그대로 통과했다). 호출→검사→exit 를 **한 덩어리로** 고정한다.
    expect(body).toMatch(
      /const\s+(\w+)\s*=\s*evaluateNexusRunRefusal\(\s*\)\s*;\s*if\s*\(\s*\1\s*\)\s*\{[^}]*process\.exit\(1\)/,
    );
  });

  test('★ 게이트가 `opts.test` 분기보다 **앞**에 있다 — 격리 기동도 같은 판정을 통과해야 한다', () => {
    const body = nexusRunActionSource();
    const gate = body.indexOf('evaluateNexusRunRefusal');
    const testBranch = body.indexOf('if (opts.test)');
    expect(gate).toBeGreaterThan(-1);
    expect(testBranch).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(testBranch);
  });
});

describe('라우팅 — 전역 --test 는 게이트보다 먼저 뿌리를 전환한다', () => {
  test('★ 실측: `--test` 가 실제로 해석 뿌리를 운영 밖으로 옮긴다 (subprocess)', () => {
    // ⚠️ must-fix(2R): 종전 가드는 `applyTestFlagFromArgv` 가 함수인지만 보고 **수동 TEST_ROOT** 로
    //    판정해, "parse 전 뿌리 전환"을 전혀 입증하지 못했다(Goodhart). 실제 CLI 를 띄워 측정한다.
    //    프로세스 전역 상태를 바꾸는 in-process 호출 대신 subprocess 라 이 러너를 오염시키지 않는다.
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const run = (args: string[]): { kind?: string; root?: string } => {
      const out = execFileSync('bun', ['bin/monad.mjs', 'where', '--json', ...args], {
        encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'ignore'],
        // ⚠️ should-fix(3R): 인스턴스 뿌리에 영향을 주는 env 를 **명시적으로 비운다** — 개발자 셸이나
        //    CI 가 이미 격리를 켜둔 상태면 `prod.root === ~/.monad` 단정이 환경 따라 깨진다.
        env: { ...process.env, MONAD_STATE_DIR: undefined, MONAD_CONFIG_DIR: undefined, MONAD_TEST_STATE_DIR: undefined } as NodeJS.ProcessEnv,
      });
      return JSON.parse(out.slice(out.indexOf('{')));
    };
    // ⚠️ 운영 기준선은 **명시 플래그(1층)** 로 잡는다(2026-07-27) — 3층 스위치가 켜지면 "명시 없는
    //    호출"은 비-리더 트리에서 test 로 파생되므로, 그걸 운영 기준선으로 쓰면 이 테스트가
    //    **머신 설정에 의존**한다(실제로 스위치를 켜자 깨졌다). 명시는 3층보다 항상 우선이다.
    const prodRoot = join(homedir(), '.monad');
    const prod = run([`--config-dir=${prodRoot}`]);
    const isolated = run(['--test']);
    expect(prod.kind).toBe('prod');
    expect(prod.root).toBe(prodRoot);                        // 명시 운영 뿌리
    expect(isolated.kind).toBe('test');
    expect(isolated.root).not.toBe(prod.root);               // --test 는 다른 뿌리
    expect(isolated.root).toContain('.monad-test');

    // ⇒ 게이트가 볼 때 root 가 이미 격리이므로, 그 입력으로는 어떤 깊이여도 거부되지 않는다.
    for (const depth of [0, 1, 7]) {
      const d = decideNexusRunRefusal({ ...base, root: isolated.root!, homeRoot: prod.root!, depth });
      expect(d.refuse).toBe(false);
      expect(d.normalOperation).toBe(false);   // 격리 기동은 "정상 운영 접수"가 아니다
    }
  }, 120_000);

  test('★ 격리 기동은 거부 기록을 지우지 않는다 — 운영 실패 단서를 --test 한 번에 잃지 않게', () => {
    const events: string[] = [];
    evaluateNexusRunRefusal({
      ...base, root: TEST_ROOT,
      write: () => { events.push('write'); }, clear: () => { events.push('clear'); },
      log: (e) => { events.push(e); },
    });
    expect(events).not.toContain('clear');
  });

  test('권위 없음/판정 불가로 통과한 경우도 기록을 지우지 않는다', () => {
    const events: string[] = [];
    evaluateNexusRunRefusal({
      ...base, leaderTree: null,
      write: () => {}, clear: () => { events.push('clear'); }, log: (e) => { events.push(e); },
    });
    expect(events).not.toContain('clear');
  });
});

// ⭐ E2E — 격리 HOME 에서 실제 CLI 를 띄워 **거부와 exit code** 를 입증한다 (should-fix 3R).
//   소스 정규식 ratchet 은 "배선이 있다"만 보장하고 **도달 가능성·종료 코드**를 못 본다.
//   격리 HOME 에 `leader.json`(다른 트리)을 심으면 반드시 거부되므로 **데몬이 뜨지 않는다** = 안전.
describe('E2E — 격리 HOME 에서 nexus run 이 실제로 거부되고 exit 1', () => {
  test('★ 비-리더로 판정되면 거부 메시지 + 종료코드 1', () => {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const home = mkdtempSync(join(tmpdir(), 'p4-e2e-home-'));
    try {
      const monadDir = join(home, '.monad');
      require('node:fs').mkdirSync(monadDir, { recursive: true });
      // 권위를 **존재하지 않는 다른 트리**로 지정 → 이 트리는 확실히 비-리더 → 거부.
      writeFileSync(join(monadDir, 'leader.json'), JSON.stringify({
        tree: join(home, 'some-other-tree'), promotedAt: '2026-07-26T00:00:00.000Z',
      }));

      let status = 0;
      let stderr = '';
      try {
        execFileSync('bun', ['bin/monad.mjs', 'nexus', 'run'], {
          encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, HOME: home, MONAD_STATE_DIR: undefined, MONAD_CONFIG_DIR: undefined, MONAD_NEST_DEPTH: undefined } as NodeJS.ProcessEnv,
        });
      } catch (e) {
        const err = e as { status?: number; stderr?: string };
        status = err.status ?? -1;
        stderr = err.stderr ?? '';
      }

      expect(status).toBe(1);                                   // ← 실제 종료 코드
      expect(stderr).toContain('운영 데몬 기동 거부');
      expect(stderr).toContain('monad leader claim');

      // 완화 ② — 거부 사유가 격리 HOME 에 기록됐다(실 HOME 이 아니라).
      const rec = readLeaderRefusal(join(monadDir, 'leader-refusal.json'));
      expect(rec?.why).toContain('비-리더');
    } finally { rmSync(home, { recursive: true, force: true }); }
  }, 180_000);
});

describe('readLeaderRefusal — 전체 스키마 검증 (must-fix #5492)', () => {
  // ⚠️ **경로를 인자로 주입**한다(2R must-fix) — 종전엔 `spyOn(leaderRefusalFilePath)` 에 기댔는데,
  //    모듈 내부 lexical 호출은 스파이로 바뀌지 않아 조용히 실제 HOME 을 읽을 수 있었다.
  const full = { refusedAt: 'T', selfTree: 'a', leaderTree: 'b', root: 'c', depth: 0, why: 'w' };

  test('불완전·부적합 레코드는 null — status 에 undefined 를 찍지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p4-schema-'));
    try {
      const cases: Array<[string, unknown]> = [
        ['selfTree 누락', { ...full, selfTree: undefined }],
        ['root 누락', { ...full, root: undefined }],
        ['why 빈문자열', { ...full, why: '' }],
        ['depth 가 문자열', { ...full, depth: '0' }],
        ['leaderTree 가 숫자', { ...full, leaderTree: 1 }],
        ['depth 음수', { ...full, depth: -1 }],
        ['depth 소수', { ...full, depth: 1.5 }],
        ['최상위가 배열', []],
      ];
      cases.forEach(([label, bad], i) => {
        const p = join(dir, `bad-${i}.json`);
        writeFileSync(p, JSON.stringify(bad));
        expect(readLeaderRefusal(p), label).toBeNull();
      });

      // 완전한 레코드는 통과 · leaderTree 빈 문자열은 허용(권위 미지정 시)
      const okPath = join(dir, 'ok.json');
      writeFileSync(okPath, JSON.stringify({ ...full, leaderTree: '' }));
      expect(readLeaderRefusal(okPath)?.why).toBe('w');

      // 깨진 JSON·부재 파일도 던지지 않는다(진단 도구가 진단을 막으면 안 된다)
      const brokenPath = join(dir, 'broken.json');
      writeFileSync(brokenPath, '{not json');
      expect(readLeaderRefusal(brokenPath)).toBeNull();
      expect(readLeaderRefusal(join(dir, 'nope.json'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 🩸 09-26: 운영 plist 의 작업 폴더를 pilot → 홈으로 옮기자 설치본 데몬이 «비-리더 트리» 로 거부됐다(1분 반 중단).
describe('decideNexusRunRefusal — the installed copy is the operating body, not a tree', () => {
  const base = { selfTree: '/Users/u', leaderTree: '/Users/u/work/checkout', root: '/Users/u/.monad', homeRoot: '/Users/u/.monad', depth: 0 };
  test('installed copy at depth 0 starts even when its cwd is not the leader tree', () => {
    const d = decideNexusRunRefusal({ ...base, installedCopy: true });
    expect(d.refuse).toBe(false);
    expect(d.normalOperation).toBe(true);
  });
  test('a non-leader checkout is still refused, and nesting is refused even for the installed copy', () => {
    expect(decideNexusRunRefusal({ ...base, installedCopy: false }).refuse).toBe(true);
    expect(decideNexusRunRefusal({ ...base, installedCopy: true, depth: 1 }).refuse).toBe(true);
  });
});
