// ── 국면 벡터 신호 축 레지스트리 (M0.3 · 2026-07-07) ────────────────────
//
// 국면종합 방법론(RESEARCH-regime-synthesis-dual-loop §2)의 신호 인벤토리를 코드
// 단일 출처로. C1 국면 벡터 종합기(synthesizeRegime·M1)가 이 축들을 순회하며 각
// fetcher를 호출해 하나의 RegimeVector로 합성한다. 여기선 "무엇을 종합하나"의 메타만
// 정의(파편 신호의 지도) — 실제 fetcher 배선은 M1.
//
// role: 'composite' = 국면 방향 가중 합성(weight 합 = 1.0) · 'transition' = 큰 국면
// 전환 감지 보조(다축 동시전환 판정 입력·weight 0).

export interface RegimeAxis {
  /** 축 키(안정 식별자). */
  key: 'asset_flow' | 'macro_rates' | 'kr_flow' | 'kr_sector' | 'kr_pulse' | 'community_buzz' | 'us_sector' | 'us_pulse' | 'geopolitics' | 'dislocation';
  /** 사람용 한글 라벨. */
  name: string;
  /** 국면 벡터 합성 가중(composite 축 합=1.0 · transition 축=0). */
  weight: number;
  /** composite=방향 합성 · transition=전환 감지 보조. */
  role: 'composite' | 'transition';
  /** 소스 DB 파일명 힌트(~/.elanous 또는 ~/.elanous/conatus 하위). */
  sourceDb: string;
  /** 갱신 도구/스크립트(finance_* 도구명 또는 scripts 스크립트). */
  tool: string;
  /** 갱신 크론(있으면). 없으면 온디맨드. */
  cron: string | null;
  note: string;
}

/** 국면 벡터 축 — 대표 기획 신호 소스 지도. composite 8축(합 1.0) + transition 1축.
 *  한국장 중심(수급+섹터+펄스 0.52) · 미국(섹터+펄스 0.18) 선행 · 자산 0.19 글로벌 +
 *  매크로금리 0.05(유가·달러·미10년 방향). 순서 = 가중 내림차순.
 *  대표 통찰: 외국인 수급 × 한국 섹터 크로스(kr_sector). B(2026-07-08): asset_flow 0.24
 *  에서 0.05 를 macro_rates 로 분리(중복 — asset_flow note 가 이미 fx·macro 포함). */
export const REGIME_AXES: readonly RegimeAxis[] = [
  { key: 'asset_flow', name: '전세계 자산흐름', weight: 0.19, role: 'composite',
    sourceDb: 'x_asset.db', tool: 'finance_market_backbone', cron: '50 4 * * *',
    note: 'cross-asset regime(crypto·commodity·bonds·fx·macro) — 자금 큰 방향' },
  { key: 'macro_rates', name: '매크로 금리·달러', weight: 0.05, role: 'composite',
    sourceDb: 'regime.db', tool: 'macro-store', cron: '40 7 * * *',
    note: '유가·달러(DXY)·미10년 방향(금리↑·달러↑·원화약세=risk-off) — macro-store 추세' },
  { key: 'kr_flow', name: '외국인/기관 수급(시장)', weight: 0.20, role: 'composite',
    sourceDb: 'conatus/screener.db', tool: 'finance_kr_flow', cron: '10 19 * * 1-5',
    note: '외국인·기관 순매수(net_qty)·보유비중 — 시장 전체 자금 주체(한투 T+0)' },
  { key: 'kr_sector', name: '한국 섹터(모멘텀×외국인)', weight: 0.18, role: 'composite',
    sourceDb: 'conatus/screener.db', tool: 'finance_kr_flow', cron: '0 19 * * 1-5',
    note: 'screener sector(chain·mom·rank) × investor 크로스 — 섹터 모멘텀+어느 섹터로 외국인 자금' },
  { key: 'kr_pulse', name: '한국장 펄스(종목)', weight: 0.09, role: 'composite',
    sourceDb: 'conatus/screener.db', tool: 'samsung-koru-watch', cron: '0 19 * * 1-5',
    note: 'screener screen(급등락·스트릭·플래그) — 한국 종목 가격 펄스' },
  { key: 'community_buzz', name: '커뮤니티 버즈(감정)', weight: 0.05, role: 'composite',
    sourceDb: 'conatus/community_buzz.db', tool: 'community-buzz-cycle', cron: '*/10 * * * *',
    note: 'fmkorea 정성 감정 종합(Tier1 판정 importance≥5 non-spam·4h창) — 장중 retail 심리. 얇게 시작(정성 노이즈가 정량 국면 흔들지 않게·PLAN §5-③)' },
  { key: 'us_sector', name: '미국 섹터(13F)', weight: 0.12, role: 'composite',
    sourceDb: 'knowledge_13f.db', tool: 'finance_sector', cron: null,
    note: 'sector fusion — 가격 vs 13F 기관 발산(축적/분산·글로벌 기관)' },
  { key: 'us_pulse', name: '미국장 펄스(종목)', weight: 0.06, role: 'composite',
    sourceDb: 'conatus/us_pulse.db', tool: 'us-pulse', cron: '0 23 * * 1-5',
    note: '스트릭·주간변동±12%(미국장 머니무브·선행 신호)' },
  { key: 'geopolitics', name: '지정학·매크로 속보', weight: 0.06, role: 'composite',
    sourceDb: 'conatus/breaking_signals.db', tool: 'finance_signals', cron: '*/15 * * * *',
    note: 'x-breaking impact/market≥8(지정학·정책·매크로 — 고impact 몰림=불확실성)' },
  { key: 'dislocation', name: '이상 괴리', weight: 0, role: 'transition',
    sourceDb: 'conatus/breaking_signals.db', tool: 'finance_dislocation', cron: null,
    note: 'backbone vs X-센티 괴리 · sector fusion 발산 — 큰 국면 전환 조기신호' },
];

/** composite 축만(방향 가중 합성 대상). */
export function compositeAxes(): RegimeAxis[] {
  return REGIME_AXES.filter(a => a.role === 'composite');
}

/** 키로 축 조회. */
export function axisByKey(key: RegimeAxis['key']): RegimeAxis | undefined {
  return REGIME_AXES.find(a => a.key === key);
}
