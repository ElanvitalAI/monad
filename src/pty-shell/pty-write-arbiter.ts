// ── PTY write arbiter — 접근 매트릭스 집행 (PLAN §7 P2 · 프론티어 차용 #9) ──
//
// registry 의 `PtyAccessMode`(read/write/auto) × `PtyTransitionPolicy`(locked/open)는 필드·정책만
// 예약돼 있었고 **write 경로가 이를 집행하지 않았다**(registry.ts "arbiter 실장은 후속"). 이 모듈이
// 그 집행부다 — 대표 제약: "arbiter 는 최근 터미널 read/write 정책(PtyAccessMode)의 집행부지 별도
// 기계가 아니다"(PLAN §9). herdr 의 "쓰기 전 점유자 확인 + 배타적 writable owner"(RESEARCH §1-3·§5 #9)를
// elanous 의 access-matrix 로 실현.
//
// 순수(레지스트리 비의존·테스트 가능). 라이브 배선은 registry.ts write()/requestPtyTakeover.

import { canTransitionAccessMode, type PtyAccessMode, type PtyTransitionPolicy } from './pty-ref.js';

/** 쓰기 주체 — 사람 인터랙션 | 자율 brain/컨트롤러. 기본은 'human'(비파괴: 기존 인터랙티브 write).
 *
 * ⚠️ **위협모델(review)**: `actor` 는 **협조적 소유권 선언**이지 인프로세스 악의 코드에 대한 보안
 * 경계가 아니다 — 같은 프로세스 코드는 어차피 adapter.write 로 우회 가능. arbiter 가 막는 건 **우발적
 * 교차간섭**(사람 서피스가 자율 자식에 실수로 주입·자율 brain 이 관찰전용 PTY 에 씀)과 소유권 구조화다.
 * **기본이 안전**(actor 미지정=human → auto 자식에 write 불가)이라, 'agent' 로의 승격은 명시적 의도
 * 선언(우발 아님). 진짜 격리 경계는 프로세스/워크트리 층(직교)이다. */
export type PtyWriteActor = 'human' | 'agent';

/**
 * ⭐actor 파싱 SSOT(pure) — 신뢰 경계 **밖**에서 온 actor 문자열(CLI 플래그 · IPC 테이블 컬럼)을 읽는다.
 *
 * ⭐ **미지정과 미지원은 다르다.**
 * - **미지정** = `null`/`undefined` 뿐 — 마이그레이션 前 행(컬럼 NULL)·플래그 생략 → `'human'`(종전 동작)
 * - **그 외 전부** = 값이 있는데 아는 값이 아니다 → **`null`(거부)**. `''`·공백도 여기다 —
 *   *"비워서 보냈다"* 는 *"안 보냈다"* 가 아니다.
 *
 * 조용히 `'human'` 으로 떨어뜨리지 않는 이유: `'human'` 은 auto 자식에 **약한** 쪽이지만
 * **takeover 로 소유권을 뺏을 수 있는 강한** 쪽이라, 알 수 없는 값을 human 으로 읽으면 오타·손상된
 * 행·다른 빌드가 심은 값이 **소유권 탈취 권한을 얻는다**.
 */
export function parsePtyWriteActor(raw: string | null | undefined): PtyWriteActor | null {
  if (raw === null || raw === undefined) return 'human';
  const normalized = raw.trim().toLowerCase();
  return normalized === 'human' || normalized === 'agent' ? normalized : null;
}

export interface WriteDecision {
  readonly allow: boolean;
  readonly reason: string;
}

/**
 * ⭐접근 매트릭스 집행(pure) — (accessMode, actor) → write 허용?
 *   read  = 관찰 전용         → 둘 다 거부.
 *   write = 사람 인터랙티브    → human ✓ · agent ✗(agent 는 auto 로 소유하거나 takeover).
 *   auto  = brain 소유(자율)   → agent ✓ · human ✗(사람은 takeover 로 write 승격).
 * 이 비대칭이 "보호된 자율"(auto+locked = 위험 미션 무간섭)과 "관찰 전용"(read)을 집행한다.
 */
export function resolveWriteDecision(mode: PtyAccessMode, actor: PtyWriteActor): WriteDecision {
  switch (mode) {
    case 'read':
      return { allow: false, reason: `read=관찰 전용 — ${actor} write 불가` };
    case 'write':
      return actor === 'human'
        ? { allow: true, reason: 'write=사람 인터랙티브' }
        : { allow: false, reason: 'write=사람 소유 — agent 는 auto 로 소유하거나 takeover 필요' };
    case 'auto':
      return actor === 'agent'
        ? { allow: true, reason: 'auto=brain 소유(자율)' }
        : { allow: false, reason: 'auto=brain 소유 — 사람은 takeover(auto→write) 필요' };
  }
}

/** ⚠️ 판별 유니온 — 허용일 때만 `actor` 가 있다. `actor?:` 로 두면 호출부가 `undefined` 를 그대로
 *  `writePtyWithOutcome` 에 넘겨 **기본값 `'human'` 으로 조용히 강등**될 수 있다(거부가 통과로 둔갑). */
export type RemoteActorDecision =
  | { readonly allow: true; readonly actor: PtyWriteActor; readonly reason: string }
  | { readonly allow: false; readonly reason: string };

/**
 * ⭐크로스-프로세스 actor 인가(pure · F3 `agent` 슬라이스) — 프로세스 **밖에서** 온 제어 요청이
 * `'agent'` 를 주장할 수 있는가.
 *
 * in-process 에서 actor 는 위 주석대로 **협조적 선언**이다(같은 코드는 어차피 adapter.write 로 우회
 * 가능). 그러나 크로스-프로세스 채널에서는 성질이 달라진다 — **아무 프로세스나 `'agent'` 를 선언하면
 * `auto`(=보호된 자율) 자식이 무력화**된다. `human` 슬라이스가 `auto` 를 거부하는 것으로 지키던 불변식이
 * 뒤집히는 것이라, `'agent'` 만 **run-identity 일치**를 요구한다: 같은 run 의 부모/감독만 자식에 넣는다.
 *
 * ⚠️ 이것도 **보안 경계가 아니다**(env 를 위조하면 통과한다) — 막는 것은 *무관한 프로세스의 우발적
 * 주입*이고, 진짜 격리는 프로세스/워크트리 층(직교)이다. K run-identity anchor(`pty_manifest.run_id`)를
 * 그대로 쓰므로 새 식별자를 도입하지 않는다.
 *
 * `'human'` 은 종전 그대로 통과시킨다 — 접근 매트릭스가 이미 `auto` 를 거부하므로 이 층의 추가 판정이
 * 필요 없다(무회귀).
 */
export function resolveRemoteControlActor(
  requested: PtyWriteActor,
  requesterRunId: string,
  targetRunId: string,
): RemoteActorDecision {
  if (requested === 'human') return { allow: true, actor: 'human', reason: 'human=접근 매트릭스가 이미 판정' };
  const requester = requesterRunId.trim();
  const target = targetRunId.trim();
  // ⚠️ fail-closed — 양쪽 중 하나라도 run 을 모르면 거부한다. 어느 쪽이 비었는지 사유로 갈라
  //    "인가가 없다"와 "run 이 안 찍혔다"를 관측에서 구분할 수 있게 한다.
  if (!requester) return { allow: false, reason: 'agent-run-unidentified' };
  if (!target) return { allow: false, reason: 'target-run-unidentified' };
  if (requester !== target) return { allow: false, reason: 'run-mismatch' };
  return { allow: true, actor: 'agent', reason: `agent=같은 run(${target})의 감독` };
}

export interface TakeoverDecision {
  readonly allow: boolean;
  /** 허용 시 전환할 목표 모드(actor 의 소유 모드). */
  readonly newMode?: PtyAccessMode;
  readonly reason: string;
}

/**
 * ⭐소유권 takeover(pure) — 한 actor 가 write 제어를 요청. 목표 모드 = actor 의 소유 모드
 * (human→write · agent→auto). 정책 SSOT `canTransitionAccessMode` 재사용:
 *   - 이미 소유 모드면 멱등 허용.
 *   - locked 이고 다른 모드면 거부(auto+locked = 보호된 자율·무간섭 / read+locked = 관찰 영구).
 *   - open 이면 전환 허용(사람↔brain 이양).
 */
export function resolveTakeover(
  mode: PtyAccessMode,
  policy: PtyTransitionPolicy,
  actor: PtyWriteActor,
): TakeoverDecision {
  const target: PtyAccessMode = actor === 'human' ? 'write' : 'auto';
  if (mode === target) return { allow: true, newMode: target, reason: `이미 ${target} 소유(멱등)` };
  if (!canTransitionAccessMode(mode, target, policy)) {
    return { allow: false, reason: `${mode}+locked → ${target} 거부(보호된 소유·무간섭)` };
  }
  return { allow: true, newMode: target, reason: `takeover ${mode}→${target} (${actor})` };
}
