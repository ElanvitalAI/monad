// ── 아침 매크로 브리핑 — 유가·달러·환율·미10년 국채 (2026-07-08) ──────────
//
// 대표 요구: 아침 브리핑에 매크로 백드롭(유가·달러인덱스·원달러·미 10년물)을
// 한 줄로. 데이터는 omni-market(EODHD/Yahoo)으로 이미 확보 — 새 구독 불필요.
// 담당 루프 = 아침 리포트(morning-report). 이 모듈은 순수(포맷+조립) — I/O는
// 주입(MacroDeps)해 테스트 결정론. 프로덕션 배선은 morning-report 가 omniQuote/
// omniUst10y 로 주입.
//
// ★ 유가·달러는 지수/선물 심볼이 omni-market 에서 값을 안 줘(EODHD 0·commodity
//   no-data) ETF 프록시(USO=WTI·UUP=DXY)의 %변화로 "방향"만 표시(절대값 무의미
//   → 생략). 원달러(실 환율)·미10년(실 수익률)은 실값 표시.
//
// 근거: 내부 문서... 인접 · BACKLOG-conatus.

export interface MacroQuote { close: number; changePct: number }

export interface MacroDeps {
  /** 심볼 시세(fail-soft null). morning-report 가 omniQuote 주입. */
  quote: (symbol: string) => MacroQuote | null;
  /** 미 10년물 최신 수익률(%·fail-soft null). omniUst10y 주입. */
  ust10y: () => number | null;
}

export interface MacroItem {
  label: string;
  /** 실값 표시(환율·수익률). 프록시(유가·달러)는 빈 문자열 — %변화만. */
  value: string;
  /** 일간 %변화. null = 변화 미표시(수익률). */
  changePct: number | null;
}

/** 매크로 심볼 정의 — label·심볼·실값표시 여부. */
const MACRO_SYMBOLS: Array<{ label: string; symbol: string; showValue: boolean; suffix?: string }> = [
  { label: '유가(WTI)', symbol: 'USO.US', showValue: false },        // ETF 프록시 — 방향만
  { label: '달러(DXY)', symbol: 'UUP.US', showValue: false },        // ETF 프록시 — 방향만
  { label: '원/달러', symbol: 'USDKRW.FOREX', showValue: true },      // 실 환율
];

function arrow(c: number | null): string {
  if (c == null) return '';
  return c > 0.05 ? '▲' : c < -0.05 ? '▼' : '·';
}

/** 매크로 항목 조립(주입된 fetcher·항목별 fail-soft). 실패 항목은 빠진다. */
export function buildMacroItems(deps: MacroDeps): MacroItem[] {
  const items: MacroItem[] = [];
  for (const m of MACRO_SYMBOLS) {
    const q = deps.quote(m.symbol);
    if (!q) continue;
    items.push({ label: m.label, value: m.showValue ? q.close.toFixed(1) : '', changePct: q.changePct });
  }
  const y = deps.ust10y();
  if (y != null && y > 0) items.push({ label: '미10년', value: `${y.toFixed(2)}%`, changePct: null });
  return items;
}

/** 매크로 항목 → 브리핑 섹션 텍스트. 빈 항목이면 '' (섹션 생략). */
export function formatMacroBriefing(items: MacroItem[]): string {
  if (!items.length) return '';
  const parts = items.map((it) => {
    const chg = it.changePct == null
      ? ''
      : ` ${arrow(it.changePct)}${it.changePct >= 0 ? '+' : ''}${it.changePct.toFixed(2)}%`;
    return `${it.label}${it.value ? ` ${it.value}` : ''}${chg}`;
  });
  return `\n📈 *매크로 핵심*\n  ${parts.join(' · ')}`;
}

/** 조립+포맷 원샷(morning-report 편의). */
export function renderMacroBriefing(deps: MacroDeps): string {
  return formatMacroBriefing(buildMacroItems(deps));
}

/** 매크로 raw 스냅샷(macro-store 영속용). value 아닌 원값. */
export interface MacroRaw { oilPct?: number; dxyPct?: number; usdkrw?: number; ust10y?: number }

/** ★ B — 단일 fetch 로 표시 items + 영속 snapshot 을 함께 낸다(omni-market 호출
 *  중복 방지). morning-report 가 이걸로 표시 + 추적관찰(macro-store) 폐루프. */
export function buildMacro(deps: MacroDeps): { items: MacroItem[]; snapshot: MacroRaw } {
  const oil = deps.quote('USO.US');
  const dxy = deps.quote('UUP.US');
  const krw = deps.quote('USDKRW.FOREX');
  const y = deps.ust10y();
  const items: MacroItem[] = [];
  if (oil) items.push({ label: '유가(WTI)', value: '', changePct: oil.changePct });
  if (dxy) items.push({ label: '달러(DXY)', value: '', changePct: dxy.changePct });
  if (krw) items.push({ label: '원/달러', value: krw.close.toFixed(1), changePct: krw.changePct });
  if (y != null && y > 0) items.push({ label: '미10년', value: `${y.toFixed(2)}%`, changePct: null });
  const snapshot: MacroRaw = {
    ...(oil ? { oilPct: oil.changePct } : {}),
    ...(dxy ? { dxyPct: dxy.changePct } : {}),
    ...(krw ? { usdkrw: krw.close } : {}),
    ...(y != null && y > 0 ? { ust10y: y } : {}),
  };
  return { items, snapshot };
}
