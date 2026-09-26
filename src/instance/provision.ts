// ── 파생 우주 물질화 — 자식이 태어날 우주에 config 를 깔아준다 (2026-07-27) ────────
//
// 발단(실측): 3층(트리 파생 test) 스위치를 켠 뒤 **self-dev 가 한 건도 완주하지 못했다.**
// 자율 잡 2건이 각각 1200초를 태우고 `stage:aborted · 변경 none · 툴콜 0` 으로 죽었는데,
// 화면 버퍼에 남은 건 에러가 아니라 **provider 선택 마법사**였다.
//
// 사슬:
//   3층 ON → self-dev 자식이 워크트리 cwd 로 `<worktree>/.elanous-test` 파생
//          → 갓 만든 워크트리라 그 우주는 **비어 있다**(config.json 없음)
//          → `needsOnboarding(cfg)`(= !onboarding.completed) 참
//          → 헤드리스 PTY 자식이 **대화형 온보딩 마법사**를 띄우고 입력을 기다린다
//          → 툴콜 0 · 타임아웃 · aborted
//
// 스위치 전에는 자식이 `~/.elanous`(운영·provider 있음)로 떨어져 우연히 돌았다. 격리가
// 옳아진 순간 "격리된 우주에 아무것도 없다"는 사실이 드러난 것이다 — 격리의 대가는
// **프로비저닝**이고, 그걸 아무도 안 갚고 있었다.
//
// 해소: 자식을 spawn 하기 전에, 자식이 파생될 루트를 리졸버와 **같은 계산**으로 구해
// (`treeDerivedRootFor`) config 가 없으면 기존 `syncTestConfig` 로 물질화한다. 새 복사
// 로직을 만들지 않는다 — `elanous config sync-test` 가 쓰는 그 함수 그대로다(재발명 0).
// 물질화 산출물은 config.json + auth.json·llm-fallback.json·identity.json 부속이라
// provider 와 자격이 함께 간다.
//
// 안전: 물질화는 **테스트 우주로만** 간다. syncTestConfig 가 test-safe 변환(테스트 봇 토큰
// 스왑·discord OFF·report/home 제거)을 적용하므로 자식이 운영 채널로 말할 수 없다.

import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { runGitCommand } from '../git-fs/runner.js';
import { debug } from '../debug/log.js';
import { syncTestConfig } from '../cli/config-test-sync.js';
import { treeDerivedRootFor, treeDerivedTestEnabled } from './resolve.js';

// ⓘ 리뷰 반론(2026-07-27) — *"어디서도 import 하지 않으니 미사용 공개 표면"* 지적에 대해.
//   `ProvisionResult` 는 **export 된 함수의 반환 타입**이라 export 를 떼면 그 함수의 시그니처를
//   호출자가 이름으로 붙잡을 수 없고 선언 방출(declaration emit)이 private-name 으로 깨진다.
//   `ProvisionOutcome` 은 그 필드의 타입이라 같다. 즉 **소비처 유무와 무관하게 공개여야 하는 표면**이다.
//   (실제 소비도 있다 — 회귀 테스트가 outcome 6종을 이 유니온으로 단정한다.)
export type ProvisionOutcome =
  | 'explicit'        // 스포너가 우주를 명시했다 — 파생이 안 일어나므로 건드리지 않는다
  | 'switch-off'      // 3층 OFF — 자식은 운영/명시 우주로 간다. 할 일 없음
  | 'no-tree'         // cwd 위쪽에 git 트리 없음 — 파생 자체가 불가
  | 'already'         // 그 우주에 config 가 이미 있다
  | 'provisioned'     // 물질화했다
  | 'failed';         // 물질화 실패(자식은 그대로 진행 — fail-open)

export interface ProvisionResult {
  outcome: ProvisionOutcome;
  root: string | null;
  error?: string;
}

export interface ProvisionOpts {
  /** 스포너가 자식에게 명시로 넘기는 우주(`--config-dir` / `ELANOUS_STATE_DIR`).
   *  주어지면 자식은 **파생하지 않으므로** 파생 루트를 물질화하면 안 된다. */
  explicitRoot?: string | undefined;
}

/** ★ 자격 유출 차단(리뷰 must-fix · 2026-07-27) — 물질화는 워크트리 **안**에 `auth.json` 을 놓는다.
 *
 *  elanous 레포는 `.gitignore` 에 `/.elanous-test/` 가 있어 우연히 가려지지만 **외부 repo 개발
 *  경로엔 그 줄이 없다.** 그리고 self-build 자식은 스스로 커밋하는 에이전트다 — `git add -A`
 *  한 번이면 운영에서 복사해 온 자격이 남의 레포 히스토리에 박히고, 이후 push 로 나간다.
 *  부모의 `status` 호출에서만 숨기는 것(pathspec)은 **자식의 git 에는 아무 효력이 없다.**
 *
 *  ⇒ 우주 안에 자기 자신을 지우는 `.gitignore`(`*`)를 깐다. git 의 규칙상 그 디렉터리의
 *  **모든 것**(이 파일 포함)이 무시되므로 `git add -A`·`git status` 어느 쪽에도 안 잡힌다.
 *  디렉터리 안에 자족적으로 들어가니 남의 레포의 `.gitignore`·`.git/info/exclude` 를
 *  건드리지 않는다(우리 것이 아닌 파일을 고치지 않는다). 멱등이다.
 *
 *  ⚠️ **존재 확인으로는 부족하다**(3R 리뷰 must-fix) — 이미 `.gitignore` 가 있는데 `*` 가 없거나,
 *  `*` 뒤에 `!auth.json` 같은 되살림이 있으면 봉인이 아니다. git 은 **마지막에 매칭된 패턴**이
 *  이기므로, 유효 패턴의 **마지막 줄이 `*`** 인지까지 본다. 아니면 뒤에 붙인다(기존 내용 보존).
 *
 *  실패하면 false. 호출측은 그때 **자격을 놓지 않는다** — 스폰은 fail-open 이지만 자격 노출은
 *  fail-closed 다. */
function sealFromGit(root: string): boolean {
  try {
    mkdirSync(root, { recursive: true });
    const seal = join(root, '.gitignore');
    const cur = existsSync(seal) ? readFileSync(seal, 'utf-8') : '';
    const effective = cur.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (effective[effective.length - 1] === '*') return true;   // 이미 봉인됨(멱등)
    const header = cur
      ? cur.replace(/\n*$/, '\n')
      : '# elanous 파생 test 우주 — 이 디렉터리는 운영 자격(auth.json)을 담는다.\n'
        + '# 자율 자식이 `git add -A` 로 남의 레포에 자격을 커밋하는 것을 막는 봉인이다. 지우지 말 것.\n';
    writeFileSync(seal, `${header}*\n`);
    return true;
  } catch {
    return false;   // 호출측이 관측을 남기고 **자격 복사를 포기**한다
  }
}

/** 물질화가 놓는 파일 중 **자격**인 것. 봉인이 불가능할 때 격리 대상이다. */
const CREDENTIAL_FILES = ['auth.json'] as const;

/** ★ 봉인 불가 시 자격 격리(5R 리뷰 must-fix).
 *
 *  `already` 경로는 자격이 **이미** 거기 있다. 봉인에 실패했는데 스폰은 계속되므로(fail-open),
 *  아무것도 안 하면 미봉인 자격이 자식의 `git add -A` 에 그대로 노출된다. 스폰을 막을 수 없으니
 *  **자격을 치우는 것**이 유일하게 남은 레버다 — 자식은 인증에 실패하며 **읽히는 에러**로 죽고,
 *  그건 자격이 남의 레포에 박히는 것보다 낫다. 복구는 `elanous config sync-test` 한 줄이다. */
function quarantineCredentials(root: string): { removed: string[]; left: string[] } {
  const removed: string[] = [];
  const left: string[] = [];
  for (const f of CREDENTIAL_FILES) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    try { rmSync(p, { force: true }); removed.push(f); } catch { left.push(f); }
  }
  return { removed, left };
}

/** 파생 루트의 트리 루트 — `treeDerivedRootFor` 가 `<tree>/.elanous-test` 를 주므로 그 부모다.
 *  (cwd 는 트리 안 어디든 될 수 있어 그대로 쓰면 `git -C` 가 다른 하위 경로를 본다.) */
function treeOf(cwd: string, root: string): string {
  return dirname(root) || cwd;
}

/** ★ 봉인으로도 못 막는 두 상태(4R 리뷰 must-fix) — 여기 걸리면 **자격을 놓지 않는다**.
 *
 *  ① **이미 추적 중** — `.gitignore` 는 추적되지 않는 파일에만 효력이 있다. 외부 repo 가
 *     `.elanous-test/auth.json` 을 커밋해 둔 상태라면 우리가 그 위에 운영 자격을 덮어쓰고
 *     자식의 `git add -A` 에 그대로 실린다(봉인이 무력).
 *  ② **심볼릭 링크** — 파생 루트가 링크면 자격이 우리가 의도한 곳이 아닌 데로 나간다.
 *
 *  판정 불가(git 없음 등)는 안전 쪽으로 보지 않는다 — 링크가 아니고 추적 증거도 없으면 진행한다
 *  (여기서 fail-closed 로 가면 git 이 없는 환경에서 self-dev 가 통째로 멈춘다). */
function unsafeDerivedRoot(tree: string, root: string): string | null {
  try {
    if (lstatSync(root).isSymbolicLink()) return '파생 루트가 심볼릭 링크 — 자격이 의도치 않은 곳으로 나간다';
  } catch { /* 없으면 링크도 아니다 */ }
  try {
    const rel = relative(tree, root) || '.elanous-test';
    const r = runGitCommand(tree, ['ls-files', '--', rel], { encoding: 'utf8', timeout: 10_000 });
    if (r.status === 0 && r.stdout.trim()) {
      return `파생 루트가 이미 git 추적 중 — .gitignore 는 추적 파일에 효력이 없다(${r.stdout.trim().split('\n')[0]})`;
    }
  } catch { /* git 판정 불가 — 위 주석대로 진행 */ }
  return null;
}

/** 자식이 `cwd` 에서 파생할 test 우주에 config 를 물질화한다(없을 때만).
 *
 *  ⚠️ **자식이 실제로 쓸 루트에만 손댄다**(리뷰 must-fix). 리졸버는 명시 config/state 를
 *     3층보다 위에 두므로, 스포너가 우주를 명시했는데도 파생 루트를 물질화하면 자식이
 *     쓰지도 않을 디렉터리에 **자격(auth.json)까지 뿌리는** 꼴이 된다. 판정 우선순위를
 *     리졸버와 맞춘다.
 *
 *  fail-open — 무엇이 실패해도 던지지 않는다. 스폰을 막는 것보다 자식이 스스로 실패하며
 *  관측을 남기는 편이 낫다(부모가 자식의 우주 때문에 죽으면 안 된다). */
export function provisionDerivedUniverse(cwd: string, opts: ProvisionOpts = {}): ProvisionResult {
  let root: string | null = null;
  try {
    const explicit = opts.explicitRoot?.trim();
    if (explicit) {
      debug.log('instance.provision', 'explicit-root', {
        cwd, explicit, why: '스포너가 우주를 명시 — 파생이 없으므로 물질화 대상 아님(자격 확산 방지)',
      });
      return { outcome: 'explicit', root: explicit };
    }
    if (!treeDerivedTestEnabled()) {
      debug.log('instance.provision', 'switch-off', {
        cwd, why: '3층 OFF — 파생 우주 없음; 명시 우주도 없으면 자식이 상속된 운영 config-dir 범위에서 실행된다',
      });
      return { outcome: 'switch-off', root: null };
    }
    root = treeDerivedRootFor(cwd);
    if (!root) {
      debug.log('instance.provision', 'no-tree', {
        cwd, why: '3층 ON 이나 cwd 위쪽에 git 트리가 없어 자식 우주를 특정 못 함',
      });
      return { outcome: 'no-tree', root: null };
    }
    // ★ 봉인으로도 못 막는 상태를 **먼저** 걸러낸다(4R) — 추적 중이거나 링크면 어떤 봉인도 무의미하다.
    const unsafe = unsafeDerivedRoot(treeOf(cwd, root), root);
    if (unsafe) {
      debug.log('instance.provision', 'unsafe-root', {
        cwd, root, why: unsafe,
      }, { level: 'error' });
      return { outcome: 'failed', root, error: unsafe };
    }
    if (existsSync(join(root, 'config.json'))) {
      // 구버전(봉인 이전)이 깐 우주 — 자격이 **이미** 거기 있다. 소급 봉인이 유일한 방어다.
      if (!sealFromGit(root)) {
        // 스폰은 못 막는다(fail-open). 그러니 **자격을 치운다** — 노출보다 인증 실패가 낫다.
        const q = quarantineCredentials(root);
        const error = `기존 우주를 봉인하지 못해 자격을 격리했다(삭제 ${q.removed.length}·잔존 ${q.left.length})`
          + ' — 복구는 `elanous config sync-test <그 우주>`';
        debug.log('instance.provision', 'seal-failed', {
          cwd, root, error, removed: q.removed, left: q.left,
          why: '봉인 없이 두면 자식이 git add -A 로 이 우주를 커밋해 자격이 유출된다',
        }, { level: 'error' });
        return { outcome: 'failed', root, error };
      }
      return { outcome: 'already', root };
    }
    // ★★ 봉인이 **먼저**다(3R 리뷰 must-fix) — 복사 후에 봉인하면 그 사이에 실패했을 때
    //    자격만 남는다. 순서를 뒤집으면 "봉인 못 하면 자격을 아예 놓지 않는다"가 성립한다.
    //    스폰은 fail-open 이지만 **자격 노출은 fail-closed** 다.
    if (!sealFromGit(root)) {
      const error = '파생 우주를 봉인하지 못했다 — 자격을 놓지 않고 중단한다(유출 방지)';
      debug.log('instance.provision', 'seal-failed', {
        cwd, root, error, why: '봉인 없이 복사하면 자식의 git add -A 로 auth.json 이 유출된다',
      }, { level: 'error' });
      return { outcome: 'failed', root, error };
    }
    const r = syncTestConfig(root);
    debug.log('instance.provision', 'materialized', {
      cwd, root, copied: r.copied, skippedMissing: r.skippedMissing, telegramMode: r.telegramMode,
      why: '빈 파생 우주 — 물질화 없이는 자식이 온보딩 마법사에 걸려 타임아웃한다',
    });
    return { outcome: 'provisioned', root };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    debug.log('instance.provision', 'failed', {
      cwd, root, error, why: '물질화 실패 — 자식은 그대로 진행(fail-open)하나 온보딩에 걸릴 수 있다',
    }, { level: 'warn' });
    return { outcome: 'failed', root, error };
  }
}
