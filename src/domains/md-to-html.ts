// ── 경량 결정론적 Markdown → HTML 렌더러 (종합 아침 브리핑 · 2026-07-10) ──────────
//
// repo 에 remark/marked 등 md 라이브러리가 없어(obsidian-pwa 는 PWA 번들 전용) 서버측
// cron 에서 쓸 in-process 렌더러를 자급한다. 아침 상세 리포트에 필요한 부분집합만:
// 헤딩·GFM 테이블·목록·굵게/기울임/인라인코드·링크·수평선·인용·문단. HTML 이스케이프.
// 외부 입력이 아니라 우리 조립 markdown 이 입력이므로 sanitize 는 이스케이프로 충분.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 인라인: **굵게** *기울임* `코드` [텍스트](url). 이스케이프 후 적용. */
function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}
function cells(row: string): string[] {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}

/** Markdown 본문 → HTML 조각(문서 래퍼 없음). */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let listType: 'ul' | 'ol' | null = null;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // 펜스 코드블록 ``` … ``` — 정렬 보존(금융 테이블 monospace). 이스케이프만.
    if (/^```/.test(trimmed)) {
      closeList();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) { buf.push(esc(lines[i]!)); i++; }
      i++; // 닫는 ```
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }

    if (!trimmed) { closeList(); i++; continue; }

    // 수평선
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { closeList(); out.push('<hr>'); i++; continue; }

    // 헤딩
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) { closeList(); const lv = h[1]!.length; out.push(`<h${lv}>${inline(h[2]!)}</h${lv}>`); i++; continue; }

    // GFM 테이블: 헤더행 + 구분행 + 본문행
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      closeList();
      const header = cells(trimmed);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.trim().includes('|') && lines[i]!.trim()) {
        body.push(cells(lines[i]!.trim())); i++;
      }
      out.push('<table><thead><tr>' + header.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }

    // 인용
    if (/^>\s?/.test(trimmed)) { closeList(); out.push(`<blockquote>${inline(trimmed.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }

    // 목록
    const ul = /^[-*]\s+(.*)$/.exec(trimmed);
    const ol = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ul || ol) {
      const want: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType !== want) { closeList(); out.push(`<${want}>`); listType = want; }
      out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
      i++; continue;
    }

    // 문단
    closeList();
    out.push(`<p>${inline(trimmed)}</p>`);
    i++;
  }
  closeList();
  return out.join('\n');
}

export interface HtmlPageOpts { title: string; bodyMd: string; imageUrl?: string; subtitle?: string }

/** iPad 친화 스타일 문서. bodyMd 를 렌더하고 상단에 제목/부제/히트맵 이미지(선택) 삽입. */
export function renderHtmlPage(opts: HtmlPageOpts): string {
  const body = mdToHtml(opts.bodyMd);
  const img = opts.imageUrl ? `<img class="heatmap" src="${esc(opts.imageUrl)}" alt="S&amp;P 히트맵">` : '';
  const sub = opts.subtitle ? `<p class="subtitle">${esc(opts.subtitle)}</p>` : '';
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Pretendard", system-ui, sans-serif;
    line-height: 1.65; max-width: 820px; margin: 0 auto; padding: 24px 18px 80px;
    color: #1a1a1a; background: #fafafa; -webkit-text-size-adjust: 100%; }
  @media (prefers-color-scheme: dark) { body { color: #e6e6e6; background: #161618; } }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.25rem; margin: 2rem 0 .6rem; padding-bottom: .3rem; border-bottom: 1px solid #8883; }
  h3 { font-size: 1.05rem; margin: 1.4rem 0 .4rem; }
  .subtitle { color: #8a8a8a; margin: 0 0 1.2rem; font-size: .92rem; }
  table { border-collapse: collapse; width: 100%; margin: .8rem 0; font-size: .9rem; }
  th, td { border: 1px solid #8884; padding: 6px 10px; text-align: left; }
  th { background: #8881; font-weight: 600; }
  code { background: #8882; padding: 1px 5px; border-radius: 4px; font-size: .88em; }
  blockquote { border-left: 3px solid #8886; margin: .8rem 0; padding: .2rem 0 .2rem 14px; color: #7a7a7a; }
  ul, ol { padding-left: 1.4rem; } li { margin: .2rem 0; }
  hr { border: none; border-top: 1px solid #8883; margin: 2rem 0; }
  img.heatmap { width: 100%; border-radius: 10px; margin: 1rem 0; border: 1px solid #8883; }
  a { color: #2a7ae2; }
</style></head><body>
<h1>${esc(opts.title)}</h1>
${sub}
${img}
${body}
</body></html>`;
}
