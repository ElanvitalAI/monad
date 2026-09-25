// ── 인스턴스 해석 4층 (P3 · 2026-07-26) ────────────────────────────────────
//
// 근본(설계 §2): **운영이 `MONAD_STATE_DIR` 의 _부재_ 로 표현된다.** 부재는 "운영이라고
// 결정했다"와 "아무도 결정 안 했다"를 **구분하지 못하므로**, 잊으면 운영으로 떨어진다 —
// 실패가 위험한 방향이다. 이 모듈은 그 결정을 **명시적으로** 만든다.
//
//   1. 명시 플래그      --test / --config-dir      (P2 가 이미 적용)
//   2. 부모 스탬프      env MONAD_STATE_DIR        (프로세스 트리 상속)
//   3. 트리 파생        리더 트리 ? prod : test    ← 신규(옵트인)
//   4. 기본             ~/.monad (prod)
//
// ⚠️ **3층은 기본 OFF 로 착지한다.** 켜면 비-리더 트리(axon 등)의 **모든 명령이 기본 test 로
// 뒤집힌다** — 의도된 최종 상태지만(설계 §4a·대표 결정) 운영 도그푸드 없이 무성으로 켜는 것은
// 이 트랙이 없애려는 "조용한 전환" 그 자체다. config `instance.treeDerivedTest` 로 켠다.
// `monad where` 가 켜지면 무엇이 달라지는지 미리 보여준다.
//
// 설계 = 내부 문서 `DESIGN-instance-leader-and-default-test-2026-07-26` §4b·§4d·§10 P3.

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LeaderAxes } from './leader.js';

// ⚠️ leader/nest-depth/user-config 는 **lazy require** 로 부른다 — 이 모듈을 `monadStateRoot`
//    와 `getMonadConfigDir` 이 소비하는데, 정적 import 로 묶으면
//    resolve → nest-depth → user-config → monad-config-dir → resolve 순환이 생긴다.
function lazyLeader(): typeof import('./leader.js') {
  return require('./leader.js') as typeof import('./leader.js');
}
function lazyDepth(): number {
  try { return (require('../agent/nest-depth.js') as typeof import('../agent/nest-depth.js')).getNestDepth(); }
  catch { return 0; }
}

export type InstanceKind = 'prod' | 'test';
/** 어느 층에서 결정됐나 — `monad where` 의 "왜" 를 설명하는 값. */
export type ResolutionLayer = 'explicit-flag' | 'parent-stamp' | 'tree-derived' | 'default';

export interface InstanceResolution {
  kind: InstanceKind;
  /** 결정된 뿌리(state·config 공통). */
  root: string;
  layer: ResolutionLayer;
  /** 사람이 읽는 결정 사유. */
  why: string;
  /** 3층이 켜져 있었다면 달라졌을 결과(현재 OFF 일 때만 채워진다 · 미리보기). */
  wouldBeIfTreeDerived?: { kind: InstanceKind; root: string; why: string };
}

export interface ResolveDeps {
  /** `--test`/`--test-state-dir` 이 이미 적용됐나(P2 · applyIsolatedRoot 가 env 를 세팅). */
  explicitFlagRoot?: string | undefined;
  /** 부모가 물려준 스탬프. */
  stampedStateDir?: string | undefined;
  /** 3층 활성 여부(config `instance.treeDerivedTest`). */
  treeDerivedEnabled?: boolean;
  axes?: LeaderAxes;
  depth?: number;
  prodRoot?: string;
  /** 트리 파생이 고를 테스트 루트(`<트리>/.monad-test`). */
  treeTestRoot?: string | null;
}

/** 4층 우선순위로 인스턴스를 해석한다(순수 — 주입된 값만 본다). */
/** 뿌리 비교용 정규화 — 후행 슬래시·상대경로 차이로 같은 prod 가 test 로 오분류되는 것을 막는다. */
export function normRoot(p: string): string {
  return resolve(p.trim().replace(/\/+$/, ''));
}

export function resolveInstance(deps: ResolveDeps = {}): InstanceResolution {
  const prodRoot = normRoot(deps.prodRoot ?? join(homedir(), '.monad'));
  const depth = deps.depth ?? lazyDepth();

  // 1층 — 명시 플래그. 사람이 직접 말한 것이 항상 이긴다.
  if (deps.explicitFlagRoot) {
    // ⚠️ 명시 루트라고 무조건 test 가 아니다 — `--config-dir ~/.monad` 처럼 **prod 를 명시**할
    //    수도 있다. 뿌리로 판정한다(정규화 비교).
    const root = normRoot(deps.explicitFlagRoot);
    return {
      kind: root === prodRoot ? 'prod' : 'test', root, layer: 'explicit-flag',
      why: '명시 플래그(--test/--test-state-dir/--config-dir)',
    };
  }

  // 2층 — 부모 스탬프. 프로세스 트리 전체가 한 우주에 머물게 한다.
  const stampRaw = deps.stampedStateDir?.trim();
  if (stampRaw) {
    const stamp = normRoot(stampRaw);
    return {
      kind: stamp === prodRoot ? 'prod' : 'test', root: stamp, layer: 'parent-stamp',
      why: `부모가 물려준 MONAD_STATE_DIR(depth ${depth})`,
    };
  }

  // 3층 — 트리 파생. 리더 트리에서 depth 0 으로 돌 때만 운영.
  const L = lazyLeader();
  const axes = deps.axes ?? L.observeLeaderAxes();
  const leader = L.isLeaderTree(axes);
  const treeTestRoot = deps.treeTestRoot ?? null;
  const derived = ((): { kind: InstanceKind; root: string; why: string } | null => {
    if (leader === null) return null;                       // 권위 미지정 → 추측하지 않는다
    if (leader && depth === 0) return { kind: 'prod', root: prodRoot, why: '리더 트리 · depth 0' };
    if (!treeTestRoot) return null;                          // 테스트 루트를 못 정하면 파생 포기
    return {
      kind: 'test', root: treeTestRoot,
      why: leader ? `리더 트리이나 depth ${depth}(중첩) — 명시 없으면 테스트` : '비-리더 트리 — 명시 없으면 테스트',
    };
  })();

  if (deps.treeDerivedEnabled && derived) {
    return { ...derived, layer: 'tree-derived' };
  }

  // 4층 — 기본. (3층이 꺼져 있으면 여기로 오고, 켰다면 무엇이 달라졌을지 미리보기를 붙인다.)
  return {
    kind: 'prod', root: prodRoot, layer: 'default',
    why: '기본값(~/.monad) — 명시도 스탬프도 없음',
    ...(derived && derived.root !== prodRoot ? { wouldBeIfTreeDerived: derived } : {}),
  };
}

/** §4d — config-dir 은 state-dir 을 따라간다.
 *
 *  `MONAD_STATE_DIR` 은 env 라 전 자손에 자동 전파되는데 config-dir 은 argv 재부착 **7곳**에서만
 *  전파된다. 그 7곳을 안 타는 자식은 `state=test / config=prod` 로 갈라진다(2026-07-19 미션 누출
 *  클래스). 명시 `--config-dir` 이 없으면 state-dir 을 따라가게 해 그 어긋남을 봉합한다.
 *
 *  ⚠️ 명시 override 가 있으면 손대지 않는다 — 사람이 직접 말한 것이 이긴다.
 *  ⚠️ **이 함수는 §4d 계약의 문서화·테스트용 순수 함수다.** 실제 해석 경로는
 *  `effectiveInstanceRoot()` 하나이며, `monadStateRoot`/`getMonadConfigDir` 이 그것을 공유한다. */
export function configDirFollowingStateDir(
  explicitConfigDir: string | undefined,
  stateDir: string | undefined,
  prodRoot = join(homedir(), '.monad'),
): { dir: string; followed: boolean } {
  if (explicitConfigDir) return { dir: explicitConfigDir, followed: false };
  const s = stateDir?.trim();
  if (s && normRoot(s) !== normRoot(prodRoot)) return { dir: normRoot(s), followed: true };
  return { dir: prodRoot, followed: false };
}


// ── 3층 실배선 — 스위치는 **고정 경로 raw 읽기** (순환 없음) ────────────────────
//
// 처음엔 `getUserConfig()` 로 스위치를 읽어 배선했다가 **런타임 재귀**를 만들었다:
//   getMonadConfigDir → resolver → getUserConfig → (config 경로 해석) → getMonadConfigDir → …
// 원인은 "config 를 읽는 것"이 아니라 **config 의 위치가 리졸버의 결과**라는 점이었다.
// ⇒ 스위치를 `~/.monad/config.json` **고정 경로에서 raw 로** 읽으면 순환이 사라진다.
//    이 스위치는 `leader.json` 과 같은 **머신 레벨 결정**이라 prod 홈에 사는 것이 일관적이다.
//
// ⚠️ 핫패스라 프로세스당 1회 **메모이즈**한다(리더 권위·트리 탐색이 fs 를 만진다).

let memoRoot: string | undefined;

/** 테스트 seam — 메모 무효화. */
export function resetEffectiveInstanceRoot(): void { memoRoot = undefined; }

/** 3층 스위치 오버라이드(테스트 전용).
 *
 * ⚠️ **왜 필요한가**: `treeDerivedTestEnabled()` 는 **개발자 머신의 `~/.monad/config.json` 을 직접
 * 읽는다**(순환 방지를 위해 의도적으로 config 기계를 우회). 그래서 이 리졸버를 거치는 **모든 테스트의
 * 결과가 그 파일에 좌우된다** — 스위치를 켠 머신에서는 *"양축 미설정 = 운영"* 을 단언하는 옛 테스트가
 * 전부 빨개지고, 끈 머신에서는 3층 경로가 **한 번도 안 돌아** 회귀가 안 잡힌다.
 * 실제로 P3 착지(#5479) 이후 이 저장소의 비-리더 체크아웃에서 7건이 계속 빨간 채였다.
 *
 * ⇒ 테스트가 **어느 우주를 시험하는지 스스로 선언**하게 한다. `undefined` 로 되돌리면 실제 머신
 * 설정을 다시 읽는다. 메모도 함께 무효화한다(스위치가 뿌리 계산의 입력이므로). */
let treeDerivedOverride: boolean | undefined;
export function setTreeDerivedTestForTesting(enabled: boolean | undefined): void {
  treeDerivedOverride = enabled;
  resetEffectiveInstanceRoot();
}

/** 3층 스위치 — 머신 레벨 `~/.monad/config.json` 의 `instance.treeDerivedTest`.
 *  **config 기계를 거치지 않는다**(순환 방지). 기본 false. */
export function treeDerivedTestEnabled(): boolean {
  if (treeDerivedOverride !== undefined) return treeDerivedOverride;
  try {
    const { readFileSync, existsSync } = require('node:fs') as typeof import('node:fs');
    const p = join(homedir(), '.monad', 'config.json');
    if (!existsSync(p)) return false;
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as { instance?: { treeDerivedTest?: boolean } };
    return raw?.instance?.treeDerivedTest === true;
  } catch { return false; }
}

/** state-dir·config-dir 이 공유하는 **실효 뿌리**. env 스탬프가 있으면 그것이 이긴다. */
/** ★ 운영 루트 SSOT — `~/.monad`(정규화).
 *
 *  ⚠️ 리뷰 should-fix(2026-07-27) — 이 계산이 리졸버·이름·로그싱크 **세 곳에 복제**돼 있었다.
 *     그건 이 트랙이 고친 결함(*"정체성 축이 둘"*)과 **같은 클래스**다: 운영 기본값이 언젠가
 *     바뀌면 복제본이 어긋나 축이 다시 갈린다. 한 곳에서만 계산한다. */
export function prodInstanceRoot(): string {
  return normRoot(join(homedir(), '.monad'));
}

/** 3층(트리 파생) 루트 계산 — `<git 트리 루트>/.monad-test`. 트리를 못 찾으면 null.
 *
 *  ⚠️ effectiveInstanceRoot 안에 인라인돼 있던 것을 **뽑아 SSOT 로 세운다**. 자식을 spawn 하는
 *     쪽(self-dev)은 "이 워크트리에서 자식이 어느 우주로 파생될까"를 미리 알아야 그 우주를
 *     물질화해줄 수 있는데, 그 계산을 따로 구현하면 리졸버와 드리프트한다(이 트랙의 근본과 같은 결함). */
export function treeDerivedRootFor(cwd: string): string | null {
  try {
    const { findTreeRoot } = require('../cli/test-flag.js') as typeof import('../cli/test-flag.js');
    const t = findTreeRoot(cwd);
    return t ? join(t, '.monad-test') : null;
  } catch {
    return null;   // 트리 해석 실패 — 호출측이 관측을 남기고 파생을 포기한다
  }
}

export function effectiveInstanceRoot(): string {
  // 1층 — 명시 `--config-dir` 도 공통 뿌리다. 이걸 config 축에만 반영하면 state 와 갈라진다.
  try {
    const { getMonadConfigDirOverride } = require('../monad-config-dir.js') as typeof import('../monad-config-dir.js');
    const ov = getMonadConfigDirOverride();
    if (ov) return normRoot(ov);
  } catch { /* 부팅 초기 등 — 아래 층으로 */ }
  const stamp = process.env.MONAD_STATE_DIR?.trim();
  if (stamp) return normRoot(stamp);          // 2층 — 메모하지 않는다(env 는 바뀔 수 있다)
  if (memoRoot) return memoRoot;
  const prodRoot = prodInstanceRoot();
  if (!treeDerivedTestEnabled()) { memoRoot = prodRoot; return prodRoot; }
  const treeTestRoot = treeDerivedRootFor(process.cwd());
  if (!treeTestRoot) {
    // 스위치를 켰는데 트리를 못 찾아 prod 로 내려가는 것은 **의도와 상충**한다 — 조용히 넘기지 않는다.
    try {
      const { debug } = require('../debug/log.js') as typeof import('../debug/log.js');
      debug.log('instance.identity', 'tree-derive-no-tree', {
        cwd: process.cwd(),
        why: 'treeDerivedTest=ON 이나 cwd 위쪽에 git 트리가 없어 파생 불가 — prod 로 내려간다',
      });
    } catch { /* */ }
  }
  memoRoot = resolveInstance({ treeDerivedEnabled: true, treeTestRoot, prodRoot }).root;
  return memoRoot;
}
