// ── 전역 `--test` 입구 (P2 · 2026-07-26) ───────────────────────────────────
//
// 발단(대표): *"굳이 ELANOUS_STATE_DIR 을 설정하지 않아도 `--test` 플래그 하나만 지정하면 되게끔
// 하는 게 좋을 것 같습니다. 일일이 지정하는 게 더 비효율적으로 느껴지네요."*
//
// 실측된 실상: 격리 기계는 **이미 완성돼 있었다**(`applyIsolatedRoot` — 두 축 동시 세팅 ·
// config 자동 물질화 · 루트 밖이면 기동 거부). 다만 트리거가 `--test-state-dir` 이라는
// **internal-only 플래그**(데몬 자식 전용)뿐이라 **사람이 부를 입구가 없었다.** 그래서
// `docs/`+`AGENTS.md` 에 `ELANOUS_STATE_DIR=` 47회 · `--config-dir` 127회가 화석으로 남았다.
//
// 이 모듈은 그 기계에 **공개 입구**를 낸다 — 새 기계를 만들지 않는다(재발명 0).
// 설계 = 내부 문서 `DESIGN-instance-leader-and-default-test-2026-07-26` §10 P2.
//
// ⚠️ **소유권 규칙**: `--test` 를 **이미 선언한 명령은 그 명령이 계속 소유**한다(동작 무변경).
// 나머지 전 명령은 전역 격리기가 가져간다. 이 경계가 필요한 이유 — 기존 5개 중 둘(`session
// compact`/`session watch`)은 `--test` 가 **다른 루트**(`~/.elanous/telegram-test`)를 뜻한다.
// 무성 의미변경은 관측 오독을 낳으므로 건드리지 않는다. 테이블 누락은 ratchet 테스트가 잡는다.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** `--test=<dir>` 값의 경로 정규화 — `~` 확장 + 상대경로 절대화.
 *  ⚠️ 값 문법은 `=` 형태 **하나**다(공백 형태는 서브커맨드와 구분 불가라 폐기). */
function normalizeExplicitDir(raw: string, cwd: string): string {
  const t = raw.trim();
  const expanded = t === '~' ? homedir() : t.startsWith('~/') ? join(homedir(), t.slice(2)) : t;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

/** `--test` 를 스스로 선언해 **직접 처리**하는 명령 경로들. 여기 있으면 전역 격리기가 손대지 않는다.
 *  ⚠️ 새 명령에 `.option('--test')` 를 달면 **여기에도 추가**해야 한다 — 안 그러면 전역 추출기가
 *  토큰을 먹어 그 명령이 플래그를 못 본다. `test/global-test-flag.test.ts` 의 ratchet 이 강제한다. */
export const OWNED_TEST_FLAG_PATHS: readonly (readonly string[])[] = [
  ['logs'],                 // 접두 매칭 — `logs timeline` 등 하위 전부를 함께 덮는다
  ['nexus', 'run'],         // pwa-test 가 포트/레이아웃까지 통째로 소유
  ['session', 'compact'],   // ⚠️ 다른 루트: ~/.elanous/telegram-test
  ['session', 'watch'],     // ⚠️ 다른 루트: ~/.elanous/telegram-test
];

export interface TestFlagResult {
  /** `--test` 토큰이 하나라도 있었나(전역·소유 합산). */
  found: boolean;
  /** ★ **전역으로 추출된** 토큰이 있었나 — 격리 적용 여부는 **이것**으로 판단한다.
   *  `elanous --test session watch --test` 처럼 전역·소유가 섞이면 앞의 것만 전역이다. */
  globalFound: boolean;
  /** 전역 토큰이 지정한 루트(`--test=<dir>`). 소유 토큰의 값에 오염되지 않는다. */
  globalExplicitDir: string | undefined;
  /** @deprecated `globalExplicitDir` 를 쓸 것. 전역 토큰 값과 동일하게 유지. */
  explicitDir: string | undefined;
  /** 전역 토큰만 제거된 argv. 소유 명령 뒤의 토큰은 보존된다. */
  argv: string[];
  /** 명령이 `--test` 를 소유하나(테이블 기준). 격리 적용 판단에 **직접 쓰지 말 것**. */
  ownedByCommand: boolean;
}

/** 소유 판정용 명령 경로 — **argv[2] 에 앵커**한다(첫 위치가 곧 명령).
 *
 *  ⚠️ 이전 판본은 "테이블 첫 세그먼트가 argv 어디서든 처음 나오는 위치"를 잡았는데,
 *  `config get logs --test` 를 `['logs']` 소유로 **오판**했다. 소유로 오판하면 전역 격리기가
 *  손을 떼고 → 그 명령이 **격리 없이 운영으로 흐른다**. 즉 오판의 대가가 비대칭이다:
 *    · 소유인데 비-소유로 판정 → 격리가 걸린다(요청한 방향·안전)
 *    · 비-소유인데 소유로 판정 → **운영 오염**(위험)
 *  그래서 모호하면 **비-소유로 떨어뜨린다**(fail-safe).
 *
 *  argv[2] 가 플래그면(선행 전역 옵션) 명령 위치를 확정할 수 없으므로 `[]` = 비-소유.
 *  실무상 이 CLI 의 pre-Commander 전역 플래그(`--config-dir`·`--test-state-dir`)는 이 시점에
 *  **이미 argv 에서 제거**돼 있어 argv[2] 는 사실상 항상 명령이다. */
export function commandPath(argv: readonly string[]): string[] {
  const rest = argv.slice(2);
  // 선행 전역 옵션은 건너뛴다 — `elanous --verbose session watch --test` 에서도 소유 명령을
  // 잃지 않게. **값을 받는 전역 플래그는 그 값까지** 함께 건너뛴다(아래 집합) — 안 그러면
  // 값이 명령으로 오인돼 유효한 소유 명령이 비-소유로 떨어진다(동작 무변경 계약 위반).
  // 이 CLI 의 pre-Commander 전역 플래그는 이 시점에 보통 이미 제거돼 있으나, 방어적으로 둔다.
  const VALUE_TAKING = new Set(['--config-dir', '--test-state-dir']);
  let i = 0;
  while (i < rest.length && rest[i]!.startsWith('-')) {
    const tok = rest[i]!;
    i += 1;
    if (VALUE_TAKING.has(tok) && i < rest.length && !rest[i]!.startsWith('-')) i += 1;
  }
  const out: string[] = [];
  for (const tok of rest.slice(i)) {
    if (tok.startsWith('-')) break;
    out.push(tok);
  }
  return out;
}

/** 이 argv 의 명령이 `--test` 를 스스로 소유하나. 테이블 항목의 **접두 일치**로 판정 —
 *  `['logs']` 는 `logs --test` 를, `['logs','timeline']` 은 그 하위를 각각 덮는다. */
export function commandOwnsTestFlag(
  argv: readonly string[],
  table: readonly (readonly string[])[] = OWNED_TEST_FLAG_PATHS,
): boolean {
  const path = commandPath(argv);
  const matches = table.some((owned) => owned.length <= path.length && owned.every((seg, i) => path[i] === seg));
  if (!matches) return false;
  // ⚠️ `elanous --test session watch` — 플래그가 명령 **앞**에 있으면 그건 전역 플래그다.
  //    소유로 보고 남겨두면 루트의 `--test` 선언이 `session` 을 값으로 삼켜 격리도 명령도 깨진다.
  //    소유 판정은 **플래그가 명령 뒤에 올 때만** 성립한다.
  const rest = argv.slice(2);
  const cmdStart = rest.findIndex((t) => t === path[0]);
  const flagAt = rest.findIndex((t) => t === '--test' || t.startsWith('--test='));
  return flagAt < 0 || (cmdStart >= 0 && flagAt > cmdStart);
}

/** 순수 추출기 — `--config-dir`/`--test-state-dir` 와 동형. 소유 명령이면 토큰을 남긴다. */
export function extractTestFlag(
  argv: readonly string[],
  table: readonly (readonly string[])[] = OWNED_TEST_FLAG_PATHS,
): TestFlagResult {
  // ⚠️ argv 전체를 하나의 owned 로 처리하면 `elanous --test session watch --test` 에서 둘 다
  //    제거돼 기존 명령의 `--test` 의미가 깨진다. **토큰 위치별로** 판정한다:
  //    명령 시작 이전 = 전역(추출) · 이후 = 소유 명령이면 보존.
  const path = commandPath(argv);
  const ownedCmd = path.length > 0 && table.some((o) => o.length <= path.length && o.every((seg, k) => path[k] === seg));
  const cmdStartAbs = path.length > 0 ? argv.indexOf(path[0]!, 2) : -1;
  const owned = ownedCmd;
  const out: string[] = [];
  let found = false;
  let globalFound = false;
  let globalExplicitDir: string | undefined;
  let i = 0;
  let afterDoubleDash = false;
  while (i < argv.length) {
    const tok = argv[i]!;
    // 표준 argv 경계 — `--` 이후는 명령의 리터럴 인자다. 건드리지 않는다.
    if (afterDoubleDash) { out.push(tok); i += 1; continue; }
    if (tok === '--') { afterDoubleDash = true; out.push(tok); i += 1; continue; }
    const eq = /^--test=(.*)$/.exec(tok);
    if (tok === '--test' || eq) {
      found = true;
      // 위치 판정: 명령 뒤에 있고 소유 명령이면 남긴다. 명령 앞이면 전역이므로 추출한다.
      const afterCmd = cmdStartAbs >= 0 && i > cmdStartAbs;
      if (owned && afterCmd) { out.push(tok); i += 1; continue; }
      // 여기 도달 = **전역 토큰**. 값도 전역 것만 취한다(소유 토큰 값에 오염되지 않게).
      globalFound = true;
      if (eq?.[1]?.trim()) globalExplicitDir = eq[1]!.trim();
      // ⚠️ 값 문법은 `--test=<dir>` **하나**. 공백 형태(`--test <dir>`)는 지원하지 않는다 —
      //    다음 토큰이 값인지 서브커맨드인지 구분할 방법이 없어 휴리스틱(경로꼴 판정)을 두면
      //    `--test iso` 같은 상대경로에서 선언 계약과 어긋난다(리뷰 지적). 모호함을 없앤다.
      i += 1;
      continue;
    }
    out.push(tok);
    i += 1;
  }
  return { found, globalFound, globalExplicitDir, explicitDir: globalExplicitDir, argv: out, ownedByCommand: owned };
}

// ── 소유권 테이블 정합 — **Commander 트리를 실제로 순회**한다 ─────────────────
//
// ⚠️ 종전엔 소스를 grep 해 선언 '개수' 를 세는 ratchet 이었다. 그건 주석·help 텍스트까지 세고
// multiline/`addOption`/다른 따옴표를 놓치는 **Goodhart 테스트**였다(self review 3회 지적).
// 텍스트 대신 **선언된 실물**을 본다: 트리를 걸어 `--test` 를 선언한 명령 경로를 모으고
// 테이블과 대조한다. 새 명령이 `--test` 를 달고 테이블을 잊으면 전역 추출기가 토큰을 먹어
// 그 명령이 플래그를 **조용히 못 보게** 되는데, 그것을 부팅 시점에 시끄럽게 만든다.

interface CommandLike {
  name(): string;
  options?: { long?: string | null }[];
  commands?: CommandLike[];
}

/** `--test` 를 선언한 모든 서브커맨드 경로(루트 제외·정렬). 순수 — 주입된 트리만 본다. */
export function declaredTestFlagPaths(root: CommandLike): string[][] {
  const found: string[][] = [];
  const walk = (cmd: CommandLike, path: string[]): void => {
    const declares = (cmd.options ?? []).some((o) => o.long === '--test');
    if (declares && path.length > 0) found.push([...path]);
    for (const child of cmd.commands ?? []) walk(child, [...path, child.name()]);
  };
  walk(root, []);
  return found.sort((a, b) => a.join(' ').localeCompare(b.join(' ')));
}

/** 선언된 경로가 전부 테이블에 덮이나(접두 매칭). 안 덮인 경로 목록을 돌려준다. */
export function uncoveredTestFlagPaths(
  root: CommandLike,
  table: readonly (readonly string[])[] = OWNED_TEST_FLAG_PATHS,
): string[][] {
  return declaredTestFlagPaths(root).filter(
    (p) => !table.some((owned) => owned.length <= p.length && owned.every((seg, i) => p[i] === seg)),
  );
}

/** **역방향** — 테이블에 있으나 실제로는 `--test` 를 선언하지 않는 stale 항목.
 *  이쪽이 더 위험하다: 소유자가 없는데 소유로 판정하면 전역 격리기가 손을 떼고
 *  그 명령이 **격리 없이 운영으로 흐른다**. 정방향(누락)은 명령이 플래그를 못 보는 데 그친다. */
export function staleTestFlagPaths(
  root: CommandLike,
  table: readonly (readonly string[])[] = OWNED_TEST_FLAG_PATHS,
): string[][] {
  // ⚠️ 접두 매칭으로 판정하면 **부모 선언이 삭제되고 자식만 남은** 경우를 놓친다
  //    (테이블 `['logs']` · 실제 선언은 `logs timeline` 뿐 → `logs --test` 는 소유자가 없는데
  //     소유로 판정돼 격리를 건너뛴다). 테이블 항목마다 **정확히 그 경로**의 선언을 요구한다.
  const declared = declaredTestFlagPaths(root).map((d) => d.join('\u0000'));
  return table.filter((owned) => !declared.includes(owned.join('\u0000'))).map((p) => [...p]);
}

/** 부팅 관측 — 테이블 누락을 시끄럽게. **런타임에서 수복하지 않는다**:
 *  추출은 parse 보다 앞서 일어나 이미 토큰(과 `=<dir>` 값)이 사라진 뒤라, 여기서 bare `--test`
 *  를 되붙이는 것은 원래 의미를 복구하지 못하는 **거짓 계약**이다(self review 지적).
 *  대신 **CI 가 차단**한다 — `ELANOUS_TEST_FLAG_AUDIT=1` 로 실 트리를 감사하는 테스트가 있다. */
export function observeTestFlagOwnership(root: CommandLike): string[][] {
  const missing = uncoveredTestFlagPaths(root);
  if (missing.length > 0) {
    const list = missing.map((p) => p.join(' ')).join(', ');
    try {
      const { debug } = require('../debug/log.js') as typeof import('../debug/log.js');
      debug.log('instance.identity', 'test-flag-ownership-gap', {
        missing: missing.map((p) => p.join(' ')),
        why: '`--test` 를 선언했으나 OWNED_TEST_FLAG_PATHS 에 없음 — 전역 추출기가 토큰을 먹어 이 명령이 플래그를 못 본다',
      });
    } catch { /* 관측 실패가 부팅을 막지 않는다 */ }
    try { process.stderr.write(`[--test] ⚠️ 소유권 테이블 누락: ${list} — src/cli/test-flag.ts 의 OWNED_TEST_FLAG_PATHS 에 추가하세요\n`); } catch { /* */ }
  }
  return missing;
}

/** cwd 에서 위로 걸어 `.git` 보유 트리를 찾는다. **`.git` 이 파일이어도 잡힌다** →
 *  git worktree 안에서 실행하면 그 worktree 전용 격리 인스턴스가 된다(병렬 self-dev 충돌 0). */
export function findTreeRoot(cwd: string): string | null {
  // ⚠️ 임의 깊이 제한을 두지 않는다 — 깊은 작업 트리에서 fail-closed 가 오발한다(리뷰 지적).
  //    파일시스템 루트(parent === dir)까지 올라가고 거기서 멈춘다.
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `--test` 가 가리킬 격리 루트. 명시 dir 우선, 아니면 `<트리>/.elanous-test`. */
export function resolveTestRoot(cwd: string, explicitDir?: string): string | null {
  if (explicitDir) return normalizeExplicitDir(explicitDir, cwd);
  const root = findTreeRoot(cwd);
  return root ? join(root, '.elanous-test') : null;
}

/** `process.argv` 에서 전역 `--test` 를 처리한다. Commander 로드 **전**에 호출해야 한다
 *  ⚠️ **정확히는** — ESM 정적 import 는 본문보다 먼저 평가되므로 "모든 import 보다 먼저"는
 *  아니다. 이 호출이 보장하는 것은 **Commander 가 parse 하기 전 · 서브커맨드 모듈이 lazy
 *  import 되기 전**이고, 리졸버(`getElanousConfigDir`/`elanousStateRoot`)가 **호출 시점 읽기**라
 *  실제 소비는 전부 이 뒤에 일어난다. 만약 누군가 **정적 import 시점에** config 를 읽는 모듈을
 *  추가하면 이 보장이 깨진다 — 그때는 부트스트랩 구조(별도 진입 파일)로 올려야 한다.
 *
 *  소유 명령이면 아무것도 하지 않는다. 그 외에는 격리 루트를 해석해 `applyIsolatedRoot` 에 넘긴다.
 *  ⚠️ 레포 밖에서 `--test` 를 쓰면 **조용히 prod 로 흘리지 않고 거부**한다(fail-closed) —
 *  격리를 요청했는데 운영을 만지는 것이 이 트랙이 없애려는 실패 모드 그 자체다. */
/** 이번 프로세스에서 전역 `--test` 가 적용한 루트(없으면 undefined).
 *  `elanous where` 가 **1층(명시 플래그)** 과 2층(부모 스탬프)을 구분해 설명하기 위해 필요하다 —
 *  `applyIsolatedRoot` 가 `ELANOUS_STATE_DIR` 을 세팅하고 나면 그 뒤로는 둘이 구분되지 않는다. */
let appliedGlobalTestRoot: string | undefined;
export function getAppliedGlobalTestRoot(): string | undefined { return appliedGlobalTestRoot; }

export function applyTestFlagFromArgv(deps: {
  cwd?: string;
  apply?: (dir: string) => void;
  fail?: (msg: string) => never;
} = {}): string | undefined {
  const r = extractTestFlag(process.argv);
  appliedGlobalTestRoot = undefined;   // 동일 프로세스 재파싱 시 오래된 1층 결정을 보고하지 않게
  // ⚠️ `ownedByCommand` 로 조기 반환하면 `elanous --test session watch` 처럼 **명령 앞의 전역
  //    플래그**가 적용되지 않아 요청한 격리 없이 운영으로 흐른다(self review 지적).
  //    판단 기준은 **전역으로 추출된 토큰이 있었나**(globalFound) 다.
  if (!r.globalFound) return undefined;
  const cwd = deps.cwd ?? process.cwd();
  const root = resolveTestRoot(cwd, r.globalExplicitDir);
  const fail = deps.fail ?? ((msg: string): never => { console.error(msg); process.exit(1); });
  if (!root) {
    return fail(
      `[--test] 격리 루트를 정할 수 없습니다 — cwd(${cwd}) 위쪽에 git 트리가 없습니다.\n`
      + '  레포 안에서 실행하거나 --test=<dir> 로 루트를 직접 지정하세요.\n'
      + '  (요청한 격리를 보장할 수 없어 운영으로 흘리지 않고 중단합니다.)',
    );
  }
  process.argv = r.argv;
  const apply = deps.apply ?? ((dir: string) => {
    const m = require('./test-state-dir-flag.js') as typeof import('./test-state-dir-flag.js');
    m.applyIsolatedRoot(dir);
  });
  apply(root);
  appliedGlobalTestRoot = root;
  return root;
}
