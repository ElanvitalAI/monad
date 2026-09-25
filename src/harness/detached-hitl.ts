// Detached HITL IPC — off/safe subprocess 위임 시 자식↔부모 양방향 HITL 릴레이 (#24 완결 · 2026-07-21)
//
// 배경: #24 A 는 auto_drive on(HITL 없음)만 하니스를 subprocess 로 위임했다(데몬 이벤트루프 격리).
//   off/safe 는 confirm/question(PR-open·apply-in-place diff·outside-home 승인)이 필요한데, subprocess
//   는 부모(데몬)가 쥔 **라이브 채널 객체**(telegram/discord bot 핸들·콜백서버)를 base64 payload 로
//   직렬화해 못 받는다. 그래서 off/safe 는 여태 인프로세스로 남아 implement 페이즈 동기 op 가 데몬
//   메인루프를 굶길 수 있었다. 이 모듈이 라인 프로토콜로 그 갭을 메운다:
//
//     자식 → 부모 (stdout): `HITLREQ:{id,kind,req}`  — 자식이 승인/질문 필요
//     부모 → 자식 (stdin) : `HITLRES:{id,kind,answer}` — 부모가 진짜 채널로 물어 답을 회신
//
//   자식엔 IPC-백드 ConfirmChannel/QuestionChannel 을 ctx.surfaceHitlChannels/QuestionChannels 로
//   심어, `surfaceUxFromDispatchCtx` → ux.confirm/question 이 **무변경**으로 동작(재발명 0). 부모는
//   자기 SurfaceUx.confirm/question(= 진짜 채널 race)으로 relay. 항상 응답(fail-closed 포함)해 자식이
//   안 매달리게. correlation id 로 다중 pending 을 구분한다.
//
// ★ 제1원칙 관측은 배선부(dispatch-detached·index run-detached)에서. 이 모듈은 순수 프로토콜/어댑터.

import type { ConfirmChannel, ConfirmRequest, HitlAnswer } from '../hitl/confirm.js';
import type { QuestionChannel } from '../hitl/question.js';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
} from '../ask-user-question/types.js';

export const HITL_REQ_PREFIX = 'HITLREQ:';
export const HITL_RES_PREFIX = 'HITLRES:';

export interface HitlReqMsg {
  id: string;
  kind: 'confirm' | 'question';
  req: ConfirmRequest | AskUserQuestionRequest;
}
export interface HitlResMsg {
  id: string;
  kind: 'confirm' | 'question';
  answer: HitlAnswer | AskUserQuestionResult | null;
}

/** 부모가 자식 HITLREQ 를 진짜 채널로 relay 하는 계약 — SurfaceUx 의 confirm/question 그 자체
 *  (재발명 0: 부모는 자기 surfaceUxFromDispatchCtx(ctx) 를 그대로 넘긴다). */
export interface HitlRelay {
  confirm(req: ConfirmRequest): Promise<boolean>;
  question(req: AskUserQuestionRequest): Promise<AskUserQuestionResult | null>;
}

export function encodeHitlReq(msg: HitlReqMsg): string {
  return `${HITL_REQ_PREFIX}${JSON.stringify(msg)}`;
}
export function encodeHitlRes(msg: HitlResMsg): string {
  return `${HITL_RES_PREFIX}${JSON.stringify(msg)}`;
}
export function parseHitlReq(line: string): HitlReqMsg | null {
  if (!line.startsWith(HITL_REQ_PREFIX)) return null;
  try {
    return JSON.parse(line.slice(HITL_REQ_PREFIX.length)) as HitlReqMsg;
  } catch {
    return null;
  }
}
export function parseHitlRes(line: string): HitlResMsg | null {
  if (!line.startsWith(HITL_RES_PREFIX)) return null;
  try {
    return JSON.parse(line.slice(HITL_RES_PREFIX.length)) as HitlResMsg;
  } catch {
    return null;
  }
}

/** 청크 스트림을 완전한 라인으로 자르는 버퍼 — HITLREQ/HITLRES JSON 이 청크 경계에서
 *  쪼개져도 안전하게 재조립(부분 라인 보존). '\n' 로만 종결된 라인을 콜백. */
export function makeLineBuffer(onLine: (line: string) => void): (chunk: string) => void {
  let buf = '';
  return (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
  };
}

// ── 자식측 ────────────────────────────────────────────────────────────
export interface DetachedHitlChild {
  /** ctx.surfaceHitlChannels 에 넣을 IPC-백드 확인 채널. */
  confirmChannel: ConfirmChannel;
  /** ctx.surfaceQuestionChannels 에 넣을 IPC-백드 질문 채널. */
  questionChannel: QuestionChannel;
  /** 부모 stdin 청크 → HITLRES 파싱 → 대응 pending resolve. */
  onStdinChunk: (chunk: string) => void;
}

/** 자식 프로세스에서 IPC-백드 HITL 채널을 만든다.
 *  @param emit stdout 에 HITLREQ 라인을 쓰는 함수(개행은 emit 이 붙임). */
export function createDetachedHitlChild(emit: (line: string) => void): DetachedHitlChild {
  const pending = new Map<string, (answer: HitlResMsg['answer']) => void>();
  let seq = 0;
  const nextId = (): string => `h${++seq}`;

  const onStdinChunk = makeLineBuffer((line) => {
    const res = parseHitlRes(line);
    if (!res) return;
    const resolve = pending.get(res.id);
    if (resolve) {
      pending.delete(res.id);
      resolve(res.answer);
    }
  });

  const request = (kind: 'confirm' | 'question', req: HitlReqMsg['req']): Promise<HitlResMsg['answer']> =>
    new Promise((resolve) => {
      const id = nextId();
      pending.set(id, resolve);
      emit(encodeHitlReq({ id, kind, req }));
    });

  const confirmChannel: ConfirmChannel = {
    name: 'detached-ipc',
    async request(req: ConfirmRequest): Promise<HitlAnswer | null> {
      const ans = await request('confirm', req);
      return typeof ans === 'boolean' ? ans : null;
    },
    cancel() {
      /* 부모 relay 가 진짜 채널 cancel 을 소유 — 자식측은 no-op. */
    },
  };
  const questionChannel: QuestionChannel = {
    name: 'detached-ipc',
    async ask(req: AskUserQuestionRequest): Promise<AskUserQuestionResult | null> {
      const ans = await request('question', req);
      return ans && typeof ans === 'object' ? (ans as AskUserQuestionResult) : null;
    },
    cancel() {
      /* no-op */
    },
  };
  return { confirmChannel, questionChannel, onStdinChunk };
}

// ── 부모측 ────────────────────────────────────────────────────────────
/** 부모: 자식 HITLREQ 라인 1건을 처리 → relay(진짜 채널) → HITLRES 회신.
 *  **항상** 응답한다(relay throw·미지원 kind 도 fail-closed 로 회신) → 자식이 매달리지 않음.
 *  @returns HITLREQ 라인이었으면 true(처리함), 아니면 false(다른 라인 — 호출자가 계속 처리). */
export async function handleHitlReqLine(
  line: string,
  relay: HitlRelay,
  sendToChild: (line: string) => void,
): Promise<boolean> {
  const req = parseHitlReq(line);
  if (!req) return false;
  let answer: HitlResMsg['answer'] = req.kind === 'confirm' ? false : null; // fail-closed 기본
  try {
    if (req.kind === 'confirm') answer = await relay.confirm(req.req as ConfirmRequest);
    else if (req.kind === 'question') answer = await relay.question(req.req as AskUserQuestionRequest);
  } catch {
    answer = req.kind === 'confirm' ? false : null;
  }
  sendToChild(encodeHitlRes({ id: req.id, kind: req.kind, answer }));
  return true;
}
