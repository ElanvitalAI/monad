// ── Instance root coherence — config-dir ↔ state-dir 정합 가드 (Phase D2-핵심) ──
//
// 근본(PLAN §1): "한 monad = 한 뿌리". 그러나 역사적으로 인스턴스 경로 정체성이
// 두 축으로 쪼개져 있다 — config-dir(getMonadConfigDir · tasks.db/nexus)와
// state-dir(MONAD_STATE_DIR · logs/sessions/memory/autopilot). 실제로는 항상 같은
// 폴더로 수렴해야 하는데, 스크립트/부분 격리가 **한 축만** 설정하면 조용히 갈라진다:
//   - MONAD_STATE_DIR 만 → tasks.db 는 prod, 나머지는 test (2026-07-19 미션 누출 사건)
//   - --config-dir 만 → tasks.db 는 test, logs/기억/autopilot 은 prod
// 이 어긋남은 지금까지 **침묵**했다(각자 자기 축만 봄). 이 가드가 부팅 시점에
// 두 축을 대조해 divergence 를 **시끄럽게** 만든다(warn-first — 부팅은 안 막는다).
//
// ⚠️ instanceRoot 통짜 병합(D2-full)은 하지 않는다 — 실제 이득(어긋남 감지)은 이
// assert 하나로 얻고, 두 resolver 물리 병합은 부팅-크리티컬 리스크 대비 실이득이 없다
// (nexus/paths.ts 역사가 3축이 원칙적 경계가 아닌 accretion 임을 보여준다).

import { getMonadConfigDir } from './monad-config-dir.js';
import { monadStateRoot } from './autopilot/state-paths.js';
import { getNestDepth } from './agent/nest-depth.js';
import { debug } from './debug/log.js';
import { resolveCurrentInstance } from './instance/current.js';
import { effectiveInstanceRoot, prodInstanceRoot } from './instance/resolve.js';

export interface InstanceRootCoherence {
  /** getMonadConfigDir() — tasks.db·nexus 스코프. */
  configDir: string;
  /** monadStateRoot() — logs·sessions·memory·autopilot 스코프. */
  stateDir: string;
  /** 두 축이 같은 뿌리를 가리키나(= 정합). */
  coherent: boolean;
}

// ── shadow-root env (Phase F) — 인스턴스 뿌리를 우회/재정의하는 dormant legacy env ──
//
// 이들은 전부 SET 되는 곳이 없는 legacy READ 폴백이나, 설정되면 --config-dir/MONAD_STATE_DIR
// 을 우회해 스토어를 뿌리 밖으로 빼돌린다(특히 MONAD_TASKS_DIR/DB 는 config-dir 보다 우선).
// incident 전례(MONAD_NEXUS_DIR 제거→49 test 사고)상 제거 대신 **surfacing**: 설정 감지 시
// 부팅에서 시끄럽게(관측+stderr). "제거 못 하면 오용을 관측화" = monad 방식.
const SHADOW_ROOT_ENVS = ['MONAD_HOME', 'MONAD_DIR', 'MONAD_NEXUS_DIR', 'MONAD_TASKS_DIR', 'MONAD_TASKS_DB'] as const;

/** 현재 설정된 shadow-root env 목록(값 포함). 비어있으면 정상. */
export function detectShadowRootEnvs(): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const name of SHADOW_ROOT_ENVS) {
    const value = process.env[name]?.trim();
    if (value) out.push({ name, value });
  }
  return out;
}

// ── prod-spawn footgun — nested 인터랙티브로 prod 인스턴스를 수동 spawn한 위험 (backlog #1) ──
//
// divergence 가드(위 assertInstanceRootCoherence)와 **다른 축**이다. divergence 는
// "config-dir ≠ state-dir"(부분 격리로 두 축이 갈라짐)을 잡는다. 이건 그 반대 —
// **격리를 아예 안 건 것**을 잡는다: 사람이 prod 셸(MONAD_STATE_DIR 미설정)에서
// nested 인터랙티브로 monad 를 --test 없이 수동 spawn하면, 자식이 prod 를 상속받아
// prod 스토어(~/.monad)를 조용히 오염시킨다.
//
// footgun = nested AND interactive AND prod (세 신호가 모두 참일 때만):
//   1. nested      = getNestDepth() > 0 (부모가 monad → MONAD_NEST_DEPTH 상속)
//   2. interactive = process.stdin.isTTY === true (PTY 수동 실행 신호)
//   3. prod        = 현재 4층 우주 리졸버가 prod root 를 가리킴
//
// 3층 트리 파생 자식은 MONAD_STATE_DIR 없이도 test 우주에 설 수 있으므로, env 부재를 prod의
// 대리 신호로 쓰지 않는다. 순수 수동 prod spawn만 걸린다.
// warn-first — 부팅을 절대 막지 않는다(divergence 가드와 동일 스타일).

export interface ProdSpawnFootgun {
  /** 부모가 monad 인가(MONAD_NEST_DEPTH > 0). */
  nested: boolean;
  /** 인터랙티브 TTY 인가(수동 실행 신호). */
  interactive: boolean;
  /** prod 인스턴스를 만지나(4층 리졸버의 kind/root 판정). */
  prod: boolean;
  /** 세 신호가 모두 참 — 경고 대상. */
  footgun: boolean;
}

/** 4층 리졸버의 현재 우주 판정. `effectiveInstanceRoot`와 prod 정본을 함께 대조한다. */
function currentProdResolution() {
  const current = resolveCurrentInstance();
  const root = effectiveInstanceRoot();
  const prodRoot = prodInstanceRoot();
  return { current, root, prodRoot, prod: current.kind === 'prod' && root === prodRoot };
}

/** 순수 — footgun 3신호 판정. `interactive` 는 테스트/호출부 주입 가능(기본 stdin.isTTY). */
export function checkProdSpawnFootgun(opts: { interactive?: boolean } = {}): ProdSpawnFootgun {
  const nested = getNestDepth() > 0;
  const interactive = opts.interactive ?? process.stdin.isTTY === true;
  const { prod } = currentProdResolution();
  return { nested, interactive, prod, footgun: nested && interactive && prod };
}

/** 부팅 경고 — footgun 이면 시끄럽게(관측 관문 + stderr). warn-only(부팅 불침몰·throw 금지).
 *  ⚠️ 순서 갭(대표 P3·2026-07-26): main() 초반(arg 파싱 前)에 호출되면 StoreSink(logs.db) 등록 前이라
 *  debug.log 가 파일 트레일만 닿고 logs.db 미도달 → `monad logs --category instance.identity` 조회 불가.
 *  `emit` 으로 stderr(초반 surfacing)와 debug.log(sink 등록 後 재발행→logs.db)를 분리한다.
 *  'both'(기본·무회귀) · 'stderr'(경고만) · 'log'(관측만). checkProdSpawnFootgun 이 순수라 재판정 무해. */
export function warnProdSpawnFootgun(opts: { interactive?: boolean; emit?: 'both' | 'stderr' | 'log' } = {}): ProdSpawnFootgun {
  const f = checkProdSpawnFootgun(opts);
  const emit = opts.emit ?? 'both';
  if (f.footgun) {
    const resolution = currentProdResolution();
    const depth = getNestDepth();
    const reason = {
      kind: resolution.current.kind,
      root: resolution.current.root,
      layer: resolution.current.layer,
      why: resolution.current.why,
    };
    if (emit !== 'stderr') {
      // 관측 관문(logs.db) — 조회로 footgun 이력을 볼 수 있게(제1원칙). sink 등록 後 호출해야 logs.db 도달.
      try {
        debug.log('instance.identity', 'prod-spawn-footgun', {
          depth,
          interactive: f.interactive,
          prod: f.prod,
          ...reason,
        });
      } catch { /* 관측 실패가 부팅을 막지 않는다 */ }
    }
    if (emit !== 'log') {
      const instance = `현재 우주: ${reason.kind} root=${reason.root} (layer=${reason.layer}; ${reason.why}).`;
      const guidance = depth > 1
        ? ` 자식 맥락에서는 --test 처방을 내지 않습니다. ${instance}`
        : ` 격리하려면 --test 를 붙이세요(전역 플래그·cwd 트리의 .monad-test 로 두 축 자동 격리). ${instance}`;
      try {
        process.stderr.write(`[instance] ⚠️ prod 인스턴스를 nested 인터랙티브로 띄웠습니다 — prod 스토어(~/.monad)를 오염시킬 수 있습니다.${guidance}\n`);
      } catch { /* */ }
    }
  }
  return f;
}

/** 두 축 해석기(주입 가능) — 기본은 실제 리졸버. */
export interface InstanceAxisReaders {
  configDir?: () => string;
  stateDir?: () => string;
}

/** 순수 — 현재 프로세스의 두 축을 해석해 정합 판정.
 *
 * ⚠️ **축을 주입할 수 있어야 하는 이유**(2026-07-27): P3(#5479) 이후 두 축은 `effectiveInstanceRoot`
 * **한 함수**로 수렴해 *"한 축만 설정 → 갈라짐"* 이 **구조적으로 불가능**해졌다. 그건 의도한 개선이지만,
 * 그 결과 이 가드의 divergence 경로를 **공개 API 로는 재현할 수 없게** 됐다.
 * 주입 없이 두면 남은 선택지는 *"안전 가드의 테스트를 지우는 것"* 뿐이라, 읽는 지점만 주입 가능하게 한다.
 * 프로덕션 경로는 인자 없이 부르므로 **무회귀**다. */
export function checkInstanceRootCoherence(readers: InstanceAxisReaders = {}): InstanceRootCoherence {
  const configDir = (readers.configDir ?? getMonadConfigDir)();
  const stateDir = (readers.stateDir ?? monadStateRoot)();
  return { configDir, stateDir, coherent: configDir === stateDir };
}

/** 부팅 가드 — divergence 면 시끄럽게(관측 관문 + stderr). 기본 warn-first(부팅 불침몰).
 *  `throwOnDivergence` 로 하드 게이트 승격 가능(향후). 정합이면 조용히 통과. */
export function assertInstanceRootCoherence(opts: { throwOnDivergence?: boolean; readers?: InstanceAxisReaders } = {}): InstanceRootCoherence {
  const c = checkInstanceRootCoherence(opts.readers);
  if (!c.coherent) {
    // 관측 관문(logs.db) — 조회로 divergence 이력을 볼 수 있게(제1원칙).
    try {
      debug.log('instance.identity', 'axis-divergence', {
        configDir: c.configDir,
        stateDir: c.stateDir,
        why: 'config-dir(tasks/nexus) 와 state-dir(logs/sessions/memory/autopilot) 가 다른 뿌리 — 부분 격리(한 축만 설정)로 스토어가 갈라짐',
      });
    } catch { /* 관측 실패가 부팅을 막지 않는다 */ }
    const msg = `[instance] ⚠️ config-dir ≠ state-dir — 인스턴스 뿌리가 갈라짐(부분 격리 위험)\n`
      + `  config-dir(tasks.db·nexus): ${c.configDir}\n`
      + `  state-dir(logs·sessions·memory·autopilot): ${c.stateDir}\n`
      + `  → --config-dir 와 MONAD_STATE_DIR 을 같은 뿌리로 맞추세요(--test 는 둘 다 부착).\n`;
    try { process.stderr.write(msg); } catch { /* */ }
    if (opts.throwOnDivergence) {
      throw new Error(`instance root divergence: config-dir=${c.configDir} state-dir=${c.stateDir}`);
    }
  }
  // shadow-root env(Phase F) — 설정돼 있으면 뿌리 우회 위험을 시끄럽게(관측+stderr).
  const shadows = detectShadowRootEnvs();
  if (shadows.length > 0) {
    try {
      debug.log('instance.identity', 'shadow-root-env', {
        envs: shadows,
        why: 'legacy env 가 --config-dir/MONAD_STATE_DIR 을 우회해 스토어를 인스턴스 뿌리 밖으로 빼돌릴 수 있음(dormant·설정 금지)',
      });
    } catch { /* */ }
    const list = shadows.map((s) => `${s.name}=${s.value}`).join(', ');
    try { process.stderr.write(`[instance] ⚠️ shadow-root env 설정됨(뿌리 우회 위험·은퇴 대상): ${list}\n`); } catch { /* */ }
  }
  return c;
}
