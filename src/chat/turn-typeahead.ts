// ── 턴 중 타이핑 보존 (C-d-3' · 2026-07-13) ─────────────────────────────────
//
// 대표 dogfood: 턴 스트리밍 중 타이핑이 에코 없이 유실 — "포커스가 안 돌아온다"
// 체감의 실체. ref 정렬(RESEARCH-input-focus-essential §3b):
//   codex — 턴 중에도 composer 가 키를 받고 제출은 steer/queue 로 흡수
//           (`pending_steers`·`queued_user_messages`).
//   CC    — focus 식에 isLoading 없음 · 제출은 enqueue() + 버퍼 클리어.
// elanous: 스트리밍 키 사다리에서 printable/backspace/enter 를 이 버퍼로 보존
// (에코는 호출측이 composer zone 에 직접 페인트), 턴 종료 시 FIFO로 넘긴다.

export interface TurnTypeaheadState {
  /** 아직 Enter 하지 않은 현재 작성 중 입력. */
  buffer: string;
  /** Enter 한 입력들. 턴 종료 뒤 입력 순서대로 자동 제출한다. */
  queuedSubmissions: string[];
}

export function createTurnTypeaheadState(): TurnTypeaheadState {
  return { buffer: '', queuedSubmissions: [] };
}

/** printable 판정 — 단일 문자(한글 음절/자모·유니코드 포함) 또는 space.
 *  'up'/'tab'/'escape'/'pageup'/'f1' 같은 명명 키는 길이>1 이라 자연 배제.
 *  ★ j/k/f/g/G 도 문자로 취급한다. */
export function isTypeaheadPrintable(key: { name: string; ctrl?: boolean; alt?: boolean }): boolean {
  if (key.ctrl || key.alt) return false;
  if (key.name === 'space') return true;
  return [...key.name].length === 1;
}

export type TurnTypeaheadKeyResult = {
  state: TurnTypeaheadState;
  /** true = 이 키를 typeahead 가 소유(스트리밍 사다리의 다른 핸들러로 보내지 않음). */
  consumed: boolean;
  /** true = buffer/queue 가 바뀜 — 호출측이 에코를 다시 그린다. */
  changed: boolean;
  /** 등록소가 관측용으로 표시한 슬래시 명령의 즉시 실행 요청. 실행은 호출측의 책임이다. */
  immediateSubmission?: string;
  /** 비어 있지 않은 Enter 입력의 제출 경로 분류. */
  submissionDisposition?: 'immediate' | 'fifo';
};

/** 등록소 소유의 관측용 표시 조회. 이름·문법·실행 정책은 이 순수 판정기에 두지 않는다. */
export type TurnTypeaheadImmediateSubmissionLookup = (text: string) => boolean;

/** 스트리밍 중 키 1개 판정(순수). mouse/비-press/수정키는 소유하지 않는다.
 *  - printable → buffer 누적
 *  - backspace → 마지막 코드포인트 제거(빈 버퍼면 미소유 — 기존 semantics 보존)
 *  - enter → 비어 있지 않은 buffer를 FIFO 제출 큐에 넣고 다음 문장을 위한 buffer를 비운다
 *  - ctrl+up → 마지막 제출 큐 항목을 buffer 끝으로 되꺼낸다
 *  - escape 등 나머지 → 미소유(턴 중단 등 기존 경로 그대로) */
export function applyTurnTypeaheadKey(
  state: TurnTypeaheadState,
  // ⭐ `shift`·`meta` 도 선언한다 — 상류 대시보드가 실제로 싣는 필드다. 구조적 타이핑이라
  //    선언이 없어도 런타임엔 들어오므로, 빠뜨리면 정확한 조합 판정을 타입으로 못 쓴다.
  key: { name: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean; mouse?: unknown; kind?: string },
  isImmediateSubmission?: TurnTypeaheadImmediateSubmissionLookup,
): TurnTypeaheadKeyResult {
  if (key.mouse) return { state, consumed: false, changed: false };
  if (key.kind && key.kind !== 'press') return { state, consumed: false, changed: false };

  if (key.name === 'backspace' && !key.ctrl && !key.alt) {
    if (!state.buffer) return { state, consumed: false, changed: false };
    const cps = [...state.buffer];
    cps.pop();
    return { state: { ...state, buffer: cps.join('') }, consumed: true, changed: true };
  }

  if (key.name === 'enter' && !key.ctrl && !key.alt) {
    if (!state.buffer.trim()) return { state, consumed: false, changed: false };
    try {
      if (state.buffer.startsWith('/') && isImmediateSubmission?.(state.buffer)) {
        return {
          state: { ...state, buffer: '' },
          consumed: true,
          changed: true,
          immediateSubmission: state.buffer,
          submissionDisposition: 'immediate',
        };
      }
    } catch {
      // A registry lookup failure must preserve the typed input on the existing FIFO path.
    }
    return {
      state: { buffer: '', queuedSubmissions: [...state.queuedSubmissions, state.buffer] },
      consumed: true,
      changed: true,
      submissionDisposition: 'fifo',
    };
  }

  // ⛔ 정확한 조합만 소유한다 — 수식자를 덜 보면 `ctrl+shift+up` 같은 조합까지 삼켜
  //    다른 층이 쓸 키를 조용히 먹는다.
  if (key.name === 'up' && key.ctrl && !key.alt && !key.shift && !key.meta) {
    const recalled = state.queuedSubmissions.at(-1);
    if (recalled === undefined) return { state, consumed: false, changed: false };
    return {
      state: { buffer: state.buffer + recalled, queuedSubmissions: state.queuedSubmissions.slice(0, -1) },
      consumed: true,
      changed: true,
    };
  }

  if (isTypeaheadPrintable(key)) {
    const ch = key.name === 'space' ? ' ' : key.name;
    return { state: { ...state, buffer: state.buffer + ch }, consumed: true, changed: true };
  }

  return { state, consumed: false, changed: false };
}

/** Restores an immediate-dispatch candidate to the tail of the existing FIFO after dispatch rejects it. */
export function restoreTurnTypeaheadSubmission(
  state: TurnTypeaheadState,
  text: string,
): TurnTypeaheadState {
  return { ...state, queuedSubmissions: [...state.queuedSubmissions, text] };
}

export type TurnTypeaheadHandoff =
  | { kind: 'none' }
  | { kind: 'prefill'; text: string }
  | { kind: 'submit'; text: string };

/** 턴 종료 때 FIFO의 다음 항목 하나를 꺼낸다. 큐가 비면 미제출 buffer는 prefill한다. */
export function dequeueTurnTypeaheadHandoff(
  state: TurnTypeaheadState,
): { handoff: TurnTypeaheadHandoff; state: TurnTypeaheadState } {
  const [next, ...queuedSubmissions] = state.queuedSubmissions;
  if (next !== undefined) {
    return { handoff: { kind: 'submit', text: next }, state: { ...state, queuedSubmissions } };
  }
  if (!state.buffer) return { handoff: { kind: 'none' }, state };
  return { handoff: { kind: 'prefill', text: state.buffer }, state: createTurnTypeaheadState() };
}

/** ⭐ 턴 종료 드레인 **한 걸음** — `src/dashboard/index.ts` 의 inner-loop 가 반복마다 이걸 부른다.
 *  ⛔ 종전엔 그 순서(dequeue → state 교체 → nextInitial 누적 → submit 이면 enter 주입)가
 *     `index.ts` 안에만 있어서, 테스트가 그 순서를 **베껴 모사**할 수밖에 없었다. 베낀 테스트는
 *     배선 회귀를 못 잡는다(무인 리뷰 must-fix). ⇒ 순서 자체를 여기로 옮겨 **같은 코드**를
 *     테스트가 타게 한다. `index.ts` 는 결과를 화면·키 주입에 배선하기만 한다. */
export function drainTurnTypeaheadOnce(
  state: TurnTypeaheadState,
  carriedInitial: string | null | undefined,
  opts?: { interrupted?: boolean },
): { state: TurnTypeaheadState; nextInitial: string | undefined; injectEnter: boolean } {
  if (opts?.interrupted && state.queuedSubmissions.length > 0) {
    const restored = [...state.queuedSubmissions, ...(state.buffer ? [state.buffer] : [])].join('\n');
    return {
      state: createTurnTypeaheadState(),
      nextInitial: carriedInitial ? `${carriedInitial}\n${restored}` : restored,
      injectEnter: false,
    };
  }
  const { handoff, state: remaining } = dequeueTurnTypeaheadHandoff(state);
  if (handoff.kind === 'none') return { state: remaining, nextInitial: carriedInitial ?? undefined, injectEnter: false };
  return {
    state: remaining,
    nextInitial: carriedInitial ? `${carriedInitial}${handoff.text}` : handoff.text,
    injectEnter: handoff.kind === 'submit',
  };
}

/** Backwards-compatible non-mutating handoff decision for a caller that only needs the next action. */
export function resolveTurnTypeaheadHandoff(state: TurnTypeaheadState): TurnTypeaheadHandoff {
  return dequeueTurnTypeaheadHandoff(state).handoff;
}

/**
 * ★ ***대기 큐를 «통째로» 비우고 그 내용을 낸다*** — `B3`(턴 «안» 주입)의 공급원. 순수.
 *
 * ⛔ 「비우면서 돌려준다」가 계약이다 — 안 비우면 같은 발화가 다음 루프 경계에서 «또» 들어간다.
 * ⚠️ 버퍼(치던 중인 초안)는 «건드리지 않는다» — 그건 아직 제출되지 않은 글이다.
 */
export function drainTurnTypeaheadQueue(
  state: TurnTypeaheadState,
): { state: TurnTypeaheadState; drained: string[] } {
  if (state.queuedSubmissions.length === 0) return { state, drained: [] };
  return {
    state: { ...state, queuedSubmissions: [] },
    drained: [...state.queuedSubmissions],
  };
}

/**
 * ★ 라이브 턴 안으로 배수된 발화의 상태 전이 + 챗로그 문장. 순수.
 *
 * 대시보드 `enqueuePendingUserInput` onDrained 가 앞에서부터
 * `slice(drained.length)` 로 떨어내는 FIFO 와 같다.
 * 버퍼는 건드리지 않는다. 배수된 것이 없으면 문장도 없다.
 *
 * 문면은 `renderTurnTypeaheadQueueRow` 와 나란히 읽힌다:
 *   대기 `⏳ 대기 1건 · "<내용>" · 턴 종료 시 전송`
 *   배수 `⏳ 턴 안 1건 · "<내용>" · 라이브 턴으로 전송`
 *
 * ⚠️ 이 함수는 순수 조각이다 — 대시보드 배선·debug.log 는 호출측 책임
 *    (이 착지는 그 배선을 넣지 않는다).
 */
export function drainedIntoTurn(
  state: TurnTypeaheadState,
  drained: readonly string[],
): { state: TurnTypeaheadState; sentence: string | null } {
  if (drained.length === 0) return { state, sentence: null };
  const remaining = state.queuedSubmissions.slice(drained.length);
  const count = drained.length;
  const label = count === 1 ? '⏳ 턴 안 1건' : `⏳ 턴 안 ${count}건`;
  const quoted = drained.map(text => `"${text}"`).join(' · ');
  return {
    state: { ...state, queuedSubmissions: remaining },
    sentence: `${label} · ${quoted} · 라이브 턴으로 전송`,
  };
}

/** 스트리밍 에코 라인(무색) — composer zone 1줄에 그릴 내용.
 *
 *  ⛔⭐⭐ `B1`(2026-08-19 · 대표 지시) — ***큐 표시는 여기에 그리지 않는다.***
 *    대표: *"이 내용을 입력기에 그리는게 아니라 스트리밍 프롬프트에 그려야 하는것입니다."*
 *    ⇒ 큐 문면은 `renderTurnTypeaheadQueueRow()` 가 «따로» 내고, 스트리밍 표시줄 위에 그려진다.
 *    ⚠️ `includeQueueSuffix` 는 옛 호출부 보존용이다 — 기본은 «안 붙인다».
 *  width 초과 시 앞부분 절단(커서 쪽 = 끝부분 우선 표시 · textInput 동형). */
export function renderTurnTypeaheadEcho(
  state: TurnTypeaheadState,
  width: number,
  opts?: { includeQueueSuffix?: boolean },
): string {
  const count = state.queuedSubmissions.length;
  const suffix = opts?.includeQueueSuffix && count > 0 ? `  ⏎ ${count}건 대기 · 턴 종료 시 전송` : '';
  const budget = Math.max(8, width - 2 - [...suffix].length);
  const cps = [...state.buffer];
  const shown = cps.length > budget ? cps.slice(cps.length - budget).join('') : state.buffer;
  return `${shown}${suffix}`;
}

/**
 * ★ ***큐 «행»*** — 스트리밍 영역에 그릴 한 줄. 큐가 비면 `null`. 순수.
 *
 * ⭐ ref 정렬(grok-build): 큐 항목은 ⓐ「큐 행」으로 한 번 ⓑ 승격 뒤 `❯` 블록으로 한 번 보인다.
 *   ⛔ 두 번 «동시에» 보이면 회귀다.
 * ⭐ 그리고 ***내용을 보여 준다*** — 「1건 대기」만으로는 «무엇이» 대기 중인지 모른다.
 *   대기가 여럿이면 «가장 먼저 나갈 것»(FIFO 머리)을 보여 준다.
 */
export function renderTurnTypeaheadQueueRow(
  state: TurnTypeaheadState,
  width: number,
): string | null {
  const count = state.queuedSubmissions.length;
  if (count === 0) return null;
  const head = state.queuedSubmissions[0] ?? '';
  const label = count === 1 ? '⏳ 대기 1건' : `⏳ 대기 ${count}건`;
  // 되꺼내기 키를 화면에 적는다 — 안내가 없어 대기 발화를 취소·수정할 길을 몰랐다(2026-09-26 베어 VM 실측 · UX 12).
  const tail = ' · 턴 종료 시 전송 · Ctrl+↑ 되꺼내기';
  const budget = Math.max(8, width - [...label].length - [...tail].length - 5);
  const cps = [...head];
  const shown = cps.length > budget ? `${cps.slice(0, budget).join('')}…` : head;
  return `${label} · "${shown}"${tail}`;
}
