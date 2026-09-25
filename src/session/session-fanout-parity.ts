// ── cutover parity 하니스 (PLAN-session-fabric-cutover §C0 · 2026-07-16) ──────────
//
// shadow 모드에서 새 fan-out 경로가 옛 배달 경로와 **같은 수신자·유실 없는 내용**을 내는지
// turn 마다 대조 관측(session.parity). 위험 0 — 관측만(배달 무변경). 이게 cutover 의 안전
// 장치: 메시지 유실(완전/수신자 불일치/빈 내용)이 실사용자 영향 없이 **flip 前 로그 신호**로 뜬다.
//
// 불변식(PLAN §7): 서피스 flip 은 parity 가 burn-in 동안 green 이어야 허용. 이 모듈이 그 green
// 신호(recipientMatch + contentOk)를 생산한다. C0 는 **수신자셋 대조 + 내용 비어있음/degraded**
// 를 다룬다(옛 경로 실배달 바이트와의 청크 대조는 옛 sink 인터셉트가 필요 → C0 후속·ACP용).

import { type SessionMeta } from './index.js';
import { recordSessionObservation, type SessionObservationSinks } from './session-observation.js';
import { telegramEndpointKey, discordEndpointKey, telegramOldPathTarget } from './session-endpoint-key.js';

/** 옛 배달 경로가 타겟하는 수신자 키 — **완전 스코프 키**(C2 승격). autoSubscribeOldPath 와
 *  동일한 telegram/discordEndpointKey 를 써 `<surface>:<endpoint>` 키가 정확히 일치 →
 *  parity 수신자 매칭 + shadow excludeKeys 중복방지가 성립. bindings.telegram(attach) OR
 *  tgChatId(auto-created origin) · discord · cli. 멀티봇·인스턴스 분리를 한 방어선으로. */
export function oldPathRecipientKeys(meta: SessionMeta): string[] {
  const keys = new Set<string>();
  const tg = telegramOldPathTarget(meta);
  if (tg) keys.add(`telegram:${telegramEndpointKey(tg)}`);
  if (meta.bindings?.discord) keys.add(`discord:${discordEndpointKey({ channelId: meta.bindings.discord.channelId })}`);
  if (meta.bindings?.cli) keys.add('cli:local');
  return [...keys];
}

/** @deprecated C1 에서 oldPathRecipientKeys 로 대체(tgChatId 포함). */
export const bindingRecipientKeys = oldPathRecipientKeys;

export interface ParityInput {
  sessionId: string;
  surface?: string;
  /** 새 fan-out 이 배달할 구독자 키(active/grace·excludeKeys 제외). */
  newRecipients: string[];
  /** 옛 경로(바인딩)가 배달할 대상 키. */
  oldRecipients: string[];
  /** 추출 내용 길이(0 = 완전 유실 위험). */
  contentLen: number;
  /** 내용 추출 실패/폴백(부분 유실 위험). */
  degraded?: boolean;
}

export interface ParityResult {
  /** 수신자셋 정확 일치(옛==새) — 정보용(엄격). */
  recipientMatch: boolean;
  /** 내용 정상(비어있지 않고 degraded 아님). */
  contentOk: boolean;
  /** 옛엔 있는데 새 fan-out 이 놓친 대상 — **메시지 유실 후보**(cutover 안전의 핵심). */
  missingInNew: string[];
  /** 새에만 있는 대상(추가 구독자 — 새 능력이지 유실 아님·shadow 정상). */
  extraInNew: string[];
  /** **flip 안전 신호** = 유실 없음(missingInNew 빈) + 내용 정상. extra 는 무해. */
  green: boolean;
}

function setDiff(a: string[], b: string[]): string[] {
  const bs = new Set(b);
  return a.filter((x) => !bs.has(x));
}

/**
 * parity 대조 + session.parity 관측. green(recipientMatch && contentOk)이 flip 안전 신호.
 * mismatch 는 importance 상향(셀프힐/대표 관심). 순수 판정 + fail-soft 관측.
 */
export function recordFanoutParity(input: ParityInput, sinks: SessionObservationSinks = {}): ParityResult {
  const missingInNew = setDiff(input.oldRecipients, input.newRecipients);
  const extraInNew = setDiff(input.newRecipients, input.oldRecipients);
  const recipientMatch = missingInNew.length === 0 && extraInNew.length === 0;
  const contentOk = input.contentLen > 0 && !input.degraded;
  // flip 안전 = 유실 없음(no missing) + 내용 정상. extra(추가 구독자)는 새 능력이지 유실 아님.
  const green = missingInNew.length === 0 && contentOk;

  recordSessionObservation({
    sessionId: input.sessionId,
    subsystem: 'parity',
    event: green ? 'green' : 'loss',
    ...(input.surface ? { surface: input.surface } : {}),
    rationale: green
      ? `parity green (유실 0·수신자 ${input.newRecipients.length}·내용 ${input.contentLen}자${extraInNew.length ? `·추가 ${extraInNew.length}` : ''})`
      : `parity LOSS — ${missingInNew.length ? `유실 ${missingInNew.join(',')}` : ''}${!contentOk ? ` 내용유실(len=${input.contentLen}${input.degraded ? '·degraded' : ''})` : ''}`,
    ...(green ? {} : { importance: 5 }),
    refs: { missingInNew, extraInNew, contentLen: input.contentLen, recipientMatch, contentOk },
  }, sinks);

  return { recipientMatch, contentOk, missingInNew, extraInNew, green };
}

// ── C5 청크 parity — 스트림 누적 vs 최종 메시지 대조 (2026-07-16) ──────────────────
//
// C0 메시지레벨 parity 의 스트리밍판. 청크 producer(fan-out)가 스트림 중 누적한 텍스트가
// 턴 완료 메시지(onAppend·진실)와 일치하는지 대조 → **청크 유실 감지**(ContentBlock 버그의
// C5 대응). green = 내용 충실(청크 유실 0) + 수신자 유실 0. flip 안전 신호(설계 §7-4·§9).
// ⚠️ 정확한 편집 타이밍(스트리밍 보존·§7-5)은 별도 — 여기선 누적 내용 + 수신자.

export interface ChunkParityInput {
  sessionId: string;
  streamId: string;
  surface?: string;
  /** fan-out 이 스트림 중 누적한 텍스트(청크 델타 합). */
  streamedText: string;
  /** 턴 완료 메시지 텍스트(진실·onAppend). */
  finalText: string;
  /** 청크 스트림 수신 구독자(선택·수신자 대조용). */
  newRecipients?: string[];
  /** 옛 streamer 배달 대상(선택). */
  oldRecipients?: string[];
}

export interface ChunkParityResult {
  /** 누적 스트림 == 최종 메시지(공백 정규화) — 청크 유실 없음. */
  contentFaithful: boolean;
  /** 옛엔 있는데 청크 fan-out 이 놓친 수신자. */
  missingInNew: string[];
  green: boolean;
}

/** 공백 정규화(스트리밍은 부분 청크라 trailing/중복 공백 차이 무해). */
function normText(s: string): string { return s.replace(/\s+/g, ' ').trim(); }

/** 청크 내용 충실 판정 — 스트림 누적이 최종과 같거나 **최종의 prefix**면 green(청크 유실 없음).
 *  finalize 에 footer/서식이 덧붙는 건 정상(스트림 델타 ⊆ 최종). 중간 청크 유실은 prefix 깨져 감지. */
function chunkContentFaithful(streamed: string, final: string): boolean {
  const s = normText(streamed), f = normText(final);
  if (s.length === 0) return f.length === 0;      // 둘 다 비면 무해
  if (f === s) return true;                        // 완전 동일
  // 스트림이 최종의 prefix + 대부분 커버(≥85%) → footer/서식 델타 허용. 중간 청크 유실(prefix 깨짐)·
  // 대량 유실(비율 낮음)은 red. 최종 배달은 onFinal 이 완전 텍스트로 항상 보정하므로 이는 스트리밍
  // 프리뷰 품질 신호.
  return f.startsWith(s) && s.length / f.length >= 0.85;
}

/**
 * 청크 parity 대조 + session.chunk-parity 관측. green(내용 충실 + 수신자 유실 0)이 스트리밍 flip
 * 안전 신호. 순수 판정 + fail-soft 관측.
 */
export function recordChunkParity(input: ChunkParityInput, sinks: SessionObservationSinks = {}): ChunkParityResult {
  const contentFaithful = chunkContentFaithful(input.streamedText, input.finalText);
  const missingInNew = setDiff(input.oldRecipients ?? [], input.newRecipients ?? []);
  const green = contentFaithful && missingInNew.length === 0;

  recordSessionObservation({
    sessionId: input.sessionId,
    subsystem: 'chunk-parity',
    event: green ? 'green' : 'loss',
    ...(input.surface ? { surface: input.surface } : {}),
    rationale: green
      ? `chunk parity green (내용충실·누적 ${input.streamedText.length}자·최종 ${input.finalText.length}자)`
      : `chunk parity LOSS — ${!contentFaithful ? `내용불일치(누적 ${input.streamedText.length} vs 최종 ${input.finalText.length})` : ''}${missingInNew.length ? ` 수신자유실 ${missingInNew.join(',')}` : ''}`,
    ...(green ? {} : { importance: 5 }),
    refs: { streamId: input.streamId, contentFaithful, missingInNew, streamedLen: input.streamedText.length, finalLen: input.finalText.length },
  }, sinks);

  return { contentFaithful, missingInNew, green };
}
