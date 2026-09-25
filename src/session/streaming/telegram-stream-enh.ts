// ── 텔레그램 스트리밍 강화 — typing governor · fair-queue · rotation (C5-enh · 2026-07-16) ──
//
// 설계 §5.2-5(typing governor)·§5.2-6(forum fair-queue)·§10-2(scroll-jump rotation). openclaw
// account-throttler·REPOSITION 기법의 channel-agnostic 순수 형태. telegram sink 가 주입해 사용.
// 전부 config-gated(기본 off) — 라이브 텔레그램 스트리밍 무접촉(제1원칙 라이브 턴 안전).

// ── typing governor (§5.2-5) ────────────────────────────────────────────────────
// sendChatAction("typing") 를 저비용 라이브 신호로. ⚠️ anti-footgun: 401(봇이 차단/kick) 이
// 반복되면 봇이 스팸으로 삭제될 수 있어 **연속 실패 N 후 영구 suspend**(다시 시도 안 함).

export interface TypingGovernor {
  /** typing 신호 시도(fail-soft). 영구 suspend 됐으면 no-op. */
  ping: (chatId: number, threadId?: number) => void;
  isSuspended: () => boolean;
}

export interface TypingGovernorDeps {
  sendChatAction: (chatId: number, threadId?: number) => Promise<void>;
  /** 401/Forbidden 판정(봇 차단) — true 면 즉시 영구 suspend. */
  isForbidden?: (err: unknown) => boolean;
  now?: () => number;
}

export interface TypingGovernorConfig {
  /** 같은 chat 재-ping 최소 간격(ms). 기본 4000(typing 은 ~5s 지속). */
  minGapMs?: number;
  /** 연속 실패 N 후 영구 suspend. 기본 10. */
  maxConsecutiveFailures?: number;
}

function defaultIsForbidden(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: number; description?: string } | null;
  if (e?.statusCode === 401 || e?.statusCode === 403 || e?.code === 401 || e?.code === 403) return true;
  return typeof e?.description === 'string' && /forbidden|bot was blocked|kicked/i.test(e.description);
}

export function createTypingGovernor(deps: TypingGovernorDeps, config: TypingGovernorConfig = {}): TypingGovernor {
  const now = deps.now ?? Date.now;
  const isForbidden = deps.isForbidden ?? defaultIsForbidden;
  const minGapMs = config.minGapMs ?? 4000;
  const maxFailures = config.maxConsecutiveFailures ?? 10;
  let suspended = false;
  let consecutiveFailures = 0;
  const lastPingAt = new Map<string, number>();

  return {
    ping(chatId: number, threadId?: number): void {
      if (suspended) return;
      const key = `${chatId}:${threadId ?? ''}`;
      const t = now();
      if (t - (lastPingAt.get(key) ?? Number.NEGATIVE_INFINITY) < minGapMs) return;
      lastPingAt.set(key, t);
      void deps.sendChatAction(chatId, threadId).then(
        () => { consecutiveFailures = 0; },
        (err) => {
          if (isForbidden(err)) { suspended = true; return; } // anti-footgun 즉시 영구
          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) suspended = true;
        },
      );
    },
    isSuspended: () => suspended,
  };
}

// ── forum/supergroup fair-queue (§5.2-6) ────────────────────────────────────────
// 한 supergroup(chatId) 안 여러 forum topic(threadId)이 그룹 rate budget 을 공유 → 핫 토픽이
// 다른 토픽을 starve. per-chat 라운드로빈으로 **직전 서빙 thread 를 뒤로** 돌려 공정성 확보.
// 순수 선택 로직 — sink 가 pending thread 집합을 주면 다음 서빙 thread 를 고른다.

export interface GroupFairQueue {
  /** thread 가 편집 대기 등록. */
  enqueue: (chatId: number, threadKey: string) => void;
  /** 편집 완료(서빙됨) — 라운드로빈 커서 전진. */
  served: (chatId: number, threadKey: string) => void;
  /** thread 종료 — 큐에서 완전 제거(finalize/abort). 슬롯 반납해 starve 방지. */
  remove: (chatId: number, threadKey: string) => void;
  /** 지금 이 thread 가 서빙 순번인가(라운드로빈·pending 중 가장 오래 안 서빙된 것). */
  isTurn: (chatId: number, threadKey: string) => boolean;
}

export function createGroupFairQueue(): GroupFairQueue {
  // chatId → 순환 대기열(FIFO·라운드로빈). served 시 맨 뒤로.
  const queues = new Map<number, string[]>();

  function q(chatId: number): string[] {
    let arr = queues.get(chatId);
    if (!arr) { arr = []; queues.set(chatId, arr); }
    return arr;
  }

  return {
    enqueue(chatId: number, threadKey: string): void {
      const arr = q(chatId);
      if (!arr.includes(threadKey)) arr.push(threadKey);
    },
    served(chatId: number, threadKey: string): void {
      const arr = q(chatId);
      const i = arr.indexOf(threadKey);
      if (i >= 0) { arr.splice(i, 1); arr.push(threadKey); } // 맨 뒤로(라운드로빈)
    },
    remove(chatId: number, threadKey: string): void {
      const arr = q(chatId);
      const i = arr.indexOf(threadKey);
      if (i >= 0) arr.splice(i, 1);
    },
    isTurn(chatId: number, threadKey: string): boolean {
      const arr = q(chatId);
      if (arr.length <= 1) return true; // 단일 thread = 항상 서빙(비-supergroup·비-forum 무영향)
      return arr[0] === threadKey; // 큐 맨 앞이 서빙 순번
    },
  };
}

// ── scroll-jump rotation (§10-2) ────────────────────────────────────────────────
// 텔레그램은 오래된(위로 스크롤된) 메시지를 편집하면 뷰포트가 점프. openclaw REPOSITION =
// 새 메시지 post → 옛 메시지 delete(편집 타겟을 항상 하단 근처로). MIN_PREVIEW_DWELL 로 빠른
// 턴의 flash 를 방지(옛 메시지가 dwell 이상 살았을 때만 rotate). 순수 판정.

export interface RotationConfig {
  /** rotate 최소 편집 횟수(이만큼 편집된 뒤에야 후보). 기본 8. */
  minEdits?: number;
  /** 옛 메시지 최소 생존(ms) — 빠른 턴 flash 방지. 기본 4000. */
  minDwellMs?: number;
  /** rotate 최소 간격(ms) — 과빈 rotate 방지. 기본 6000. */
  minGapMs?: number;
}

export interface RotationState {
  edits: number;
  createdAt: number;
  lastRotateAt: number;
}

/** 지금 rotate(post-new-then-delete) 해야 하는가. minEdits·dwell·gap 전부 충족 시 true. */
export function shouldRotate(state: RotationState, now: number, config: RotationConfig = {}): boolean {
  const minEdits = config.minEdits ?? 8;
  const minDwellMs = config.minDwellMs ?? 4000;
  const minGapMs = config.minGapMs ?? 6000;
  if (state.edits < minEdits) return false;
  if (now - state.createdAt < minDwellMs) return false;
  if (now - state.lastRotateAt < minGapMs) return false;
  return true;
}
