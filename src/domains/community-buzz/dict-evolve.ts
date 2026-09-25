// ── 사전 자율진화 — 공출현/빈도 마이닝 + LLM 분류 · 버즈 P2d · 2026-07-09 ──────
//
// PLAN §4d "조그마한 머신러닝". 정적 사전은 며칠이면 도태(새 밈 매일) → 상시 진화.
// 폐루프: 버즈 제목에서 미지 고빈도 토큰 발굴(무비용 마이닝) → 알려진 티커와 공출현 힌트
// → 로컬 LLM 이 분류(ticker/entity/sentiment/noise) → slang_dict 성장(source=cooccur/llm).
// 무거운 분류기 아님 — 사전이 곧 모델, 이건 유지 메커니즘. 주1회 크론(무거워 상시 아님).

import type { Database } from 'bun:sqlite';
import { extractJson } from './local-llm.js';
import type { LocalLlm } from './local-llm.js';
import type { SlangEntry, SlangType } from './slang-dict.js';
import { sqlNowIso, within } from '../../time/db-window.js';

export interface Candidate { term: string; freq: number; example: string; cooccur: string[] }

// 정보성 낮은 흔한 토큰(티커/은어 아님) — 후보에서 제외.
const NOISE = new Set(['실시간', '오늘', '내일', '지금', '근황', '이거', '그거', '저거', '진짜', '정말', '속보', '관련', '뉴스', '가즈아', '이제', '그냥', '다들', '우리', '너무', '완전', '개인', '생각', '느낌', '상황', '경우', '문제', '이번', '저번', '다음', '해외', '국내', '주식', '종목', '시장', '매수', '매도', '보유']);
const JOSA = /(으로|에서|까지|부터|보다|처럼|한테|는|은|이|가|을|를|에|의|도|만|과|와|로|요|네|다|냐|음)$/;

function normToken(t: string): string { return t.replace(/[ㅋㅎㅠㅜㄷㄱ]+$/g, '').replace(JOSA, ''); }
export function tokenize(title: string): string[] {
  return title.split(/[\s,.!?~"'()[\]<>·+\-…:;/]+/).map(normToken)
    .filter(t => t.length >= 2 && t.length <= 8 && /[가-힣A-Za-z]/.test(t) && !/^\d+$/.test(t));
}

/** 미지 고빈도 토큰 발굴 — dict/노이즈 제외·최근창·공출현 티커 힌트. */
export function mineCandidates(db: Database, known: Set<string>, opts: { hours?: number; minFreq?: number; limit?: number } = {}): Candidate[] {
  const hours = opts.hours ?? 48, minFreq = opts.minFreq ?? 4;
  const rows = db.prepare(`SELECT title, tickers FROM buzz_posts WHERE ${within('ts')}`).all(`-${hours} hours`) as Array<{ title: string; tickers: string | null }>;
  const freq = new Map<string, number>(), example = new Map<string, string>(), cooc = new Map<string, Set<string>>();
  for (const r of rows) {
    const tickers = r.tickers ? r.tickers.split(',') : [];
    for (const t of new Set(tokenize(r.title))) {
      const key = t.toLowerCase();
      if (known.has(key) || NOISE.has(t)) continue;
      freq.set(key, (freq.get(key) ?? 0) + 1);
      if (!example.has(key)) example.set(key, r.title);
      if (tickers.length) { const s = cooc.get(key) ?? new Set<string>(); tickers.forEach(x => s.add(x)); cooc.set(key, s); }
    }
  }
  const out: Candidate[] = [];
  for (const [term, f] of freq) if (f >= minFreq) out.push({ term, freq: f, example: example.get(term) ?? '', cooccur: [...(cooc.get(term) ?? [])] });
  return out.sort((a, b) => b.freq - a.freq).slice(0, opts.limit ?? 20);
}

/** 분류 프롬프트(순수·ASCII+한글). */
export function buildClassifyPrompt(cands: Candidate[]): string {
  const lines = cands.map((c, i) => `${i}. "${c.term}" (${c.freq}회${c.cooccur.length ? `, 공출현:${c.cooccur.join(',')}` : ''}) 예: ${c.example.slice(0, 40)}`);
  return [
    '한국 주식 커뮤니티(에펨코리아)에서 자주 나온 미지의 용어들을 분류한다.',
    '각 용어가 무엇인지 판정해 JSON 배열만 출력(설명 금지).',
    '각 항목: {"i":번호, "type":"ticker|entity|sentiment|noise", "canonical":"정식명", "ticker":"종목코드(ticker면)", "polarity":숫자(sentiment면 -1~1)}',
    '- ticker: 종목/기업 별칭(예: 하닉=SK하이닉스). ticker 필드에 코드(국내 NNNNNN.KO·미국 심볼).',
    '- entity: 수급주체/개념(예: 외국인·선물).',
    '- sentiment: 긍부정 은어(예: 떡상=급등 +0.9). polarity 필수.',
    '- noise: 종목/은어 아닌 일반어 → 이건 canonical 생략.',
    '확실하지 않으면 noise. 정밀도 우선.',
    '',
    '용어:',
    ...lines,
    '',
    'JSON 배열:',
  ].join('\n');
}

/** 분류 응답 파싱(순수) — noise 제외·검증. */
export function parseClassifyResponse(raw: string, cands: Candidate[]): SlangEntry[] {
  const j = extractJson(raw);
  if (!Array.isArray(j)) return [];
  const out: SlangEntry[] = [];
  for (const item of j) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const i = typeof o.i === 'number' ? o.i : Number(o.i);
    if (!Number.isInteger(i) || i < 0 || i >= cands.length) continue;
    const type = o.type as SlangType | 'noise';
    if (type === 'noise' || (type !== 'ticker' && type !== 'entity' && type !== 'sentiment')) continue;
    const canonical = typeof o.canonical === 'string' ? o.canonical.trim() : '';
    if (!canonical) continue;
    const lang = /[가-힣]/.test(cands[i]!.term) ? 'ko' : 'en';
    const entry: SlangEntry = { term: cands[i]!.term, canonical, type, lang };
    if (type === 'ticker' && typeof o.ticker === 'string' && o.ticker.trim()) entry.ticker = o.ticker.trim();
    if (type === 'sentiment') { const p = Number(o.polarity); entry.polarity = Number.isNaN(p) ? 0 : Math.max(-1, Math.min(1, p)); }
    // ticker 인데 코드 없으면 신뢰도 낮음 — entity 로 강등
    if (type === 'ticker' && !entry.ticker) { entry.type = 'entity'; }
    out.push(entry);
  }
  return out;
}

/** 분류 → 제안 SlangEntry[]. 실패 시 [](fail-soft). */
export async function classifyCandidates(cands: Candidate[], llm: LocalLlm): Promise<SlangEntry[]> {
  if (cands.length === 0) return [];
  try {
    const content = await llm.complete([{ role: 'user', content: buildClassifyPrompt(cands) }], { maxTokens: Math.min(4096, 256 + cands.length * 80) });
    return parseClassifyResponse(content, cands);
  } catch { return []; }
}

/** 진화 항목 사전 적재 — source=llm·낮은 신뢰도(HITL 검토 대상). 기존 seed 는 안 덮음. */
export function addEvolvedEntries(db: Database, entries: SlangEntry[], source = 'llm', confidence = 0.6): number {
  const ins = db.prepare(`INSERT OR IGNORE INTO slang_dict(term, canonical, type, lang, polarity, ticker, source, confidence, last_seen) VALUES (?,?,?,?,?,?,?,?, ${sqlNowIso()})`);
  let n = 0;
  const tx = db.transaction(() => { for (const e of entries) { const r = ins.run(e.term, e.canonical, e.type, e.lang, e.polarity ?? null, e.ticker ?? null, source, confidence); if (r.changes) n++; } });
  tx();
  return n;
}
