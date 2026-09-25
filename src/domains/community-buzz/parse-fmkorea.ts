// ── fmkorea 주식 게시판 리스트 파서 (커뮤니티 버즈 P1 · 2026-07-09) ──────────
//
// PLAN-community-buzz-surveillance-2026-07-09 §4b. Firecrawl(proxy:stealth) 로 받은
// 리스트 페이지 마크다운 → 게시글 행 파싱. 라이브 실증(2026-07-09)으로 셀렉터 확정:
//   행 = `| [탭](category=..) | [제목](/postid) | [![lvl]글쓴이] | 시각 | 조회 | 추천 |`
// 공지(탭=공지)는 제외. 카테고리로 국내주식/해외주식/잡담 구분 → 라우팅(KR/US).
//
// 순수 함수(무IO) — 픽스처로 단위테스트.

export interface FmkoreaPost {
  postId: string;
  category: string;       // 국내주식|해외주식|잡담|...
  title: string;
  author: string;
  timeLabel: string;      // 오늘글 "22:53" · 과거글 "25.07.09"
  postedAt: string | null; // ★ timeLabel → ISO(KST 해석). freshness 척도의 근거(대표 지시).
  views: number | null;   // firehose 만
  recommends: number;
  comments?: number;      // popular 만(제목 뒤 [N])
  url: string;
}

// ── 타임값 · freshness (대표 지시: 둘 다 항상 타임 중요 · fresh 정도가 중요 척도) ──

/** fmkorea timeLabel → ISO. 오늘글 "HH:MM"(KST) · 과거글 "YY.MM.DD". 실패 시 null.
 *  자정 롤오버: HH:MM 이 현재보다 2h 이상 미래면 어제로 간주. */
export function parsePostedAt(label: string, nowMs: number = Date.now()): string | null {
  const t = (label ?? '').trim();
  const KST = 9 * 3600_000;
  let m = t.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (m) return new Date(Date.UTC(2000 + +m[1]!, +m[2]! - 1, +m[3]!, 0, 0) - KST).toISOString();
  m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const kstNow = new Date(nowMs + KST);
    let postUtc = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), +m[1]!, +m[2]!) - KST;
    if (postUtc - nowMs > 2 * 3600_000) postUtc -= 24 * 3600_000; // 미래면 어제
    return new Date(postUtc).toISOString();
  }
  return null;
}

/** freshness 척도 0~1 — 방금=1, 지수감쇠(기본 반감 45분·빠른 보드라 짧게). */
export function freshnessScore(postedAtIso: string | null, nowMs: number = Date.now(), halflifeMin = 45): number {
  if (!postedAtIso) return 0;
  const ageMin = Math.max(0, (nowMs - Date.parse(postedAtIso)) / 60_000);
  return Math.exp(-ageMin / halflifeMin);
}

/** 한국어 숫자(만/백만/쉼표) → 정수. "1백만"=1_000_000·"92만"=920_000·"213"=213. */
export function parseKoreanNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '');
  if (!s) return null;
  const m = s.match(/^([\d.]+)\s*(백만|만|천)?/);
  if (!m || !m[1]) return null;
  const v = parseFloat(m[1]);
  if (Number.isNaN(v)) return null;
  const unit = m[2];
  const mul = unit === '백만' ? 1_000_000 : unit === '만' ? 10_000 : unit === '천' ? 1_000 : 1;
  return Math.round(v * mul);
}

const TITLE_RE = /\[([^\]]+)\]\((?:https?:\/\/(?:www\.)?fmkorea\.com\/)?(\d{6,})\)/;
const TAB_RE = /\[([^\]]+)\]/;

/** 리스트(firehose) 마크다운 → 게시글 배열(공지 제외). 파싱 실패 행은 스킵(fail-soft). */
export function parseFmkoreaList(markdown: string, nowMs: number = Date.now()): FmkoreaPost[] {
  const out: FmkoreaPost[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('| [')) continue; // 표 데이터 행만(헤더/구분선 제외)
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (cells.length < 5) continue;
    const tab = cells[0]?.match(TAB_RE)?.[1] ?? '';
    if (!tab || tab === '공지') continue; // 공지 제외
    const tm = cells[1]?.match(TITLE_RE);
    if (!tm || !tm[1] || !tm[2]) continue;
    const title = tm[1].trim();
    const postId = tm[2];
    // 글쓴이 셀 = `[![lvl](img)닉네임](url)` (중첩 브래킷) → 마지막 `](url)` 앞 텍스트만.
    const author = cells[2]?.match(/([^)\]]+)\]\([^)]*\)\s*$/)?.[1]?.trim() || '?';
    const timeLabel = cells[3] ?? '';
    const views = parseKoreanNumber(cells[4] ?? '');
    const recommends = cells[5] ? (parseKoreanNumber(cells[5]) ?? 0) : 0;
    out.push({ postId, category: tab, title, author, timeLabel, postedAt: parsePostedAt(timeLabel, nowMs), views, recommends, url: `https://www.fmkorea.com/${postId}` });
  }
  return out;
}

// ── 인기글(popular) 파서 — 웹진/카드 레이아웃(firehose 표와 완전 다름·라이브 실증) ──
// 블록 순서: `[카테고리](category=)` → `HH:MM / 글쓴이` → `- [추천 N](srl=ID)` →
//   `### [제목\[댓글수\]](srl=ID)`. postId=document_srl. 조회 없음·추천/댓글/순위 있음.
const CAT_LINE_RE = /^\[([^\]]+)\]\(https?:\/\/[^)]*category=\d+\)\s*$/;
const TIME_AUTHOR_RE = /^(\d{1,2}:\d{2})\s*\/\s*(.+?)\s*$/;
const REC_RE = /추천\s+(\d+).*document_srl=(\d{6,})/;
const HEAD_RE = /^###\s*\[(.+)\]\((https?:\/\/[^)]*document_srl=(\d{6,})[^)]*)\)/;

/** 인기글 마크다운 → 게시글 배열(순위 순). 각 글은 heading 에서 방출·직전 pending 상태 부착. */
export function parseFmkoreaPopular(markdown: string, nowMs: number = Date.now()): FmkoreaPost[] {
  const out: FmkoreaPost[] = [];
  let cat = '', timeLabel = '', author = '', recSrl = '', recommends = 0;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    let m = line.match(CAT_LINE_RE);
    if (m) { cat = m[1]!; continue; }
    m = line.match(TIME_AUTHOR_RE);
    if (m) { timeLabel = m[1]!; author = m[2]!.trim(); continue; }
    m = line.match(REC_RE);
    if (m) { recommends = parseInt(m[1]!, 10); recSrl = m[2]!; continue; }
    m = raw.match(HEAD_RE);
    if (m) {
      const postId = m[3]!;
      // 제목 뒤 [댓글수]만 제거(선행 [한투...] 등 대괄호는 보존).
      const cm = m[1]!.match(/^(.*?)\s*\\?\[(\d+)\\?\]\s*$/);
      const title = (cm ? cm[1]! : m[1]!).trim();
      const comments = cm ? parseInt(cm[2]!, 10) : 0;
      out.push({
        postId, category: cat || '?', title, author: author || '?', timeLabel,
        postedAt: parsePostedAt(timeLabel, nowMs), views: null,
        recommends: recSrl === postId ? recommends : 0, comments,
        url: `https://www.fmkorea.com/${postId}`,
      });
      recSrl = ''; recommends = 0; // 소비 후 리셋(다음 글 오염 방지)
    }
  }
  return out;
}
