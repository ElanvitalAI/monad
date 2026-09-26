// ── Self-Awareness Memory (2026-07-08 · P1 MVP) ───────────────────────────
//
// 문제: Claude Code·Codex 등 외부 도구가 elanous 자체의 루프/로직을 바꾸거나 기능을
// 구현해도, 정작 elanous(자율 데몬/에이전트)는 그 맥락을 모른다(self-awareness 갭).
//
// 해결: 외부 도구가 "무엇을 구현/변경했나"(+남긴 문서)를 elanous 기억에 **주입**하고,
// elanous 가 그것을 **회상**하게 하는 얇은 계층. 새 저장소를 만들지 않고 기존 이중 기억을
// 재사용한다:
//   - 에피소드(해마): surface_events (surface='ext:<tool>'·direction='inbound'·
//     kind='impl'·domain='elanous'). recordEvent 재사용 → memory_recall(domain='elanous')로 회상.
//   - 의미(신피질): knowledge.db (kind='docs'·domain='elanous'). ingestDocFile 로 문서 벡터화
//     → finance_knowledge(domain='elanous') / 벡터 회상.
//
// P1(MVP·이 파일): 주입 함수(recordSelfEvent·injectSelfMemory) + 회상(recallSelfEvents) +
//   CLI(elanous self log/recall). P2=HTTP /v1/self-event + LLM 도구 · P3=스킬 · P4=데몬 ambient.
//
// 거버넌스: 순수 기록·회상(READ-ONLY 회상). 매매/발송과 무관·격리(domain='elanous').

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { recordEvent, recallEvents, openSurfaceEventsDb, surfaceEventsDbPath, type RecallHit } from './surface-events.js';
import { provenanceRefs, provenanceTags, type Provenance } from './provenance.js';
import { openKnowledgeDb, ingestDocFile, type EmbedFn } from './knowledge.js';
import { debug } from '../debug/log.js';
import { within } from '../time/db-window.js';

/** self-awareness 기억의 공유 도메인 축(finance 신호와 격리). */
export const SELF_DOMAIN = 'elanous';
/** 기본 이벤트 kind. */
export const SELF_KIND = 'impl';
/** 기본 현저성 — 구현/변경은 중요(alert 급). */
export const SELF_IMPORTANCE = 7;

export interface SelfEventInput {
  /** 주입한 외부 도구 — 'claude-code' | 'codex' | 'skill' | … (surface='ext:<tool>'). */
  tool: string;
  /** 1-2줄 요약 — "무엇을 구현/변경했나"(회상 relevance 핵심). */
  summary: string;
  /** 상세 본문(선택 — 기본 summary). */
  text?: string;
  /** impl | change | fix | design | refactor (기본 impl). */
  kind?: string;
  /** 크로스 참조(PR·branch·files 등) — refs JSON 으로 저장. */
  refs?: Record<string, unknown>;
  /** 0-10 현저성(기본 7). */
  importance?: number;
  /** 함께 인제스트할 문서 경로(HANDOFF/REPORT/PLAN 등·선택). */
  docPath?: string;
  /** ★ 미션 귀속(apm_id·선택) — 외부 변경을 미션에 링크해 미션 종합 히스토리에 합류(RFC L1·2026-07-15). */
  missionId?: string;
}

/** 외부 도구의 구현/변경 이벤트를 self-awareness 에피소드 기억(surface_events)에 기록.
 *  recordEvent 얇은 래퍼 — domain='elanous'·category='awareness'·direction='inbound'. */
export function recordSelfEvent(db: Database, input: SelfEventInput, opts: { now?: () => string } = {}): string {
  // 미션 귀속 시 refs.missionId(구조 조회) + tags mission:<id>(FTS/grep) 둘 다에 심어 미션 히스토리 합류.
  const refs = input.missionId ? { ...(input.refs ?? {}), missionId: input.missionId } : input.refs;
  const tags = [
    ...(input.docPath ? [`doc:${basename(input.docPath)}`] : []),
    ...(input.missionId ? [`mission:${input.missionId}`] : []),
  ];
  return recordEvent(db, {
    surface: `ext:${input.tool}`,
    direction: 'inbound',
    kind: input.kind ?? SELF_KIND,
    text: input.text ?? input.summary,
    summary: input.summary,
    importance: input.importance ?? SELF_IMPORTANCE,
    domain: SELF_DOMAIN,
    category: 'awareness',
    ...(refs ? { refs: JSON.stringify(refs) } : {}),
    ...(tags.length ? { tags: tags.join(' ') } : {}),
    ...(opts.now ? { ts: opts.now() } : {}),
  });
}

export interface UtteranceInput {
  /** 발화 원문. */
  text: string;
  /** 발화 주체 — claude-code | codex | gemini | elanous-self | … */
  origin: string;
  sessionId?: string;
  gitHash?: string;
  branch?: string;
  cwd?: string;
  /** ISO 시간(기본 now). */
  ts?: string;
  importance?: number;
}

/** 외부/자기 발화를 surface_events 에 **provenance 태그와 함께** 기록(inbound·kind='utterance').
 *  회상이 origin/git/branch/cwd/시간으로 "누가 언제 어디서" 발화했나 구분. domain='elanous'.
 *  Claude Code/Codex/Gemini hook 이 `elanous self utterance` CLI 로 호출 → 이 함수. */
export function injectUtterance(input: UtteranceInput, db?: Database): { eventId: string } {
  const prov: Provenance = {
    origin: input.origin,
    ...(input.gitHash ? { gitHash: input.gitHash } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
  const provenanceTag = provenanceTags(prov);
  const observerClassification = classifyRecalledObserverOutput({ surface: `ext:${input.origin}`, tags: provenanceTag, text: input.text });
  const tags = [
    provenanceTag,
    ...(observerClassification === 'observer-generated' ? ['observer-generated'] : []),
  ].join(' ');
  const d = db ?? openSurfaceEventsDb();
  try {
    const eventId = recordEvent(d, {
      surface: `ext:${input.origin}`,
      direction: 'inbound',
      kind: 'utterance',
      category: 'utterance',
      domain: SELF_DOMAIN,
      text: input.text,
      summary: input.text.slice(0, 150),
      importance: input.importance ?? 5,
      refs: provenanceRefs(prov),
      tags,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.ts ? { ts: input.ts } : {}),
    });
    // 제1원칙 관측 — 외부 도구 발화 ingress 가 logs.db 에 닿게(memory 이벤트만으론 `elanous logs` 조회 불가).
    // fail-open: 관측 실패가 기억 편입을 막지 않음.
    try {
      debug.log('memory.utterance', 'ingress', {
        eventId,
        origin: input.origin,
        chars: input.text.length,
        observerGenerated: observerClassification === 'observer-generated' ? 1 : 0,
        unclassifiable: observerClassification === 'unknown' ? 1 : 0,
        ...(prov.branch ? { branch: prov.branch } : {}),
        ...(prov.gitHash ? { gitHash: prov.gitHash } : {}),
        ...(prov.cwd !== undefined ? { cwd: prov.cwd } : {}),
        ...(prov.sessionId ? { sessionId: prov.sessionId } : {}),
      });
    } catch { /* fail-open */ }
    return { eventId };
  } finally { if (!db) d.close(); }
}

/**
 * 미션 귀속 외부 변경 조회(RFC L1) — surface_events domain=elanous 에서 refs.missionId===missionId
 * 이벤트를 최근순으로. buildMissionHistory 의 external 소스가 소비. 순수 조회.
 */
export function listMissionExternalChanges(
  db: Database, missionId: string, opts: { sinceHours?: number; limit?: number } = {},
): Array<{ ts: string; tool: string; kind: string; summary: string; refs: Record<string, unknown> }> {
  const sinceHours = opts.sinceHours ?? 24 * 90;
  // ★ 진짜 외부 도구(claude-code/codex/skill)만 — 미션 자율 엔진(ext:autopilot·ext:mission)의
  //   페이즈 텔레메트리는 revision 타임라인이 이미 담으므로 제외(외부 변경 뷰 노이즈 방지).
  const rows = db.prepare(
    `SELECT ts, surface, kind, summary, text, refs FROM events
     WHERE domain=? AND refs LIKE ? AND ${within('ts')}
       AND surface NOT IN ('ext:autopilot', 'ext:mission', 'ext:se')
     ORDER BY ts DESC LIMIT ?`,
  ).all(SELF_DOMAIN, `%"missionId":"${missionId}"%`, `-${sinceHours} hours`, opts.limit ?? 100) as Array<{ ts: string; surface: string; kind: string | null; summary: string | null; text: string; refs: string | null }>;
  return rows.map((r) => {
    let refs: Record<string, unknown> = {};
    try { refs = JSON.parse(r.refs ?? '{}'); } catch { /* raw */ }
    return { ts: r.ts, tool: r.surface.replace(/^ext:/, ''), kind: r.kind ?? 'change', summary: (r.summary ?? r.text ?? '').trim(), refs };
  });
}

export type RecalledObserverOutput = 'observer-generated' | 'not-observer-generated' | 'unknown';

/**
 * Identifies recall entries emitted by the observation machinery itself without changing recall membership.
 * A missing or blank text and summary leaves the item unclassifiable rather than treating it as non-self output.
 */
export function classifyRecalledObserverOutput(hit: { surface?: unknown; tags?: unknown; text?: unknown; summary?: unknown }): RecalledObserverOutput {
  const contents = [hit.text, hit.summary].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (contents.length === 0) return 'unknown';
  // Frame-memory producers label their own observation output as `ext:tui-observe`.
  // Do not add surface-prefix text guesses here: new observer surfaces retain this producer mark.
  if (hit.surface === 'ext:tui-observe') return 'observer-generated';
  // Only explicit utterance provenance can override legacy observer syntax. Other ext:
  // producers still need the compatibility checks below.
  if (typeof hit.tags === 'string' && /(?:^|\s)origin:(?:claude-code|codex|gemini)(?:\s|$)/.test(hit.tags)) return 'not-observer-generated';
  return contents.some((value) => value.startsWith('<task-notification>') || /pty_[0-9a-f]+:/i.test(value))
    ? 'observer-generated'
    : 'not-observer-generated';
}

/** self-awareness 기억 회상 — surface_events domain='elanous' 에피소드(READ-ONLY·결정론).
 *  "내가 최근 뭘 구현했지" 질의. 벡터(docs) 회상은 finance_knowledge(domain='elanous')가 담당. */
export function recallSelfEvents(db: Database, query: string, opts: { sinceHours?: number; limit?: number; bump?: boolean; excludeObserverOutput?: boolean } = {}): RecallHit[] {
  const sinceHours = opts.sinceHours ?? 24 * 30; // 기본 30일(구현 이력은 오래 유의)
  const limit = opts.limit ?? 8;
  // `recallEvents` reranks at most 60 candidates. When observer output is excluded,
  // retrieve that candidate set before applying the caller's limit so excluded top hits
  // do not leave intentional memories undisclosed.
  const recallLimit = opts.excludeObserverOutput ? Math.max(limit, 60) : limit;
  const hits = recallEvents(db, {
    query,
    domain: SELF_DOMAIN,
    sinceHours,
    limit: recallLimit,
    // An expanded candidate query must not strengthen excluded or limit-trimmed memories.
    ...(opts.excludeObserverOutput ? { bump: false } : (opts.bump === undefined ? {} : { bump: opts.bump })),
  });
  // ⛔⭐⭐⭐ **이 자리에 관측이 «하나도» 없었다**(2026-08-19 · `OBS-T117`).
  //
  // 🚨 왜 중요한가 — 「회상」에 진입 경로가 «둘»인데 ***한쪽만 계측돼 있었다***:
  //   계측됨    `dispatchSelfRecall`(툴) · `searchMemories`(파일 기억)
  //   ***안 됨***  ***이 함수*** — 그런데 이걸 부르는 자리가 «넷»이고 그중에
  //     ⓐ ***1급 CLI `elanous self recall`***          (CLAUDE.md 가 «이걸 쓰라»고 말하는 그 명령)
  //     ⓑ ***자식의 기억 컨텍스트***(`recallMemoryContext`) ← 「자식이 기억을 갖나」의 «진짜» 경로
  //   ⇒ 📌 즉 ***가장 알고 싶은 두 경로가 정확히 안 보이는 쪽에 있었다***(`F12`).
  // ⭐ 그리고 「몇 건 받았나」와 「어느 창에서 찾았나」를 «같이» 남긴다 —
  //   0건의 이유가 「기억이 없어서」인지 「창이 좁아서」인지 갈린다(`F43`).
  const classifiedHits = hits.map((hit) => ({ hit, classification: classifyRecalledObserverOutput(hit) }));
  const observerOutputCounts = classifiedHits.reduce((counts, { classification }) => {
    if (classification === 'observer-generated') counts.observerGenerated += 1;
    if (classification === 'unknown') counts.unclassifiable += 1;
    return counts;
  }, { observerGenerated: 0, unclassifiable: 0 });
  // `preFilterHits` is the expanded candidate set; `postFilterHits` is the
  // observer-filtered set before the caller's requested return limit.
  const preFilterHits = hits.length;
  const postFilterCandidates = opts.excludeObserverOutput
    ? classifiedHits.filter(({ classification }) => classification !== 'observer-generated').map(({ hit }) => hit)
    : hits;
  const postFilterHits = postFilterCandidates.length;
  const returnedHits = postFilterCandidates.slice(0, limit);
  const excludedObserverOutput = preFilterHits - postFilterHits;
  // Preserve recall's default strengthening semantics, but only for entries actually returned.
  if (opts.excludeObserverOutput && opts.bump !== false && returnedHits.length) {
    const ids = returnedHits.map((hit) => hit.id);
    db.prepare(`UPDATE events SET recall_count = recall_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    for (const hit of returnedHits) hit.recall_count = (hit.recall_count ?? 0) + 1;
  }
  try {
    debug.log('agent.source', 'recall-result', {
      kind: 'self-events', hits: returnedHits.length, limit, sinceHours,
      preFilterHits, postFilterHits,
      observerGenerated: observerOutputCounts.observerGenerated,
      unclassifiable: observerOutputCounts.unclassifiable,
      excludedObserverOutput,
    });
  } catch { /* fail-open — 관측이 회상을 막지 않는다 */ }
  return returnedHits;
}

/** ★ P4 데몬 ambient — 최근 elanous(자기) 구현/변경 요약(빈 문자열=변경 없음). Block5 자매:
 *  발송(recentSentDigest)이 "내가 뭘 보냈나"라면 이건 "외부 도구가 내 코드를 뭘 바꿨나".
 *  systemPrompt 주입용·bounded. domain=elanous 이벤트만(격리). */
export function recentSelfChangesDigest(db: Database, opts: { sinceHours?: number; limit?: number } = {}): string {
  const sinceHours = opts.sinceHours ?? 24 * 7; // 구현은 발송보다 저빈도 → 기본 1주
  const limit = opts.limit ?? 5;
  // ★ kind='utterance'(외부 도구 발화 ingress·PR#4619 훅) 제외 — 이 다이제스트는 "구현/변경"
  //   자기인지용인데, 대표 프롬프트 원문이 섞이면 impl 이력을 밀어내 라벨↔내용 불일치(회귀).
  //   발화 회상은 self_recall/utterance 채널이 담당(관심사 분리).
  const rows = db.prepare(
    `SELECT ts, surface, kind, summary, text FROM events
     WHERE domain=? AND ${within('ts')} AND kind != 'utterance'
     ORDER BY ts DESC LIMIT ?`,
  ).all(SELF_DOMAIN, `-${sinceHours} hours`, limit) as Array<{ ts: string; surface: string; kind: string | null; summary: string | null; text: string }>;
  if (rows.length === 0) return '';
  const day = (iso: string): string => {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
    catch { return '?'; }
  };
  const line = (r: { ts: string; surface: string; kind: string | null; summary: string | null; text: string }): string => {
    const body = ((r.summary && r.summary.trim()) ? r.summary : r.text).replace(/\s+/g, ' ').trim().slice(0, 100);
    const tool = r.surface.replace(/^ext:/, '');
    return `- [${day(r.ts)} ${tool}${r.kind ? `·${r.kind}` : ''}] ${body}`;
  };
  const days = Math.round(sinceHours / 24);
  return `최근 elanous(나 자신)에 반영된 구현/변경 (최근 ${days}일 · 외부 도구가 내 코드/루프를 바꾼 이력 · 이걸 알고 답하라 · 더 필요하면 self_recall):\n${rows.map(line).join('\n')}`;
}

/** recentSelfChangesDigest 의 db 래퍼 — 매 턴 fresh·fail-soft(주입 실패가 답변을 막지 않음).
 *  전 표면 systemPrompt 에 도메인 무관하게 주입(finance 게이트 아님·self-awareness 코어). */
export function recentSelfChangesContext(): string {
  try {
    if (!existsSync(surfaceEventsDbPath())) return '';
    const db = openSurfaceEventsDb();
    try { return recentSelfChangesDigest(db); } finally { db.close(); }
  } catch { return ''; }
}

// ── 능력(자원) 등록 채널 (2026-07-14) ────────────────────────────────────────
//
// 갭: 미션은 "실행됐다(서사)"는 self-awareness 에 자동으로 남기지만, "무엇을 만들었나(능력·모듈·CLI·
// 툴)"는 어느 registry 에도 전역 인지에도 구조적으로 안 남긴다(능력 catalog 는 정적 손배선·산출
// 데이터는 미션과 함께 소멸). → 누가 만들었든(미션 자율 빌드 or 외부 도구 수습) "미션 귀속 + 태깅 +
// 자기인지 등록"이 성립하는 정식 통로. 새 저장소 없이 surface_events(domain=elanous·kind=capability)
// 재사용 → self recall 과 능력 조회가 같은 척추에서 잡는다(self-awareness 무결).

/** 능력 이벤트 kind — self recall 은 이걸 포함해 회상, listCapabilities 는 이것만 조회. */
export const CAPABILITY_KIND = 'capability';

/** 능력 라이프사이클 상태 — append-supersede(로그 무결·최신 이벤트가 현재 상태). */
export type CapabilityStatus = 'active' | 'superseded' | 'removed';

export interface CapabilityInput {
  /** 능력 이름 — 라이프사이클 키(같은 name = 같은 능력·update/remove 대상). */
  name: string;
  /** 무엇을 하는 능력인가 — 1-2줄. */
  summary: string;
  /** 귀속 미션 id(자율/외부 무관 — 이 능력이 어느 미션 골에 속하나). */
  missionId?: string;
  /** 산출 PR URL(들). */
  prUrls?: readonly string[];
  /** 추가/변경 핵심 파일·export. */
  files?: readonly string[];
  /** ★ 자원 핸들 — 이 능력이 만든 크론(elanous schedule id). 삭제/수정 라우팅용. */
  scheduleIds?: readonly string[];
  /** ★ 자원 핸들 — 이 능력이 만든 태스크(elanous autopilot/task id). */
  taskIds?: readonly string[];
  /** ★ 노출한 CLI(예: "elanous local inventory"). */
  cliCommand?: string;
  /** 라이프사이클 상태(기본 active). removed/superseded 로 논리 삭제·교체. */
  status?: CapabilityStatus;
  /** 만든 주체 — 'mission'(자율 빌드) | 'external:<tool>'(외부 수습·미션 귀속). 기본 mission. */
  source?: string;
  /** 함께 인제스트할 문서(FEATURE/HANDOFF 등). */
  docPath?: string;
  importance?: number;
}

export interface CapabilityRecord {
  ts: string;
  name: string;
  summary: string;
  status: CapabilityStatus;
  missionId?: string;
  prUrls: string[];
  files: string[];
  scheduleIds: string[];
  taskIds: string[];
  cliCommand?: string;
  source: string;
}

/**
 * 미션/외부가 만든 "능력(자원)"을 self-awareness 에 정식 등록. injectSelfMemory 재사용(kind=capability).
 * 귀속(missionId)·PR·파일·**자원 핸들(scheduleIds·taskIds·cli)**·상태를 refs 로 구조화 → self recall +
 * listCapabilities 가 잡고, 핸들로 삭제/수정을 기존 CRUD(elanous schedule·autopilot)에 라우팅한다.
 * update/remove 는 같은 name 으로 재기록(append-supersede·로그 무결). 외부 도구 산출도 source=external:<tool>
 * + missionId 로 **미션 귀속** 등록(목표: 누가 만들었든 미션 자원·스스로 인지·라이프사이클 관리).
 */
export async function recordCapability(
  input: CapabilityInput,
  deps: { sdb?: Database; kdb?: Database; embed?: EmbedFn } = {},
): Promise<InjectResult> {
  const sdb = deps.sdb ?? openSurfaceEventsDb();
  const ownSdb = !deps.sdb;
  try {
    // ★ 이전 동명 능력에서 핸들 승계 — update/remove 가 컨텍스트(크론·태스크·PR·미션 귀속)를 보존해야
    //   "이 능력을 지운다 → 그 크론/태스크도 안다"가 성립(삭제 라우팅). 명시 입력이 우선.
    const prior = listCapabilities(sdb, { includeRemoved: true }).find((c) => c.name === input.name);
    const pick = <T>(a: T | undefined, b: T | undefined): T | undefined => (a !== undefined ? a : b);
    const nonEmpty = (a: readonly string[] | undefined, b: string[] | undefined): string[] | undefined => {
      const v = a && a.length ? [...a] : b; return v && v.length ? v : undefined;
    };
    const missionId = pick(input.missionId, prior?.missionId);
    const prUrls = nonEmpty(input.prUrls, prior?.prUrls);
    const files = nonEmpty(input.files, prior?.files);
    const scheduleIds = nonEmpty(input.scheduleIds, prior?.scheduleIds);
    const taskIds = nonEmpty(input.taskIds, prior?.taskIds);
    const cliCommand = pick(input.cliCommand, prior?.cliCommand);
    const source = input.source ?? prior?.source ?? 'mission';
    const tool = source.startsWith('external:') ? source.slice('external:'.length) : (source ?? 'autopilot');
    const status = input.status ?? 'active';
    const tag = status === 'removed' ? '[능력·제거]' : status === 'superseded' ? '[능력·교체]' : '[능력]';
    return await injectSelfMemory({
      tool,
      kind: CAPABILITY_KIND,
      summary: `${tag} ${input.name} — ${input.summary}`,
      importance: input.importance ?? 8,
      ...(input.docPath ? { docPath: input.docPath } : {}),
      refs: {
        capability: input.name,
        status,
        ...(missionId ? { missionId } : {}),
        ...(prUrls ? { prUrls } : {}),
        ...(files ? { files } : {}),
        ...(scheduleIds ? { scheduleIds } : {}),
        ...(taskIds ? { taskIds } : {}),
        ...(cliCommand ? { cliCommand } : {}),
        source,
      },
    }, { sdb, ...(deps.kdb ? { kdb: deps.kdb } : {}), ...(deps.embed ? { embed: deps.embed } : {}) });
  } finally { if (ownSdb) sdb.close(); }
}

/**
 * recordCapability 의 sync 버전(문서 인제스트 없음) — sync 컨텍스트(mergeMissionPhases 등 자동 훅)용.
 * 동명 핸들 승계 + recordSelfEvent(sync). db 미주입 시 기본 경로 오픈/클로즈. fail-soft 는 호출측이.
 */
export function recordCapabilitySync(input: CapabilityInput, deps: { sdb?: Database } = {}): string {
  const sdb = deps.sdb ?? openSurfaceEventsDb();
  const ownSdb = !deps.sdb;
  try {
    const prior = listCapabilities(sdb, { includeRemoved: true }).find((c) => c.name === input.name);
    const pick = <T>(a: T | undefined, b: T | undefined): T | undefined => (a !== undefined ? a : b);
    const ne = (a: readonly string[] | undefined, b: string[] | undefined): string[] | undefined => {
      const v = a && a.length ? [...a] : b; return v && v.length ? v : undefined;
    };
    const source = input.source ?? prior?.source ?? 'mission';
    const tool = source.startsWith('external:') ? source.slice('external:'.length) : 'autopilot';
    const status = input.status ?? 'active';
    const tag = status === 'removed' ? '[능력·제거]' : status === 'superseded' ? '[능력·교체]' : '[능력]';
    const missionId = pick(input.missionId, prior?.missionId);
    const prUrls = ne(input.prUrls, prior?.prUrls);
    const files = ne(input.files, prior?.files);
    const scheduleIds = ne(input.scheduleIds, prior?.scheduleIds);
    const taskIds = ne(input.taskIds, prior?.taskIds);
    const cliCommand = pick(input.cliCommand, prior?.cliCommand);
    return recordSelfEvent(sdb, {
      tool, kind: CAPABILITY_KIND,
      summary: `${tag} ${input.name} — ${input.summary}`,
      importance: input.importance ?? 8,
      refs: {
        capability: input.name, status,
        ...(missionId ? { missionId } : {}), ...(prUrls ? { prUrls } : {}), ...(files ? { files } : {}),
        ...(scheduleIds ? { scheduleIds } : {}), ...(taskIds ? { taskIds } : {}), ...(cliCommand ? { cliCommand } : {}),
        source,
      },
    });
  } finally { if (ownSdb) sdb.close(); }
}

/**
 * 등록된 능력 조회 — surface_events domain=elanous kind=capability. name 으로 dedupe(최신 이벤트=현재 상태·
 * append-supersede). 기본 removed 제외(includeRemoved 로 포함). missionId 필터. READ-ONLY·결정론.
 */
export function listCapabilities(db: Database, opts: { missionId?: string; includeRemoved?: boolean; limit?: number } = {}): CapabilityRecord[] {
  const rows = db.prepare(
    // ts DESC + rowid DESC 타이브레이크 — 같은 초에 기록된 update/remove 도 최신(나중 삽입)이 이김.
    `SELECT ts, summary, text, refs FROM events WHERE domain=? AND kind=? ORDER BY ts DESC, rowid DESC LIMIT ?`,
  ).all(SELF_DOMAIN, CAPABILITY_KIND, opts.limit ?? 500) as Array<{ ts: string; summary: string | null; text: string; refs: string | null }>;
  const byName = new Map<string, CapabilityRecord>();
  for (const r of rows) { // ts DESC → 첫 등장이 최신
    let refs: Record<string, unknown> = {};
    try { refs = r.refs ? JSON.parse(r.refs) as Record<string, unknown> : {}; } catch { /* skip malformed */ }
    if (opts.missionId && refs.missionId !== opts.missionId) continue;
    const summary = (r.summary ?? r.text).replace(/^\[능력(·제거|·교체)?\]\s*/, '');
    const name = typeof refs.capability === 'string' ? refs.capability : summary.split(' — ')[0]!;
    if (byName.has(name)) continue; // 이미 최신 상태 확보(구 이벤트 스킵)
    const status = (refs.status === 'removed' || refs.status === 'superseded') ? refs.status : 'active';
    const strArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    byName.set(name, {
      ts: r.ts, name, summary, status,
      ...(typeof refs.missionId === 'string' ? { missionId: refs.missionId } : {}),
      prUrls: strArr(refs.prUrls), files: strArr(refs.files),
      scheduleIds: strArr(refs.scheduleIds), taskIds: strArr(refs.taskIds),
      ...(typeof refs.cliCommand === 'string' ? { cliCommand: refs.cliCommand } : {}),
      source: typeof refs.source === 'string' ? refs.source : 'mission',
    });
  }
  return [...byName.values()].filter((c) => opts.includeRemoved || c.status !== 'removed');
}

export interface InjectResult { eventId: string; docChunks: number; docSkipped: number }

/** 전체 주입 오케스트레이션 — 이벤트 기록(항상) + docPath 있으면 문서 벡터 인제스트(fail-soft).
 *  db 미주입 시 기본 경로 오픈/클로즈. 문서 인제스트 실패는 이벤트 기록을 막지 않는다. */
export async function injectSelfMemory(
  input: SelfEventInput,
  deps: { sdb?: Database; kdb?: Database; embed?: EmbedFn } = {},
): Promise<InjectResult> {
  const sdb = deps.sdb ?? openSurfaceEventsDb();
  const ownSdb = !deps.sdb;
  let docChunks = 0, docSkipped = 0;
  try {
    const eventId = recordSelfEvent(sdb, input);
    // ★ L2 자기인지(RFC) — 미션 귀속 외부 변경을 그 미션의 워킹메모리에도 append(provenance=external)
    //   → 다음 페이즈 프롬프트에 자동 주입("외부가 X 를 고쳤다") → 병렬 재구현 방지. fail-soft.
    if (input.missionId) {
      try {
        const { coordinatorRecordMemory } = await import('../autopilot/pipeline/coordinator-memory.js');
        const pr = input.refs?.pr ? ` (#${input.refs.pr})` : '';
        coordinatorRecordMemory(input.missionId, {
          phaseId: `external:${input.tool}`, phaseTitle: `[외부개정·${input.tool}]`,
          kind: 'operational', provenance: 'external',
          summary: `${input.summary}${pr}`,
          reusables: [], decisions: [`외부(${input.tool}) 개정: ${input.summary.slice(0, 100)}${pr}`], artifacts: [],
        });
      } catch { /* fail-soft — 워킹메모리 주입 실패가 기억 기록을 막지 않음 */ }
    }
    if (input.docPath && existsSync(input.docPath)) {
      const kdb = deps.kdb ?? openKnowledgeDb();
      const ownKdb = !deps.kdb;
      try {
        const r = await ingestDocFile(kdb, { path: input.docPath, domain: SELF_DOMAIN, ...(deps.embed ? { embed: deps.embed } : {}) });
        docChunks = r.chunks; docSkipped = r.skipped;
      } catch { /* fail-soft — 이벤트는 이미 남음 */ } finally { if (ownKdb) kdb.close(); }
    }
    return { eventId, docChunks, docSkipped };
  } finally { if (ownSdb) sdb.close(); }
}
