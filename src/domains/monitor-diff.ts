// ── 모니터 diff → 신규 기사 헤드라인 추출 (2026-07-07 · 대표 피드백) ────
//
// "변경 감지 (1건) • ✏️ url"만 오고 기사가 없다는 지적 — Firecrawl 체크
// 상세의 page.diff.text(git-diff 형식 markdown)에서 **추가된(+) 라인의
// 기사 링크**를 뽑아 알림에 동봉한다. 추가 스크랩 없음 = 크레딧 0.
//
// 노이즈 필터(매경 실측): 시세 티커(숫자%\\ 반복)·이미지 링크(![·wimg·확장자)·
// 순번 장식(_5_\\ **) 제거. 멀티라인 마크다운 링크 때문에 라인이 아니라
// 추가분 blob 전체에서 매칭. [[feedback_llm_node_pure_helper_pattern]] —
// pure helper + 단위테스트.

export interface DiffHeadline { title: string; url: string }

/** git-diff 텍스트에서 추가(+)된 기사 링크 추출 — 제목·URL 정제 + dedupe. */
export function extractDiffHeadlines(diffText: string, maxItems = 5): DiffHeadline[] {
  const blob = diffText.split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1))
    .join('\n');
  const seen = new Set<string>();
  const out: DiffHeadline[] = [];
  // (?<!!) — 이미지 링크 ![...] 제외. 제목 뒤 `\\ 요약...` 꼬리는 비탐욕 스킵.
  const re = /(?<!!)\[(?:\*\*)?([^\][]{8,160}?)(?:\*\*)?(?:\s*\\\\[\s\S]{0,500}?)?\]\((https?:\/\/[^)\s]+)\)/g;
  for (const m of blob.matchAll(re)) {
    const url = m[2]!;
    if (/\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(url) || /wimg\./.test(url)) continue;
    const title = cleanTitle(m[1]!);
    if (!title || title.length < 8) continue;
    if (/^[\d.,\s%\\-]+$/.test(title)) continue; // 시세 티커 잔여
    const key = title.replace(/\W/g, '').slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url });
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/_\d+_\s*/g, ' ')      // 순번 장식 _5_
    .replace(/\\\\/g, ' ')           // 마크다운 개행 \\
    .replace(/\*\*/g, '')            // 볼드 잔여
    .replace(/^[!\s>•·-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 구조 필터 + slug 제목 복원 (2026-07-07 대표 피드백 2탄) ─────────────
// Reuters 실사례: "NegativeN225"·"BusinessCategory"·"Brent Crude Oil"(시세
// 위젯/카테고리 내비 링크)이 기사로 추출. TrendForce: 앵커텍스트 "View More"가
// 제목으로. → 내비/위젯 URL 필터 + 무의미 제목은 URL slug에서 복원.

/** 내비게이션·시세위젯·카테고리 URL — 기사 아님. */
export function isNavigationUrl(url: string): boolean {
  if (/\/(quote|quotes|chart|markets\/companies)\//i.test(url)) return true; // 시세 위젯
  try {
    const u = new URL(url);
    // 경로가 얕은 섹션 루트(세그먼트 ≤2 · 숫자/slug 없음) = 카테고리 내비
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length <= 2 && !segs.some(s => /\d|[-_].*[-_]/.test(s))) return true;
  } catch { /* URL 파싱 실패 — 통과 */ }
  return false;
}

/** 무의미 앵커텍스트 — "View More"·카테고리명·시세위젯 라벨 등 (공백 제거 후 매칭). */
const MEANINGLESS_TITLE = /^(viewmore|readmore|more|seeall|business|markets?|category|[a-z]+category|(negative|positive)?[.\w]{0,12}\d{2,4})$/i;

export function isMeaninglessTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 8) return true;
  if (MEANINGLESS_TITLE.test(t.replace(/\s+/g, ''))) return true;
  return false;
}

/** URL slug → 제목 복원 (TrendForce류: /news/2026/07/07/news-samsung-sk-hynix-...-adoption/). */
export function titleFromSlug(url: string): string | null {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    const slug = [...segs].reverse().find(s => /-.*-/.test(s) && !/^\d+$/.test(s));
    if (!slug) return null;
    const words = slug.replace(/^news-/, '').split('-').filter(w => w.length > 0);
    if (words.length < 4) return null;
    return words.join(' ');
  } catch { return null; }
}

/** 구조 필터 적용 — 내비/위젯 제거 · 무의미 제목은 slug 복원(복원 실패 시 드랍). */
export function refineHeadlines(items: DiffHeadline[]): DiffHeadline[] {
  const out: DiffHeadline[] = [];
  for (const h of items) {
    if (isNavigationUrl(h.url)) continue;
    let title = h.title;
    if (isMeaninglessTitle(title)) {
      const restored = titleFromSlug(h.url);
      if (!restored) continue;
      title = restored;
    }
    out.push({ title, url: h.url });
  }
  return out;
}

// ── LLM 통합 판정 — 중요도 + 기발송 중복 (1콜·배치) ─────────────────────
// 대표 피드백: "해석도 없고 중요함 표시도 없다" + "삼성 소식 6h 중복".
// 헤드라인 N건과 최근 6h 발송분을 한 프롬프트로 — {중요도 0-10, 한국어 해석,
// 기발송 중복 여부}. LLM 전멸 시 fail-open(구조필터 통과분에 판정불가 태그 —
// 정보 유실 방지) — 억제는 확신 있을 때만.

export interface JudgedHeadline extends DiffHeadline {
  importance: number | null; // null = 판정불가
  reason: string | null;     // 한국어 한 줄 해석
  dupOfRecent: boolean;
}

export async function judgeMonitorHeadlines(
  headlines: DiffHeadline[],
  recent: Array<{ text: string; reason: string | null }>,
  llm: (p: string) => Promise<string | null>,
): Promise<JudgedHeadline[]> {
  if (headlines.length === 0) return [];
  const list = headlines.map((h, i) => `${i + 1}. ${h.title}`).join('\n');
  // 상한 40 — recentSentSignals가 최신순이라 최근 발송분 우선. dedupe로 프롬프트 압축.
  const recentKeys = [...new Set(recent.map(r => (r.reason ?? r.text).slice(0, 120)))].slice(0, 40);
  const recentBlock = recentKeys.length
    ? `\n최근 6시간 내 이미 발송된 소식:\n${recentKeys.map((k, i) => `R${i + 1}. ${k}`).join('\n')}`
    : '';
  const prompt = `다음 뉴스 헤드라인들의 투자 관점 중요도를 판정해 JSON 배열만 출력(설명 금지).
각 항목: {"i":번호,"importance":0-10,"reason":"한국어 한 줄 = 번역+투자 함의","dup":true|false(이미 발송된 소식과 같은 사건이면 true)}
중요도 기준: 시장/섹터(반도체·한국 중심) 움직일 소식 7-10 · 업계 유의 5-6 · 개별 홍보성/지엽 0-4.

헤드라인:
${list}${recentBlock}`;
  const out = await llm(prompt);
  const fallback = (): JudgedHeadline[] =>
    headlines.map(h => ({ ...h, importance: null, reason: null, dupOfRecent: false }));
  if (!out) return fallback();
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) return fallback();
  try {
    const arr = JSON.parse(m[0]) as Array<{ i?: number; importance?: number; reason?: string; dup?: boolean }>;
    const byIdx = new Map(arr.filter(v => typeof v?.i === 'number').map(v => [v.i!, v]));
    return headlines.map((h, idx) => {
      const v = byIdx.get(idx + 1);
      const imp = typeof v?.importance === 'number' ? Math.min(10, Math.max(0, v.importance)) : null;
      return {
        ...h,
        importance: imp,
        reason: typeof v?.reason === 'string' && v.reason.trim() ? v.reason.trim() : null,
        dupOfRecent: v?.dup === true,
      };
    });
  } catch { return fallback(); }
}

/** 알림 본문용 헤드라인 블록 렌더 — 없으면 빈 문자열. */
export function renderDiffHeadlines(items: Array<DiffHeadline & { reason?: string | null; importance?: number | null }>): string {
  if (items.length === 0) return '';
  return items.map(h => {
    const imp = typeof h.importance === 'number' ? ` [중요도 ${h.importance}]` : '';
    const reason = h.reason ? `\n    ↳ ${h.reason.slice(0, 120)}` : '';
    return `  - ${h.title.slice(0, 90)}${imp}${reason}\n    ${h.url}`;
  }).join('\n');
}
