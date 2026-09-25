// ── finviz S&P 히트맵 이미지 티어 (2026-07-08 · A2) ──────────────────────
//
// 대표 요구 "둘 다"(데이터+이미지). A1(데이터티어·map_perf 텍스트) 위에, 실제
// 히트맵 시각을 firecrawl 스크린샷으로 캡처해 텔레그램에 첨부(iPad/폰 한눈에).
// 외부 커뮤니티 표준 패턴(맵 .ashx → 스크린샷/vision → 브리핑) 검증됨.
//
// ★ firecrawl v2 /scrape formats:['screenshot'] → JS canvas 렌더 PNG URL 반환
//   (실증: 대표 붙인 것과 동일 히트맵). 반환은 공개 googleapis URL — 텔레그램
//   sendPhoto 가 URL 직접 fetch(파일 업로드 불필요). fail-soft null.
//
// ⚠️ 2026-07-09 대표 리포트: 아침 히트맵이 이틀 전(화) 이미지로 발송(MU 등 부호
//   반대). 원인 = firecrawl v2 는 maxAge 미지정 시 최대 2일 캐시(cacheState=hit)
//   를 반환 → stale 스크린샷. 실측: no-maxAge=5.8s(캐시 hit·화요일자) vs
//   maxAge:0=31s(실렌더·당일). 히트맵은 매일 다르므로 반드시 fresh 강제.
//
// 주입 fetcher(테스트 결정론). 근거: BACKLOG-conatus §A(대표 지시).

const FINVIZ_MAP_PAGE = 'https://finviz.com/map.ashx?t=sec';
const FIRECRAWL_SCRAPE = 'https://api.firecrawl.dev/v2/scrape';

export type ScreenshotFetcher = (apiKey: string, url: string) => Promise<string | null>;

/** finviz 맵 페이지 → firecrawl 스크린샷 PNG URL. 키 없거나 실패 = null(fail-soft). */
export async function captureFinvizMapImageUrl(
  apiKey: string | undefined,
  fetcher: ScreenshotFetcher = firecrawlScreenshot,
): Promise<string | null> {
  if (!apiKey || !apiKey.trim()) return null;
  try { return await fetcher(apiKey.trim(), FINVIZ_MAP_PAGE); } catch { return null; }
}

async function firecrawlScreenshot(apiKey: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(FIRECRAWL_SCRAPE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      // maxAge:0 = 캐시 무시·항상 fresh 스크린샷(stale 히트맵 방지·위 주석 참고).
      body: JSON.stringify({ url, formats: ['screenshot'], waitFor: 7000, maxAge: 0 }),
      signal: AbortSignal.timeout(70_000),
    });
    if (!res.ok) return null;
    const j = await res.json() as { success?: boolean; data?: { screenshot?: string } };
    return j?.data?.screenshot ?? null;
  } catch { return null; }
}
