// 하니스 R3 신호/분석 게이트 — 판단층(부작용0 · 2026-07-22)
//
// PLAN-execution-cycle-harness-expansion §트랙 R3. 수집 corpus/objective 에서 종목을 추출해
// asset-attractiveness 규율 신호(BUY/HOLD/SELL · ±1σ)를 **판단 참고로만** grounding 에 얹는다.
// ⚠️ 판단층 — 집행(주문) 아님. scores.db READ-ONLY(readAttractiveness) 재사용 = 부작용0.
//   신호 없음/DB 부재 = null(fail-soft · plan 무영향). domain-presets(executor·파일 write)와 층위가 다름.
//
// ★ 제1원칙 관측은 호출측(harness-seams plan 어댑터)이 observe('signal-gated', …)로 남긴다.

import { readAttractiveness, type AttractivenessVerdict } from '../domains/attractiveness-read.js';

/** objective/corpus 에서 한국 종목 티커 후보를 추출. 6자리 코드(옵션 .KO/.KS 접미) 패턴.
 *  scores.db 의 symbol 은 '005930.KO' 형태라, 접미 없는 코드도 .KO/.KS 변형으로 조회 시도한다. */
export function extractSymbolCandidates(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(\d{6})(?:\.(KO|KS))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = m[1]!;
    if (m[2]) out.add(`${code}.${m[2]}`);   // 명시 접미 그대로
    else { out.add(`${code}.KO`); out.add(`${code}.KS`); out.add(code); }   // 변형 시도
  }
  return [...out];
}

export interface SignalGateResult {
  block: string;                      // grounding 에 얹을 렌더 문자열
  verdicts: AttractivenessVerdict[];  // 관측/테스트용 구조화 신호
}

/**
 * objective(+prepend 된 R1 corpus)에서 종목을 뽑아 매력도 신호를 조회·렌더한다. 신호 0건이면 null.
 * @param read 테스트 seam(기본 readAttractiveness · scores.db READ-ONLY).
 */
export function buildAttractivenessSignal(
  objective: string,
  read: (symbol: string) => AttractivenessVerdict | null = readAttractiveness,
): SignalGateResult | null {
  const candidates = extractSymbolCandidates(objective);
  if (!candidates.length) return null;
  const seen = new Set<string>();
  const verdicts: AttractivenessVerdict[] = [];
  for (const sym of candidates) {
    const v = read(sym);
    if (v && !seen.has(v.symbol)) { seen.add(v.symbol); verdicts.push(v); }
  }
  if (!verdicts.length) return null;
  const lines = verdicts.map((v) =>
    `- ${v.symbol}: ${v.signal} (score ${v.score}${v.z != null ? ` · z ${v.z >= 0 ? '+' : ''}${v.z}` : ''} · ${v.asOf})`,
  );
  const block = `[규율 신호 — asset-attractiveness ±1σ · 판단 참고(집행 아님)]\n${lines.join('\n')}`;
  return { block, verdicts };
}
