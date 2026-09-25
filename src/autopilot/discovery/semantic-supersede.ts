// ── DocOps · 의미 supersede 판정 계층 (gemma-4 · 미션 668871 arc2 되살리기 · 2026-07-14) ──
//
// 규칙 기반 supersede(제목·topic·날짜)가 못 잡는 "**이름은 달라도 같은 내용**"을 로컬 챗 모델(gemma-4)
// 로 의미 판정한다. 미션 골 가치 #2. arc2 는 원래 잘못된 파일·없는 fixture 로 descoped 됐으나, 지금은
// gemma-4(LM Studio·local·node-b)가 실재하므로 인프라 위에서 성립.
//
// ★ "자기 자원을 안다는 전제" — endpoint 하드코딩 없이 **인벤토리(getInventory)로 로컬 챗 모델을 스스로
//   발견**해 쓴다(방금 만든 자원 인지 위에). 로컬 챗 없으면 계층 부재(graceful·규칙 기반으로 폴백).
// ★ 로컬 전용 불변식 — 선택된 모델 URL 이 loopback 이 아니면 거부(클라우드 0·assertLoopbackModelUrl).
// ★ 비파괴·HITL — 판정은 doc-curate CurationProposal(제안 큐)로만. 자동 적용 없음.

import { createHash } from 'node:crypto';
import type { CurationItem, CurationProposal } from './doc-curation.js';
import type { LlmInventory } from '../../llm/local-manager/types.js';
import { pickLocalModel } from '../../llm/local-manager/pick-model.js';
import { assertLoopbackModelUrl } from './nightly-docops-runner.js';

/** 두 문서 의미 관계(미션 명세의 5관계). */
export type SupersedeRelation = 'duplicate' | 'supersedes' | 'contradicts' | 'related' | 'no_match';

export interface SupersedeVerdict {
  relation: SupersedeRelation;
  /** supersede/duplicate 시 방향 — 어느 쪽이 최신/권위본인가. */
  direction?: 'a_over_b' | 'b_over_a';
  confidence: number;
  reason: string;
}

/** 판정 대상 문서(경로 + 발췌). */
export interface DocRef { path: string; title: string; excerpt: string; date?: string }

export interface PickedChatModel { spec: string; nodeId: string; modelId: string; baseUrl: string }

export interface SemanticDeps {
  /** 자기 자원 인지 — 로컬 챗 모델 발견(기본 getInventory). "자기 자원을 안다는 전제". */
  inventory?: () => Promise<LlmInventory>;
  /** node+model → baseUrl(기본 manager resolveBaseUrl). loopback 가드 대상. */
  resolveUrl?: (nodeId: string, modelId: string) => string | null;
  /** 로컬 챗 호출(기본 streamLLM via local-llm spec). 테스트 주입. */
  chat?: (prompt: string, modelSpec: string) => Promise<string>;
}

/**
 * 인벤토리에서 로컬 챗 모델 선택(자기 자원 인지). ★ 정책 SSoT 채택(2026-07-15) — 종전 gemma-전용 특수
 * 로직을 fleet 정책 `pickLocalModel`(MLX 우선·Q4·MoE 스피드·임베딩 제외·노드 RAM 예산)로 수렴해 로컬
 * 모델 선택 정책을 한 벌로 통일한다(중복 제거·MANUAL-llm-model-management SSoT). MoE 스피드 힌트(a4b 등)가
 * gemma-4-26b-a4b 같은 빠른 챗 MoE 를 자연히 상위로 올린다. null = 로컬 챗 자원 없음(의미 계층 부재·규칙
 * 기반 폴백). 선택 URL 은 loopback 검증(클라우드 0).
 */
export function pickLocalChatModel(inv: LlmInventory, resolveUrl?: (n: string, m: string) => string | null): PickedChatModel | null {
  const best = pickLocalModel(inv); // DEFAULT_LOCAL_FLEET_POLICY — 임베딩 제외·MLX/Q4/MoE 선호
  if (!best) return null;
  const baseUrl = resolveUrl?.(best.nodeId, best.id) ?? '';
  return { spec: `local-llm:${best.nodeId}:${best.id}`, nodeId: best.nodeId, modelId: best.id, baseUrl };
}

function buildJudgePrompt(a: DocRef, b: DocRef): string {
  return [
    '역할: 두 문서의 **의미 관계**를 판정한다. 제목/파일명이 달라도 **내용이 같은지**를 본다(핵심).',
    '관계(하나): duplicate(사실상 동일 내용) · supersedes(한쪽이 다른쪽을 대체·최신/권위) ·',
    '  contradicts(상충) · related(관련되나 대체 아님) · no_match(무관).',
    'supersede/duplicate 면 direction: a_over_b(A가 최신/권위) | b_over_a. 날짜·구체성·완결성으로 판단.',
    '엄격: 확신 없으면 related/no_match. 표면 키워드 겹침만으로 duplicate 판정 금지(내용 기준).',
    '',
    `## 문서 A\n제목: ${a.title}${a.date ? ` (${a.date})` : ''}\n발췌:\n${a.excerpt.slice(0, 1500)}`,
    '',
    `## 문서 B\n제목: ${b.title}${b.date ? ` (${b.date})` : ''}\n발췌:\n${b.excerpt.slice(0, 1500)}`,
    '',
    'JSON 한 줄만: {"relation":"...","direction":"a_over_b|b_over_a|null","confidence":0~1,"reason":"한 줄 근거"}',
  ].join('\n');
}

/** LLM 출력 → 판정. 파싱 실패/애매 → no_match(보수적). 순수. */
export function parseSupersedeVerdict(raw: string): SupersedeVerdict {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { relation: 'no_match', confidence: 0, reason: '판정 파싱 실패' };
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const rel = ['duplicate', 'supersedes', 'contradicts', 'related', 'no_match'].includes(o.relation as string) ? o.relation as SupersedeRelation : 'no_match';
    const dir = o.direction === 'a_over_b' || o.direction === 'b_over_a' ? o.direction : undefined;
    return {
      relation: rel,
      ...(dir ? { direction: dir } : {}),
      confidence: typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 240) : '',
    };
  } catch { return { relation: 'no_match', confidence: 0, reason: '판정 오류' }; }
}

async function defaultChat(prompt: string, modelSpec: string): Promise<string> {
  // ★ LocalProvider 명시 — resolveDefaultProvider 는 활성 provider(Codex 등)를 반환해 local-llm spec 을
  //   외부로 보낸다. 로컬 전용 불변식(클라우드 0)엔 LocalProvider 로 LM Studio(loopback) 라우팅 강제.
  const { streamLLM, LocalProvider } = await import('../../llm.js');
  return streamLLM([{ role: 'user', content: prompt }], () => {}, { model: modelSpec, provider: LocalProvider, reasoningEffort: 'low' });
}

/** 두 문서 의미 관계를 로컬 챗(gemma-4)으로 판정. 로컬 챗 자원 없으면 no_match(계층 부재). 로컬 전용. */
export async function judgeSupersedeRelation(a: DocRef, b: DocRef, deps: SemanticDeps = {}): Promise<SupersedeVerdict> {
  try {
    const inv = await (deps.inventory ?? (async () => (await import('../../llm/local-manager/manager.js')).getInventory()))();
    const resolveUrl = deps.resolveUrl ?? ((n: string, m: string) => { try { return (require('../../llm/local-manager/manager.js') as { resolveBaseUrl: (n: string, m: string) => string | null }).resolveBaseUrl(n, m); } catch { return null; } });
    const picked = pickLocalChatModel(inv, resolveUrl);
    if (!picked) return { relation: 'no_match', confidence: 0, reason: '로컬 챗 모델 없음(의미 계층 부재)' };
    if (picked.baseUrl) assertLoopbackModelUrl(picked.baseUrl); // 클라우드 0·로컬 전용(위반 시 throw)
    const raw = await (deps.chat ?? defaultChat)(buildJudgePrompt(a, b), picked.spec);
    return parseSupersedeVerdict(raw);
  } catch (e) {
    return { relation: 'no_match', confidence: 0, reason: `의미 판정 오류(fail-soft): ${e instanceof Error ? e.message.slice(0, 80) : ''}` };
  }
}

/** 후보 쌍 → gemma-4 판정 → 비파괴 CurationItem(supersede-mark·contradiction 플래그). duplicate/supersedes/
 *  contradicts 만 제안(related/no_match 스킵). 자동 적용 없음(HITL 큐). */
export async function proposeSemanticSupersede(
  pairs: ReadonlyArray<{ a: DocRef; b: DocRef }>, deps: SemanticDeps = {},
): Promise<CurationItem[]> {
  const items: CurationItem[] = [];
  for (const { a, b } of pairs) {
    const v = await judgeSupersedeRelation(a, b, deps);
    if (v.relation === 'related' || v.relation === 'no_match') continue;
    // supersede 방향 — direction 이 지목한 구본(older)에 supersede-mark(비파괴). contradicts 는 양쪽 플래그.
    const older = v.direction === 'b_over_a' ? a : b;
    const newer = v.direction === 'b_over_a' ? b : a;
    const contradiction = v.relation === 'contradicts';
    items.push({
      action: 'update',
      path: older.path, targetDocument: older.path, filename: older.path.split('/').pop() ?? older.path,
      reason: `[semantic:${v.relation}${contradiction ? '' : `·${newer.path}`}] ${v.reason} (gemma-4·confidence ${v.confidence.toFixed(2)})`,
      evidenceQuote: older.excerpt.slice(0, 200), sourcePath: newer.path,
      diff: contradiction
        ? `contradiction 플래그(비파괴·원문 보존):\n+ ⚠️ contradicts ${newer.path}: ${v.reason}`
        : `append superseded_by: ${newer.path}(비파괴·의미 판정):\n+ superseded-by ${newer.path} — ${v.reason}`,
      confidence: v.confidence,
      detectorVersion: 'semantic-supersede-gemma4-v1',
      ...(contradiction ? {} : { successor: newer.path }),
      inboundRefs: 0,
    });
  }
  return items;
}

/** 클러스터링 최소 입력(메타만·본문 read 불필요). scanDocs DocEntry 가 그대로 맞음. */
export interface ClusterDoc { path: string; filename: string; topic: string; date?: string | null }

export interface TopicClusterOpts {
  /** 후보 쌍 인정 최소 공유 토큰 수(기본 2 — 같은 대상을 말한다는 신호). */
  minSharedTokens?: number;
  /** 사이클당 gemma 판정 쌍 상한(비용 가드·기본 40). 초과분은 truncated 로 보고(다음 사이클). */
  maxPairs?: number;
  /** 토큰 최소 길이(기본 3 — 짧은 조각 노이즈 제외). */
  minTokenLen?: number;
  /** 비변별 토큰(너무 흔함) 배제 — 버킷 크기 상한(기본 30). O(n²) 폭발 방지. */
  maxBucket?: number;
}

/**
 * 제목/토픽 슬러그 클러스터로 **bounded** supersede 후보 쌍 생성(전수 O(n²) 금지). arc2 되살리기 —
 * 임베딩 top-k(descoped) 대신 결정론 토큰 클러스터로 gemma 판정 대상만 좁힌다.
 *   ① 토픽 슬러그를 토큰화 → 역인덱스(token→docs).
 *   ② 비변별 토큰(버킷 > maxBucket)은 배제(흔한 단어로 전수 폭발 방지).
 *   ③ 공유 토큰 ≥ minSharedTokens 쌍만 후보(같은 대상을 말함) · **동일 topic 은 제외**(결정론
 *      findSupersedeClusters 가 이미 커버 — 여기는 "이름 달라도" 케이스만).
 *   ④ 공유 토큰 수로 정렬해 상위 maxPairs 만(캡 초과 = truncated, 다음 사이클로). 순수·결정론.
 */
export function buildTopicClusterPairs(
  docs: ReadonlyArray<ClusterDoc>, opts: TopicClusterOpts = {},
): { pairs: Array<{ a: ClusterDoc; b: ClusterDoc }>; truncated: number } {
  const minShared = opts.minSharedTokens ?? 2;
  const maxPairs = opts.maxPairs ?? 40;
  const minTokenLen = opts.minTokenLen ?? 3;
  const maxBucket = opts.maxBucket ?? 30;
  const toks = (d: ClusterDoc): string[] =>
    [...new Set(d.topic.split('-').filter((t) => t.length >= minTokenLen))];

  const invIdx = new Map<string, number[]>();
  docs.forEach((d, i) => { for (const t of toks(d)) { const a = invIdx.get(t) ?? []; a.push(i); invIdx.set(t, a); } });

  // 공유 토큰 수 누적(무순 쌍) — 비변별 토큰 버킷은 건너뛰어 폭발 방지.
  const pairCount = new Map<string, number>();
  for (const members of invIdx.values()) {
    if (members.length < 2 || members.length > maxBucket) continue;
    for (let x = 0; x < members.length; x++) for (let y = x + 1; y < members.length; y++) {
      const i = members[x]!; const j = members[y]!;
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
  }

  const cand: Array<{ i: number; j: number; score: number }> = [];
  for (const [key, score] of pairCount) {
    if (score < minShared) continue;
    const [i, j] = key.split(':').map(Number) as [number, number];
    if (docs[i]!.topic === docs[j]!.topic) continue; // 동일 topic = 결정론 규칙 소관(중복 방지)
    cand.push({ i, j, score });
  }
  // 공유 토큰 많은 순 → 결정론 tie-break(i, j).
  cand.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
  const taken = cand.slice(0, maxPairs);
  return {
    pairs: taken.map(({ i, j }) => ({ a: docs[i]!, b: docs[j]! })),
    truncated: Math.max(0, cand.length - taken.length),
  };
}

/**
 * 의미 supersede CurationItem[] → doc-curate CurationProposal 봉투(기존 큐 재사용·멱등키·status=proposed).
 * 멱등키는 gemma 문구가 아닌 **판정 결과(path→successor)** 로 산출 — 같은 중복 재검출 시 재실행 억제(문구
 * 변동 무관). 빈 items 는 호출측이 스킵(제안 없음). 순수(nowIso 주입).
 */
export function buildSemanticSupersedeProposal(
  items: CurationItem[], opts: { nowIso: string; scanned: number },
): CurationProposal {
  const model = 'gemma-4-semantic-supersede';
  const promptVersion = 'semantic-supersede-v1';
  const schemaVersion = 'docops-curation-v1';
  const h = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32);
  const sig = items.map((i) => `${i.path}→${i.successor ?? 'contradict'}`).sort().join('\n');
  const inputDocumentHash = h(sig);
  const idempotencyKey = h(`${inputDocumentHash}\0${model}\0${promptVersion}\0${schemaVersion}`);
  return {
    generatedAt: opts.nowIso, scanned: opts.scanned, items, status: 'proposed',
    inputDocumentHash, model, promptVersion, schemaVersion, idempotencyKey,
  };
}
