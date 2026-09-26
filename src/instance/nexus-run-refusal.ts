// ── P4 거부 게이트 (2026-07-26) — DESIGN §6 ─────────────────────────────────
//
// **비-리더 트리가 운영 싱글턴(`~/.elanous`)을 접수하려 할 때만** `nexus run` 을 거부하고
// `elanous leader claim` 을 안내한다. **그 외 어떤 명령·어떤 깊이도 거부하지 않는다** — 안 그러면
// 워크트리 PTY 자식이 전부 죽는다.
//
// ⚠️ **오판의 비대칭이 여기서는 거부 쪽이 위험하다.** launchd `com.elanous.nexus` 는 KeepAlive 로
// 재기동하므로, 잘못 거부하면 운영 데몬이 **크래시 루프로 내려앉는다.** 그래서 모호하면 전부
// 통과시킨다(fail-open): 권위 없음·판정 불가·예외 → 거부 안 함. 포트 31415 바인딩이 여전히 실질적
// 상호배제이므로 "오늘보다 나빠지지 않는다"(degrade to current behavior).
//
// 구조: **순수 판정(`decideNexusRunRefusal`)** 과 **부작용 껍질(`evaluateNexusRunRefusal`)** 을 나눈다.
// 판정은 입력만 보고 결과를 내고, 파일 기록·관측·안내 렌더는 껍질이 한다(테스트가 조합을 전수로 고정).

import { homedir } from 'node:os';
import { join } from 'node:path';
import { normRoot, effectiveInstanceRoot } from './resolve.js';
import { debug } from '../debug/log.js';
import {
  clearLeaderRefusal, leaderRefusalFilePath, normalizeTree,
  isInstalledCopyScript, readLeader, resolveSelfTree, writeLeaderRefusal, type LeaderRefusalRecord,
} from './leader.js';
import { getNestDepth } from '../agent/nest-depth.js';

export interface NexusRunRefusalInput {
  selfTree: string;
  leaderTree: string | null;
  root: string;
  homeRoot: string;
  depth: number;
  /** 설치본(`…/node_modules/elanous/…` · 위로 git 트리 없음)으로 도는가 — 설치본은 트리가 없어 selfTree 가 cwd 로 떨어진다. */
  installedCopy?: boolean;
}

export interface NexusRunRefusalDecision {
  refuse: boolean;
  why: string;
  /** 통과했지만 **아슬아슬한** 경우(비-리더인데 테스트 루트라 통과 · 권위 판정 불가 등).
   *  "왜 안 막았나"가 나중 진단의 핵심이라 통과도 관측 대상으로 표시한다(제1원칙). */
  observeAllowed: boolean;
  /** **운영 싱글턴을 리더가 정상 접수**한 경우에만 true. 거부 기록을 지울 자격은 이것뿐이다
   *  (리뷰 must-fix #5492): 테스트 루트 실행·권위 없음·판정 불가로 "통과"한 것을 성공 기동으로
   *  치면, `--test` 한 번에 운영 실패의 유일한 단서가 지워진다. */
  normalOperation: boolean;
}

/**
 * `nexus run`의 운영 싱글턴 접수만 좁게 지킨다.
 * 권위가 없거나 입력이 모호하면 현재 동작을 보존한다(fail-open).
 */
export function decideNexusRunRefusal(input: NexusRunRefusalInput): NexusRunRefusalDecision {
  // ⓪ 뿌리가 운영이 아니면 **여기서 끝** — `--test` 등 격리 실행은 어떤 깊이·어떤 트리든 통과.
  //    (전역 `--test` 는 Commander parse 전에 적용돼 이 시점 root 가 이미 `.elanous-test` 다 — 실측 고정됨)
  if (normRoot(input.root) !== normRoot(input.homeRoot)) {
    return {
      refuse: false,
      why: '해석된 뿌리가 운영 싱글턴이 아님',
      observeAllowed: input.leaderTree !== null && normRoot(input.selfTree) !== normRoot(input.leaderTree),
      normalOperation: false,
    };
  }
  if (input.leaderTree === null) {
    return { refuse: false, why: '운영 리더 권위를 판정할 수 없음 — fail-open', observeAllowed: true, normalOperation: false };
  }
  // ⚠️ 중첩은 **리더 트리여도** 막는다(DESIGN §6 "액자 안에서 운영 접수 금지"). 요약 문구의
  //    "비-리더만 거부"는 ③ 조건을 가리키는 말이고, 중첩 금지는 그와 **병렬인 추가 조건**이다.
  if (input.depth > 0) {
    return { refuse: true, why: `중첩 depth ${input.depth}에서 운영 데몬 접수 금지`, observeAllowed: false, normalOperation: false };
  }
  // 설치본 = 운영 몸 — 우주 해석기와 같은 규칙(설치본은 prod). 설치본엔 트리가 없어 selfTree 가 «작업 폴더»로 떨어진다.
  // 🩸 09-26: 운영 plist 의 작업 폴더를 pilot → 홈으로 옮기자 «비-리더 트리» 로 거부 · launchd 재시작 루프(1분 반 중단).
  //    지금까지 통과한 것은 작업 폴더가 우연히 리더(pilot)였기 때문 — 숨은 pilot 의존.
  if (input.installedCopy) {
    return { refuse: false, why: '설치본(운영 몸)의 최상위 운영 데몬 기동', observeAllowed: false, normalOperation: true };
  }
  if (normRoot(input.selfTree) !== normRoot(input.leaderTree)) {
    return { refuse: true, why: '비-리더 트리의 운영 데몬 접수 금지', observeAllowed: false, normalOperation: false };
  }
  return { refuse: false, why: '리더 트리의 최상위 운영 데몬 기동', observeAllowed: false, normalOperation: true };
}

/** 거부 안내 — `leader-cli.ts` 의 드리프트 안내 톤을 따른다(재발명 0). */
export function renderNexusRunRefusal(input: NexusRunRefusalInput, decision: NexusRunRefusalDecision): string {
  const L: string[] = [];
  L.push(`⛔ 운영 데몬 기동 거부 — ${decision.why}`);
  L.push('');
  L.push(`  이 트리   : ${input.selfTree}`);
  L.push(`  운영 리더 : ${input.leaderTree ?? '(미지정)'}`);
  L.push(`  해석 뿌리 : ${input.root}${input.depth > 0 ? `  · 중첩 depth ${input.depth}` : ''}`);
  L.push('');
  if (input.depth > 0) {
    L.push('  중첩(액자 안)에서는 운영 스코프 데몬을 띄우지 않습니다.');
    L.push("  격리로 띄우려면 '--test' 를 붙이세요.");
  } else {
    L.push("  이 트리를 운영으로 올리려면 : 'elanous leader claim --yes'");
    L.push("  launchd 는 별도               : 리더 트리에서 'elanous nexus install' (데몬 재기동)");
    L.push("  격리로 띄우려면               : '--test'");
  }
  L.push(`  사유 기록 : ${leaderRefusalFilePath()}  ('elanous leader status' 로 확인)`);
  return L.join('\n');
}

export interface NexusRunGateDeps {
  selfTree?: string;
  /** 설치본으로 도는가(시험 seam) — 기본 = `isInstalledCopyScript()`. */
  installedCopy?: boolean;
  leaderTree?: string | null;
  root?: string;
  homeRoot?: string;
  depth?: number;
  now?: () => string;
  write?: (rec: LeaderRefusalRecord) => void;
  clear?: () => void;
  log?: (event: string, data: Record<string, unknown>, warn?: boolean) => void;
}

/**
 * 실제 게이트 — 판정 ⊕ 기록 ⊕ 관측. 거부면 안내 문자열을 반환(호출부가 출력·exit), 통과면 null.
 *
 * ⚠️ **예외는 통과로 흡수한다** — 이 게이트의 버그가 운영 데몬을 못 뜨게 만들면 안 된다(fail-open).
 */
export function evaluateNexusRunRefusal(deps: NexusRunGateDeps = {}): string | null {
  const log = deps.log ?? ((event, data, warn) => {
    try { debug.log('instance.identity', event, data, warn ? { level: 'warn' } : undefined); } catch { /* fail-soft */ }
  });
  try {
    const input: NexusRunRefusalInput = {
      selfTree: deps.selfTree ?? resolveSelfTree(),
      installedCopy: deps.installedCopy ?? isInstalledCopyScript(),
      leaderTree: deps.leaderTree !== undefined
        ? deps.leaderTree
        : (() => { const r = readLeader(); return r ? normalizeTree(r.tree) : null; })(),
      root: deps.root ?? effectiveInstanceRoot(),
      homeRoot: deps.homeRoot ?? join(homedir(), '.elanous'),
      depth: deps.depth ?? getNestDepth(),
    };
    const decision = decideNexusRunRefusal(input);
    const shape = {
      selfTree: input.selfTree, leaderTree: input.leaderTree, root: input.root,
      depth: input.depth, why: decision.why,
    };

    if (!decision.refuse) {
      if (decision.observeAllowed) log('nexus-run-allowed-nonleader', shape);
      // ⚠️ 기록을 지울 자격은 **리더가 운영을 정상 접수했을 때뿐**(리뷰 must-fix #5492).
      //    테스트 루트 실행·권위 없음으로 "통과"한 것까지 성공 기동으로 치면, `--test` 한 번에
      //    운영 실패의 유일한 단서가 지워진다.
      if (decision.normalOperation) (deps.clear ?? clearLeaderRefusal)();
      return null;
    }

    log('nexus-run-refused', shape, true);
    (deps.write ?? writeLeaderRefusal)({
      refusedAt: (deps.now ?? (() => new Date().toISOString()))(),
      selfTree: input.selfTree,
      leaderTree: input.leaderTree ?? '',
      root: input.root,
      depth: input.depth,
      why: decision.why,
    });
    return renderNexusRunRefusal(input, decision);
  } catch (e) {
    // 게이트 자체가 깨져도 데몬은 떠야 한다.
    log('nexus-run-gate-error', { error: e instanceof Error ? e.message : String(e) }, true);
    return null;
  }
}
