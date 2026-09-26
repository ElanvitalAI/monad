// ── 디스코드 마크다운 렌더 보정 (2026-07-16) ─────────────────────────────────────
//
// 디스코드 네이티브 마크다운은 **GFM 테이블·수평선(---)을 지원하지 않는다**(bold/italic/code/
// codeblock/quote/list/header 는 지원). elanous 가 GFM 을 생성하면 테이블은 `| a | b |` raw, `---`
// 는 그대로 노출돼 깨진다. 이 모듈이 디스코드 배달 直前 텍스트를 디스코드가 렌더 가능한 형태로 보정:
//  - GFM 테이블 → 열 너비 정렬 후 ```code block```(디스코드는 코드블록서 monospace 정렬 유지)
//  - 수평선(---, ***, ___) → 유니코드 구분선(─────)
//
// 순수 함수 — I/O 없음. finalize(완성 텍스트)에 적용(스트리밍 중 미완 테이블은 어차피 부분).

/** 한 줄이 테이블 행인가(`| … |`). */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length >= 2;
}

/** 테이블 구분선인가(`|---|:--:|` 류·셀이 전부 -,:,공백). */
function isTableSeparator(line: string): boolean {
  if (!isTableRow(line)) return false;
  return line.trim().slice(1, -1).split('|').every((c) => /^[\s:-]+$/.test(c) && c.includes('-'));
}

/** 인라인 마크다운 기호 제거 — 테이블 셀은 코드블록(monospace) 안으로 들어가 마크다운이 렌더 안
 *  되므로 `**253,500원**` 같은 raw 기호를 벗긴다(굵게/기울임/코드/취소선/밑줄). */
function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')   // **bold**
    .replace(/`([^`]+)`/g, '$1')          // `code`
    .replace(/~~([^~]+)~~/g, '$1')        // ~~strike~~
    .replace(/__([^_]+)__/g, '$1')        // __underline__
    .replace(/\*([^*]+)\*/g, '$1');       // *italic* (** 는 위에서 이미 제거)
}

/** `| a | b |` 행 → 셀 배열(양끝 파이프 제거·trim·셀 내 마크다운 strip). */
function splitCells(line: string): string[] {
  return line.trim().slice(1, -1).split('|').map((c) => stripInlineMarkdown(c.trim()));
}

/** GFM 테이블 블록(행들) → 정렬된 monospace 텍스트(코드블록 없이·감싸기는 호출측). */
function renderTable(rows: string[][]): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    widths[c] = Math.max(...rows.map((r) => (r[c] ?? '').length), 3);
  }
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  const lines = rows.map((r) => r.map((cell, c) => pad(cell, widths[c]!)).join(' │ '));
  // 헤더 아래 구분선 삽입(가독성).
  if (lines.length >= 1) {
    const sep = widths.map((w) => '─'.repeat(w)).join('─┼─');
    lines.splice(1, 0, sep);
  }
  return lines.join('\n');
}

/** 수평선 줄인가(---, ***, ___ 3+ · 그 문자만). */
function isHorizontalRule(line: string): boolean {
  const t = line.trim();
  return /^(-{3,}|\*{3,}|_{3,})$/.test(t);
}

/**
 * 디스코드 배달용 마크다운 보정. GFM 테이블→정렬 코드블록, 수평선→유니코드 구분선.
 * 나머지 마크다운(bold/italic/code/list/header/quote)은 디스코드 네이티브라 무변경.
 */
export function formatForDiscord(text: string): string {
  return formatTablesAndRules(text);
}

/**
 * 테이블/수평선 보정 — 디스코드·텔레그램 **공용**. 둘 다 GFM 테이블·수평선(---)을 네이티브로
 * 렌더 못 하지만(디스코드 마크다운·텔레그램 MarkdownV2 모두), ``` 코드블록은 지원한다(텔레그램은
 * markdownToTelegramHtml 이 ```→<pre> 변환·monospace 정렬 유지). 그래서 테이블→정렬 코드블록·
 * ---→유니코드 구분선 보정이 양 서피스에 공통 적용된다.
 */
export function formatTablesAndRules(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // 테이블 감지 — 연속 테이블 행 2줄+ (헤더 + 구분선 포함이면 진짜 테이블).
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const block: string[][] = [];
      let j = i;
      while (j < lines.length && isTableRow(lines[j]!)) {
        if (!isTableSeparator(lines[j]!)) block.push(splitCells(lines[j]!));
        j++;
      }
      out.push('```', renderTable(block), '```');
      i = j;
      continue;
    }
    // 수평선 → 유니코드 구분선.
    if (isHorizontalRule(line)) {
      out.push('─'.repeat(20));
      i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}
