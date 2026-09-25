// ── Vault 순수 헬퍼 (OP3 · 2026-07-09) ────────────────────────────────────
// wikilink 자동완성 감지·outline 파싱·basename 추출. 순수 함수(테스트 용이).

export interface Heading { level: number; text: string; line: number }

/** markdown 본문 → heading outline(# 1-6). 코드펜스 안 heading 은 제외. */
export function parseOutline(md: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  md.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) { inFence = !inFence; return; }
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) out.push({ level: m[1]!.length, text: m[2]!.trim(), line: i });
  });
  return out;
}

/** 커서 위치 기준 미완성 wikilink(`[[partial`) 감지 → 부분 질의. 없으면 null.
 *  가장 가까운 여는 `[[` 가 닫는 `]]` 없이 커서 앞에 있으면 그 사이 텍스트. */
export function activeWikilinkQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('[[');
  if (open < 0) return null;
  const between = before.slice(open + 2);
  // 사이에 닫힘/개행 있으면 무효.
  if (between.includes(']]') || between.includes('\n')) return null;
  return { query: between, start: open + 2 };
}

/** wikilink 삽입 — start~caret 을 basename 으로 교체하고 `]]` 부착. */
export function insertWikilink(text: string, start: number, caret: number, basename: string): { text: string; caret: number } {
  const head = text.slice(0, start);
  const tail = text.slice(caret);
  const insert = `${basename}]]`;
  return { text: head + insert + tail, caret: head.length + insert.length };
}

/** 경로 → basename(확장자 제거·wikilink target). */
export function noteBasename(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

// ── 그래프 force 레이아웃 (OP4) — 경량 결정론 시뮬(무 dep) ──────────────
export interface GNode { id: string; x: number; y: number; deg: number }
export interface GEdge { source: string; target: string }

/** 결정론 force-directed 레이아웃 — 초기 원형 배치 후 반발(repulsion)+스프링 반복.
 *  Math.random 미사용(SSR 안전·재현). width/height 안에서 위치 산출. */
export function layoutForce(
  nodeIds: string[], edges: GEdge[],
  opts: { width: number; height: number; iterations?: number } = { width: 800, height: 600 },
): GNode[] {
  const { width, height } = opts;
  const iterations = opts.iterations ?? 120;
  const n = nodeIds.length;
  const deg = new Map<string, number>();
  for (const e of edges) { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1); }
  // 초기 원형 배치(결정론·index 기반).
  const cx = width / 2, cy = height / 2, R = Math.min(width, height) * 0.4;
  const nodes: GNode[] = nodeIds.map((id, i) => ({
    id, deg: deg.get(id) ?? 0,
    x: cx + R * Math.cos((2 * Math.PI * i) / Math.max(1, n)),
    y: cy + R * Math.sin((2 * Math.PI * i) / Math.max(1, n)),
  }));
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const k = Math.sqrt((width * height) / Math.max(1, n)); // 이상 거리
  for (let it = 0; it < iterations; it++) {
    const disp = nodes.map(() => ({ x: 0, y: 0 }));
    // 반발(모든 쌍·n 작을 때만·큰 그래프는 cap).
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = nodes[i]!.x - nodes[j]!.x, dy = nodes[i]!.y - nodes[j]!.y;
      let dist = Math.hypot(dx, dy) || 0.01;
      const rep = (k * k) / dist;
      dx /= dist; dy /= dist;
      disp[i]!.x += dx * rep; disp[i]!.y += dy * rep;
      disp[j]!.x -= dx * rep; disp[j]!.y -= dy * rep;
    }
    // 스프링(엣지).
    for (const e of edges) {
      const a = idx.get(e.source), b = idx.get(e.target);
      if (a == null || b == null) continue;
      let dx = nodes[a]!.x - nodes[b]!.x, dy = nodes[a]!.y - nodes[b]!.y;
      let dist = Math.hypot(dx, dy) || 0.01;
      const att = (dist * dist) / k;
      dx /= dist; dy /= dist;
      disp[a]!.x -= dx * att; disp[a]!.y -= dy * att;
      disp[b]!.x += dx * att; disp[b]!.y += dy * att;
    }
    const cool = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(disp[i]!.x, disp[i]!.y) || 0.01;
      const lim = Math.min(d, 30 * cool);
      nodes[i]!.x = Math.max(20, Math.min(width - 20, nodes[i]!.x + (disp[i]!.x / d) * lim));
      nodes[i]!.y = Math.max(20, Math.min(height - 20, nodes[i]!.y + (disp[i]!.y / d) * lim));
    }
  }
  return nodes;
}
