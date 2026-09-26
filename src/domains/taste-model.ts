// ── Layer2 Taste substrate · D2 관심사 벡터 (P5 · 2026-07-18) ──────────────
//
// P4(taste-capture)가 surface_events(kind:'taste')에 쌓은 taste **에피소드**를 knowledge.db
// (kind:'taste')로 **미러**해 관심사 **모델**을 만든다 = 해마(surface_events)→신피질(knowledge.db)
// CLS 2계층에 "관측→모델" 미러(계획서 §9#2). 임베더는 knowledge.db nomic(768d) 재사용(§9#4).
//
// 모델 = **dual taste 벡터**(VARS식·계획서 §9#5):
//   - long  centroid = 전 항목 importance-가중 평균(=정체성 앵커·최초 골이 최고 importance라 지배)
//   - short centroid = 최근 창(shortWindowDays) 평균(=현재 관심)
//   - neg   centroid = 부정 선호(싫어하는 것·HKUST neg-preferences) 평균
// tasteAffinity(text) = long/short 유사 - neg 유사 = P6 능동 제안 gate 의 판정 primitive.
//
// 원칙: 핫패스 무배선(주기 sync — retro-cycle/cron 이 호출)·queryEvents 사용(기존 recallEvents
//   실패 우회)·armed=false·매매 무접촉·원장 무오염(surface_events 위 파생 모델). 제1원칙 관측
//   = debug.log('taste.vector', ...).

import type { Database } from 'bun:sqlite';
import { debug } from '../debug/log.js';
import { openSurfaceEventsDb, surfaceEventsDbPath, type SurfaceEventRow } from './surface-events.js';
import {
  openKnowledgeDb, knowledgeDbPath, ingestText, loadKindVectors,
  defaultEmbed, type EmbedFn,
} from './knowledge.js';

/** 부정 선호 마커 — style_pref 텍스트가 거부/기피면 neg 벡터로(거부 신호도 taste). */
const NEG_MARKER = /(싫|말고|아니라|하지\s?마|그만|빼고|dislike|hate|avoid|don['’]?t|not\s|no\s|stop)/i;

/** surface_events taste tag(`taste:<type>,conf:<n>`)에서 type 추출. */
export function parseTasteType(tags: string | null | undefined): string | null {
  if (!tags) return null;
  const m = /(?:^|,)\s*taste:([a-z_]+)/.exec(tags);
  return m ? m[1]! : null;
}

/** 항목이 부정 선호인가 — style_pref 이면서 거부 마커. */
export function isNegativePref(type: string | null, text: string): boolean {
  return type === 'style_pref' && NEG_MARKER.test(text);
}

export interface TasteSyncDeps {
  surfaceDb?: Database;
  knowledgeDb?: Database;
  embed?: EmbedFn;
  /** 조회 창(시간). 기본 720h(30일). */
  sinceHours?: number;
  /** 결정론 seam — 동기화 후보 창의 종료 시각(ms). 없으면 현재 시각. */
  nowMs?: number;
  limit?: number;
}

export interface TasteSyncResult { embedded: number; skipped: number }

/** surface_events(category:'taste.capture')의 taste 에피소드를 knowledge.db(kind:'taste')로
 *  임베딩 미러(멱등 — id 재사용). source_ref 에 type/negative/importance/srcTs 를 JSON 로 실어
 *  computeTasteProfile 이 가중/분류에 쓴다. 반환=신규 임베딩 수. */
export async function syncTasteVectors(deps: TasteSyncDeps = {}): Promise<TasteSyncResult> {
  const sdb = deps.surfaceDb ?? openSurfaceEventsDb(surfaceEventsDbPath());
  const kdb = deps.knowledgeDb ?? openKnowledgeDb(knowledgeDbPath());
  const embed = deps.embed ?? defaultEmbed;
  const sinceHours = deps.sinceHours ?? 720;
  const nowMs = deps.nowMs ?? Date.now();
  // 구현 결함 판정: 후보 선별과 후속 profile 계산이 주입된 동일 시계를 기준으로 한다.
  const rows = sdb.prepare(
    `SELECT * FROM events
     WHERE category = ? AND ts >= ? AND ts <= ?
     ORDER BY ts DESC LIMIT ?`,
  ).all(
    'taste.capture',
    new Date(nowMs - sinceHours * 3.6e6).toISOString(),
    new Date(nowMs).toISOString(),
    deps.limit ?? 1000,
  ) as SurfaceEventRow[];
  let embedded = 0, skipped = 0;
  for (const r of rows) {
    const type = parseTasteType(r.tags);
    const negative = isNegativePref(type, r.text);
    const source_ref = JSON.stringify({ type, negative, importance: r.importance ?? 5, srcTs: r.ts });
    try {
      const ok = await ingestText(kdb, {
        id: r.id, ts: r.ts, kind: 'taste', text: r.text, domain: 'elanous',
        sector_tags: type, source_ref,
      }, embed);
      if (ok) embedded++; else skipped++;
    } catch { skipped++; /* fail-soft — 임베딩 실패가 sync 무차단 */ }
  }
  debug.log('taste.vector', 'sync', { scanned: rows.length, embedded, skipped });
  return { embedded, skipped };
}

// ── 순수 벡터 수학 ─────────────────────────────────────────────────────
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** 가중 평균 centroid → 단위 정규화(코사인 안정). 빈 입력이면 null. */
export function weightedCentroid(vecs: Float32Array[], weights?: number[]): Float32Array | null {
  if (!vecs.length) return null;
  const dim = vecs[0]!.length;
  const acc = new Float32Array(dim);
  let wsum = 0;
  for (let i = 0; i < vecs.length; i++) {
    const w = weights?.[i] ?? 1;
    if (vecs[i]!.length !== dim) continue;
    for (let j = 0; j < dim; j++) acc[j]! += vecs[i]![j]! * w;
    wsum += w;
  }
  if (wsum === 0) return null;
  let norm = 0;
  for (let j = 0; j < dim; j++) { acc[j]! /= wsum; norm += acc[j]! * acc[j]!; }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let j = 0; j < dim; j++) acc[j]! /= norm;
  return acc;
}

export interface TasteProfile {
  long: Float32Array | null;
  short: Float32Array | null;
  neg: Float32Array | null;
  counts: { total: number; long: number; short: number; neg: number };
  embedModel: string | null;
}

export interface ProfileDeps {
  knowledgeDb?: Database;
  shortWindowDays?: number;
  /** 결정론 seam — 최근성 컷 기준 now(ms). 없으면 벡터 ts 최대치 기준(상대). */
  nowMs?: number;
}

function parseRef(source_ref: string | null): { type: string | null; negative: boolean; importance: number } {
  try {
    const o = JSON.parse(source_ref ?? '{}');
    return { type: o.type ?? null, negative: o.negative === true, importance: typeof o.importance === 'number' ? o.importance : 5 };
  } catch { return { type: null, negative: false, importance: 5 }; }
}

/** knowledge.db(kind:'taste') 벡터 → dual centroid(long importance-가중·short 최근창·neg 부정).
 *  단일 embed_model 공간만 집계(혼합 방지 — 최다 모델 채택). */
export function computeTasteProfile(deps: ProfileDeps = {}): TasteProfile {
  const kdb = deps.knowledgeDb ?? openKnowledgeDb(knowledgeDbPath());
  const shortDays = deps.shortWindowDays ?? 7;
  const all = loadKindVectors(kdb, 'taste', 'elanous');
  const empty: TasteProfile = { long: null, short: null, neg: null, counts: { total: 0, long: 0, short: 0, neg: 0 }, embedModel: null };
  if (!all.length) return empty;

  // 공간 정합 — 최다 embed_model 만(nomic↔OpenAI 폴백 혼합 방지).
  const modelCount = new Map<string, number>();
  for (const d of all) modelCount.set(d.embed_model, (modelCount.get(d.embed_model) ?? 0) + 1);
  const embedModel = [...modelCount.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const docs = all.filter(d => d.embed_model === embedModel);

  const maxTs = docs.reduce((m, d) => Math.max(m, Date.parse(d.ts) || 0), 0);
  const nowMs = deps.nowMs ?? maxTs;
  const cutoff = nowMs - shortDays * 86400_000;

  const posV: Float32Array[] = [], posW: number[] = [];
  const shortV: Float32Array[] = [];
  const negV: Float32Array[] = [];
  for (const d of docs) {
    const { negative, importance } = parseRef(d.source_ref);
    if (negative) { negV.push(d.vector); continue; }
    posV.push(d.vector); posW.push(importance);
    if ((Date.parse(d.ts) || 0) >= cutoff) shortV.push(d.vector);
  }
  return {
    long: weightedCentroid(posV, posW),
    short: weightedCentroid(shortV),
    neg: weightedCentroid(negV),
    counts: { total: docs.length, long: posV.length, short: shortV.length, neg: negV.length },
    embedModel,
  };
}

export interface Affinity { longSim: number; shortSim: number; negSim: number; blended: number }

/** 텍스트의 taste 친화도 — long/short 유사 - neg 유사(blended). P6 능동 제안 gate 판정용.
 *  blended = 0.5·long + 0.5·short - 0.3·neg (없는 축은 0). */
export async function tasteAffinity(text: string, profile: TasteProfile, embed: EmbedFn = defaultEmbed): Promise<Affinity> {
  const { vector } = await embed(text);
  const longSim = profile.long ? cosine(vector, profile.long) : 0;
  const shortSim = profile.short ? cosine(vector, profile.short) : 0;
  const negSim = profile.neg ? cosine(vector, profile.neg) : 0;
  const blended = 0.5 * longSim + 0.5 * shortSim - 0.3 * negSim;
  return { longSim, shortSim, negSim, blended };
}
