// ── 온톨로지 seed — 클러스터 + 밸류체인 (M5 P2 · R1·R4 · 2026-07-08) ──────
//
// KR_CHAINS(sector-attractiveness·34섹터·245종목·22 카테고리)를 그래프 골격으로
// deterministic 적재(LLM 0). 대표 R1(산업 클러스터)·R4(밸류체인 상하류)의 무비용 뼈대.
//  - 클러스터(R1): 카테고리→chain, 서브체인→subchain, 종목→company, belongs_to 계층.
//  - 밸류체인(R4): 큐레이션 순서(상류→하류)를 supplies 방향 엣지.
// 종목명은 screener.db screen 에서 code→name 로드(readonly·fail-soft=code).
// seed 는 시작 골격일 뿐 — 동적 발굴(상관·뉴스)로 성장(R1 확장·kg-theme).

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { KR_CHAINS } from './sector-attractiveness.js';
import { SCREENER_DB_PATH } from './sector-store.js';
import { nodeId, upsertNode, addEdge, type Market } from './kg-store.js';

/** 구조 엣지(belongs_to·supplies)는 timeless 사실 — 관측 시점이 아니라 고정 anchor 로
 *  valid_at 을 두어 재seed 멱등(같은 id). 과거 sentinel 이라 temporal 필터(valid_at<=now)
 *  에선 항상 유효. 노드 first/last_seen 은 실제 시점(now) 유지. */
export const STRUCTURAL_VALID_AT = '2000-01-01';

/** 밸류체인 상류→하류 큐레이션 순서(연속 stage 간 supplies). KR_CHAINS 서브체인 키 기준.
 *  없는 stage 는 스킵(fail-soft). 도메인 지식·점진 확장. */
export const VALUECHAIN_ORDER: Record<string, string[]> = {
  '반도체': ['소재', '장비', '팹리스/파운드리', 'HBM/후공정', '메모리/종합'],
  '2차전지': ['소재/부품/장비', '양극재', '셀'],
  '자동차': ['부품/타이어', '완성차'],
  '바이오/제약': ['제약', '신약/ADC', 'CDMO/바이오'],
  '조선': ['기자재', '조선'],
};

/** screener.db 최신 스냅샷 code→name 맵(readonly·fail-soft). */
export function loadNameMap(path: string = SCREENER_DB_PATH): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  const db = new Database(path, { readonly: true });
  try {
    const rows = db.query(
      `SELECT code, name FROM screen WHERE date=(SELECT MAX(date) FROM screen)`,
    ).all() as Array<{ code: string; name: string }>;
    for (const r of rows) if (r.name) out.set(r.code, r.name);
  } catch { /* fail-soft */ } finally { db.close(); }
  return out;
}

export interface SeedCounts { chains: number; subchains: number; companies: number; belongsTo: number; supplies: number }

/** 클러스터(R1) — KR_CHAINS → chain/subchain/company 노드 + belongs_to 계층. KR 시장. */
export function seedClusters(
  db: Database, now: string,
  opts: { chains?: Record<string, Record<string, string[]>>; nameMap?: Map<string, string>; market?: Market } = {},
): SeedCounts {
  const chains = opts.chains ?? KR_CHAINS;
  const nameMap = opts.nameMap ?? loadNameMap();
  const market = opts.market ?? 'KR';
  const c: SeedCounts = { chains: 0, subchains: 0, companies: 0, belongsTo: 0, supplies: 0 };
  const seenCompany = new Set<string>();

  for (const [cat, subs] of Object.entries(chains)) {
    const chainNode = nodeId('chain', cat);
    upsertNode(db, { id: chainNode, kind: 'chain', market, name: cat, firstSeen: now, lastSeen: now });
    c.chains++;
    for (const [sub, codes] of Object.entries(subs)) {
      const subNode = nodeId('subchain', `${cat}·${sub}`);
      upsertNode(db, { id: subNode, kind: 'subchain', market, name: `${cat}·${sub}`, firstSeen: now, lastSeen: now });
      c.subchains++;
      addEdge(db, { src: subNode, dst: chainNode, relation: 'belongs_to', validAt: STRUCTURAL_VALID_AT, sourceRef: 'seed:kr_chains', extractedBy: 'seed', confidence: 1 });
      c.belongsTo++;
      for (const code of codes) {
        const compNode = nodeId('company', code);
        upsertNode(db, {
          id: compNode, kind: 'company', market, name: nameMap.get(code) ?? code,
          aliases: [code], meta: { ticker: code }, firstSeen: now, lastSeen: now,
        });
        if (!seenCompany.has(code)) { c.companies++; seenCompany.add(code); }
        addEdge(db, { src: compNode, dst: subNode, relation: 'belongs_to', validAt: STRUCTURAL_VALID_AT, sourceRef: 'seed:kr_chains', extractedBy: 'seed', confidence: 1 });
        c.belongsTo++;
      }
    }
  }
  return c;
}

/** 밸류체인(R4) — VALUECHAIN_ORDER 연속 stage 간 supplies(상류→하류). 존재 stage 만. */
export function seedValuechains(
  db: Database, _now: string,   // 구조 엣지는 STRUCTURAL_VALID_AT 사용(now 무관·API 대칭 유지)
  opts: { chains?: Record<string, Record<string, string[]>>; order?: Record<string, string[]> } = {},
): number {
  const chains = opts.chains ?? KR_CHAINS;
  const order = opts.order ?? VALUECHAIN_ORDER;
  let n = 0;
  for (const [cat, stages] of Object.entries(order)) {
    const present = stages.filter(s => chains[cat]?.[s]);   // KR_CHAINS 에 실재하는 stage 만
    for (let i = 0; i < present.length - 1; i++) {
      const up = nodeId('subchain', `${cat}·${present[i]!}`);
      const down = nodeId('subchain', `${cat}·${present[i + 1]!}`);
      addEdge(db, { src: up, dst: down, relation: 'supplies', weight: 1, validAt: STRUCTURAL_VALID_AT, sourceRef: 'seed:valuechain', extractedBy: 'seed', confidence: 0.8 });
      n++;
    }
  }
  return n;
}

/** 클러스터 + 밸류체인 한번에 seed. */
export function seedStructure(
  db: Database, now: string,
  opts: { chains?: Record<string, Record<string, string[]>>; nameMap?: Map<string, string>; market?: Market } = {},
): SeedCounts {
  const c = seedClusters(db, now, opts);
  c.supplies = seedValuechains(db, now, { chains: opts.chains });
  return c;
}

// ── P3: 한미 크로스마켓(R3) + 테마 그룹(R7) ────────────────────────────────
//
// 설계 철학: 구조 seed = 토폴로지(링크 존재·STRUCTURAL_VALID_AT·weight null).
// 측정된 weight/lead_lag/regime_at 은 상관 pass(P5·kg-correlation)가 temporal 로 채움.

/** 미국 주요 종목 seed(대표 P7/M7 예시 중심). ticker = key. */
export const US_COMPANY_SEED: Record<string, string> = {
  MU: '마이크론', SNDK: '샌디스크', MRVL: '마벨', INTC: '인텔',        // P7 반도체 공급
  NVDA: '엔비디아', GOOGL: '구글', AMZN: '아마존', AAPL: '애플',
  MSFT: '마이크로소프트', META: '메타', TSLA: '테슬라',                 // M7 빅테크
};

/** 테마 그룹 멤버(R7). group:P7=반도체 공급 · group:M7=빅테크. */
export const THEME_GROUPS: Record<string, { name: string; members: string[] }> = {
  P7: { name: '반도체 공급(P7)', members: ['MU', 'SNDK', 'MRVL', 'INTC'] },
  M7: { name: '빅테크(M7)', members: ['NVDA', 'GOOGL', 'AMZN', 'AAPL', 'MSFT', 'META', 'TSLA'] },
};

/** 한미 크로스마켓 링크 seed(방향 US→KR). weight/lead_lag 는 상관 pass 가 채움. */
export const CROSS_MARKET_SEED: Array<{ src: string; dst: string; note: string }> = [
  { src: 'company:MU', dst: 'company:005930', note: '메모리 동조' },
  { src: 'company:MU', dst: 'company:000660', note: '메모리 동조' },
  { src: 'company:NVDA', dst: 'company:000660', note: 'HBM 수요' },
  { src: 'company:NVDA', dst: 'company:005930', note: 'HBM 수요' },
];

export interface CrossSeedCounts { usCompanies: number; groups: number; groupMembers: number; crossMarket: number; competes: number; policies: number }

/** 한미 크로스마켓(R3) — US 종목 노드 + cross_market 구조 링크 + 수출통제 정책→반도체. */
export function seedCrossMarket(
  db: Database, now: string,
  opts: { usCompanies?: Record<string, string>; links?: Array<{ src: string; dst: string; note: string }> } = {},
): Pick<CrossSeedCounts, 'usCompanies' | 'crossMarket' | 'policies'> {
  const us = opts.usCompanies ?? US_COMPANY_SEED;
  const links = opts.links ?? CROSS_MARKET_SEED;
  let usCompanies = 0, crossMarket = 0, policies = 0;
  for (const [ticker, name] of Object.entries(us)) {
    upsertNode(db, { id: nodeId('company', ticker), kind: 'company', market: 'US', name, aliases: [ticker], meta: { ticker }, firstSeen: now, lastSeen: now });
    usCompanies++;
  }
  for (const l of links) {
    addEdge(db, { src: l.src, dst: l.dst, relation: 'cross_market', validAt: STRUCTURAL_VALID_AT, confidence: 0.5, sourceRef: `seed:crossmarket:${l.note}`, extractedBy: 'seed' });
    crossMarket++;
  }
  // 미국 수출통제 정책 → 한국 반도체 체인(affects·방향만·강도는 이벤트 시 갱신).
  upsertNode(db, { id: 'policy:us-export-control', kind: 'policy', market: 'US', name: '미국 반도체 수출통제', firstSeen: now, lastSeen: now });
  addEdge(db, { src: 'policy:us-export-control', dst: nodeId('chain', '반도체'), relation: 'affects', weight: -0.5, validAt: STRUCTURAL_VALID_AT, confidence: 0.5, sourceRef: 'seed:policy', extractedBy: 'seed' });
  policies = 1;
  return { usCompanies, crossMarket, policies };
}

/** 테마 그룹(R7) — group 노드 + 멤버 belongs_to + P7↔M7 competes_with 토폴로지. */
export function seedThemeGroups(
  db: Database, now: string,
  opts: { groups?: Record<string, { name: string; members: string[] }> } = {},
): Pick<CrossSeedCounts, 'groups' | 'groupMembers' | 'competes'> {
  const groups = opts.groups ?? THEME_GROUPS;
  let g = 0, groupMembers = 0;
  for (const [key, def] of Object.entries(groups)) {
    upsertNode(db, { id: nodeId('group', key), kind: 'group', market: 'GLOBAL', name: def.name, firstSeen: now, lastSeen: now });
    g++;
    for (const m of def.members) {
      addEdge(db, { src: nodeId('company', m), dst: nodeId('group', key), relation: 'belongs_to', validAt: STRUCTURAL_VALID_AT, confidence: 1, sourceRef: 'seed:theme', extractedBy: 'seed' });
      groupMembers++;
    }
  }
  // P7 ↔ M7 competes_with 토폴로지(강도는 상관 pass·temporal 이 채움). 양방향.
  let competes = 0;
  if (groups.P7 && groups.M7) {
    addEdge(db, { src: 'group:P7', dst: 'group:M7', relation: 'competes_with', validAt: STRUCTURAL_VALID_AT, confidence: 0.3, sourceRef: 'seed:rivalry', extractedBy: 'seed' });
    addEdge(db, { src: 'group:M7', dst: 'group:P7', relation: 'competes_with', validAt: STRUCTURAL_VALID_AT, confidence: 0.3, sourceRef: 'seed:rivalry', extractedBy: 'seed' });
    competes = 2;
  }
  return { groups: g, groupMembers, competes };
}

/** 전체 seed(구조 + 한미 + 테마). */
export function seedAll(db: Database, now: string, opts: { chains?: Record<string, Record<string, string[]>>; nameMap?: Map<string, string> } = {}): SeedCounts & CrossSeedCounts {
  const s = seedStructure(db, now, opts);
  const x = seedCrossMarket(db, now);
  const t = seedThemeGroups(db, now);
  return { ...s, ...x, ...t };
}
