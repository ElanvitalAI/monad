/**
 * 🇰🇷⭐⭐ **한글 종목명 → 코드** — 2026-09-01 · 42차.
 *
 * 🚨 계기(대표): *"말로 하거나 …"* ⊕ 한국어로는 「삼성전자 차트」가 자연스럽다.
 *    그런데 `/chart 삼성전자` 가 «안 됐다».
 *
 * ⛔⭐ **이름표를 «박지» 않는다** — 목록을 코드에 적으면 늙는다.
 * ✅ 대신 ***이미 이 기계에 있는 것***을 읽는다: `~/.cache/dart/CORPCODE.xml`
 *    (DART 전체 기업 코드 · 42차 실측 118,179건 중 상장 3,967건 · 파싱 0.4초).
 *    🔑 ⇒ ***의존이 «안 는다».*** 새 API 도 새 패키지도 없다.
 * ⛔ 그 파일이 «없으면» 조용히 죽지 않고 ***이름을 대고*** 말한다 — 그리고 그때는
 *    「이름으로 못 찾는다」일 뿐 「종목이 없다」가 «아니다».
 *
 * 📌 29MB 를 매번 읽지 않는다 — 한 번 훑어 작은 JSON 으로 캐시한다.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** 이름 → 6자리 종목코드. ⛔ 이름은 «정규화»해서 담는다(공백·대소문자). */
export type TickerTable = ReadonlyMap<string, string>;

/** ⛔ 「없다」와 「못 읽었다」를 가른다. */
export type TableLoad =
  | {
      ok: true; table: TickerTable; from: 'cache' | 'xml'; count: number;
      /** ⛔ 캐시를 «못 썼다» — 조회는 됐지만 다음 번에 29MB 를 다시 읽는다. 삼키지 않고 낸다. */
      cacheWriteFailed?: string;
    }
  | { ok: false; reason: string };

/**
 * 이름을 «비교용»으로 고른다. 순수.
 * ⛔ 공백·중점을 지우고 대문자로 — 「SK 하이닉스」와 「SK하이닉스」가 같은 것을 가리킨다.
 */
export function normalizeName(raw: string): string {
  return raw.replace(/[\s·・.]/g, '').toUpperCase();
}

/**
 * DART `CORPCODE.xml` 을 훑어 «상장된 것»만 담는다. 순수.
 * ⛔ XML 파서를 «안 쓴다» — 29MB 를 DOM 으로 올리지 않는다. 필요한 두 칸만 정규식으로 훑는다.
 * ⛔ `stock_code` 가 «빈» 항목이 대부분이다(비상장) — 6자리만 담는다.
 */
/**
 * XML 조각을 «글자»로. 순수.
 * ⛔ 엔티티(`&amp;`)를 안 풀면 「LG&amp;…」 같은 이름이 ***사람이 친 글자와 영영 안 맞는다***(자기 리뷰 `#15052`).
 * ⛔ CDATA 도 읽는다 — DART 가 그 꼴을 쓰는 항목이 있다.
 */
export function decodeXmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  const body = cdata ? cdata[1]! : raw;
  return body
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    // ⛔ `&amp;` 는 «마지막»에 — 먼저 풀면 `&amp;lt;` 가 `<` 로 두 번 풀린다.
    .replace(/&amp;/g, '&')
    .trim();
}

export function parseCorpCodeXml(xml: string): TickerTable {
  const table = new Map<string, string>();
  const re = /<list>([\s\S]*?)<\/list>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1]!;
    const code = decodeXmlText(/<stock_code>([\s\S]*?)<\/stock_code>/.exec(block)?.[1] ?? '');
    if (!/^\d{6}$/.test(code)) continue;
    const name = decodeXmlText(/<corp_name>([\s\S]*?)<\/corp_name>/.exec(block)?.[1] ?? '');
    if (name === '') continue;
    // ⛔ 먼저 만난 것을 «유지»한다 — 같은 이름이 여럿이면 뒤엣것이 대개 상장폐지·중복이다.
    const key = normalizeName(name);
    if (!table.has(key)) table.set(key, code);
  }
  return table;
}

export interface LookupDeps {
  readonly home?: string;
  readonly exists?: (p: string) => boolean;
  readonly read?: (p: string) => string;
  readonly write?: (p: string, s: string) => void;
  readonly mtimeMs?: (p: string) => number;
  /** ⛔ 원본 «크기». mtime 만으로는 못 가르는 갱신을 이것이 가른다. */
  readonly sizeBytes?: (p: string) => number;
}

/** 캐시가 「어느 원본에서 나왔나」. ⛔ mtime «만»으로는 못 가른다(해상도·시계 역행). */
interface CacheEnvelope {
  readonly srcMtimeMs: number;
  readonly srcSizeBytes: number;
  readonly rows: Record<string, string>;
}

/** DART 원본과 우리 캐시의 자리. ⛔ 경로를 «두 곳»에 적지 않는다. */
export function corpCodePath(home = homedir()): string { return join(home, '.cache', 'dart', 'CORPCODE.xml'); }
export function cachePath(home = homedir()): string { return join(home, '.cache', 'elanous', 'kr-tickers.json'); }

/**
 * 표를 얻는다. 캐시가 «원본보다 새로우면» 캐시를, 아니면 다시 훑어 캐시를 갱신한다.
 * ⛔ 캐시가 «낡았는지»를 나이가 아니라 ***원본과의 순서***로 본다(임계를 지어내지 않는다).
 */
export function loadKrTickers(deps: LookupDeps = {}): TableLoad {
  const home = deps.home ?? homedir();
  const exists = deps.exists ?? existsSync;
  const read = deps.read ?? ((p: string) => readFileSync(p, 'utf8'));
  const write = deps.write ?? ((p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); });
  const mtime = deps.mtimeMs ?? ((p: string) => statSync(p).mtimeMs);
  const src = corpCodePath(home);
  const cache = cachePath(home);

  if (!exists(src)) {
    return { ok: false, reason: `한글 종목명 표를 «못 찾았다»: ${src} (⛔ 「그런 종목이 없다」가 «아니다»)` };
  }
  const size = deps.sizeBytes ?? ((p: string) => statSync(p).size);
  const srcMtimeMs = mtime(src);
  const srcSizeBytes = size(src);
  if (exists(cache)) {
    try {
      const env = JSON.parse(read(cache)) as Partial<CacheEnvelope>;
      // ⛔⭐ 「캐시가 «더 새것»인가」로 «안» 본다(자기 리뷰 `#15052`) — mtime 해상도 안의 갱신과
      //    시계 역행에서 ***낡은 캐시를 최신으로 오인***한다. ⇒ ***원본의 지문이 «같은가»***로 본다.
      if (env.srcMtimeMs === srcMtimeMs && env.srcSizeBytes === srcSizeBytes && env.rows) {
        const table = new Map(Object.entries(env.rows));
        if (table.size > 0) return { ok: true, table, from: 'cache', count: table.size };
      }
    } catch { /* 캐시가 깨졌으면 다시 훑는다 — 그것이 실패는 아니다 */ }
  }
  let table: TickerTable;
  try { table = parseCorpCodeXml(read(src)); } catch (e) {
    return { ok: false, reason: `종목명 표를 못 읽었다: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (table.size === 0) return { ok: false, reason: `종목명 표가 «비었다» — ${src} 의 꼴이 바뀌었나` };
  // ⛔ 쓰기 실패를 «삼키지» 않는다 — 삼키면 매번 29MB 를 다시 읽는데 아무도 모른다.
  let cacheWrite: string | null = null;
  try {
    const env: CacheEnvelope = { srcMtimeMs, srcSizeBytes, rows: Object.fromEntries(table) };
    write(cache, JSON.stringify(env));
  } catch (e) {
    cacheWrite = e instanceof Error ? e.message : String(e);
  }
  return { ok: true, table, from: 'xml', count: table.size, ...(cacheWrite === null ? {} : { cacheWriteFailed: cacheWrite }) };
}

/**
 * 한글 이름을 코드로. 순수.
 * ⛔ «부분 일치»를 하지 않는다 — 「삼성」이 「삼성전자」·「삼성물산」 중 무엇인지 이 자는 «모른다».
 *    모르는 것을 고르면 사람이 «엉뚱한 종목»을 본다. ⇒ 정확히 같을 때만 답한다.
 */
export function resolveKoreanName(name: string, table: TickerTable): string | null {
  return table.get(normalizeName(name)) ?? null;
}

/** 한글이 «섞여» 있나. 순수. */
export function looksKorean(text: string): boolean { return /[가-힣]/.test(text); }

// ─────────────────────────────────────────────────────────────
// 🧠 프로세스 안 «기억» — ⛔ 후보가 여럿이면 표를 여러 번 읽던 것을 막는다(자기 리뷰 `#15052`).
// ─────────────────────────────────────────────────────────────
let memo: { srcMtimeMs: number; srcSizeBytes: number; load: TableLoad } | null = null;

/**
 * 표를 «한 번만» 읽는다 — 그러나 원본이 바뀌면 «다시» 읽는다.
 * 🔑 나이 임계를 «지어내지» 않는다. 대신 ***원본의 지문(mtime+크기)***을 `stat` 로 «싸게» 확인한다
 *    (29MB 를 다시 읽는 것과 `stat` 두 번은 비용이 «자릿수»로 다르다).
 * ⛔ `stat` 자체가 실패하면 기억을 믿지 «않고» 다시 읽는다 — 모르는 것을 캐시로 접지 않는다.
 */
export function krTickerTable(deps: LookupDeps = {}): TableLoad {
  const home = deps.home ?? homedir();
  const src = corpCodePath(home);
  let stamp: { mtimeMs: number; size: number } | null = null;
  try { const st = statSync(src); stamp = { mtimeMs: st.mtimeMs, size: st.size }; } catch { stamp = null; }
  if (stamp !== null && memo !== null
      && memo.srcMtimeMs === stamp.mtimeMs && memo.srcSizeBytes === stamp.size) {
    return memo.load;
  }
  const load = loadKrTickers(deps);
  if (stamp !== null) memo = { srcMtimeMs: stamp.mtimeMs, srcSizeBytes: stamp.size, load };
  return load;
}

/** ⛔ 시험이 프로세스 기억을 «지울» 수 있어야 한다 — 안 그러면 시험끼리 샌다. */
export function forgetKrTickerTable(): void { memo = null; }
