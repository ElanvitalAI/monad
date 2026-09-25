/**
 * 🎨⭐⭐ **`src/browser-annotate/` 원장을 «부를 수 있는 문»** (2026-09-01 · 42차).
 *
 * 🚨 계기 — ***만들어져 있는데 안 닿는다.*** 이 저장소가 늘 고치는 그 병이다.
 *    도형을 그리고(`shapes`) 캔들 차트를 그리고(`chart`) 축 좌표를 푸는(`coords`) 힘이
 *    «코드로는» 섰는데 사람도 다른 도구도 그것을 부를 길이 «없었다».
 *
 * ⛔⭐ **순수한 것과 그렇지 않은 것을 가른다** — 인자·파일 «해석»은 순수 함수가 하고,
 *    브라우저에 붙고 주입하는 일만 얇은 가장자리에서 한다. 그래야 시험이 해석을 «직접» 문다.
 * ⛔ 「그렸다」와 「보인다」는 다른 값이다 — `inject.ts` 의 `DrawOutcome` 을 «그대로» 사람에게 낸다.
 * 🧭 묶임 선언(`binding-intent`): ***«호스트»에 묶인다*** — CDP 포트는 「이 기계가 무엇에 닿나」다.
 */
import type { Command } from 'commander';
import { readFileSync } from 'node:fs';

import { createCdpTransport, type CdpTransport } from '../browser-cdp/client.js';
import { createAnnotationLedger, eraseExpression, existsExpression, type DrawOutcome } from '../browser-annotate/inject.js';
import { renderCandlestickChart, type Candlestick } from '../browser-annotate/chart.js';
import type { AnnotationShape } from '../browser-annotate/shapes.js';
import { CHART_TTL_SECONDS, DEFAULT_TTL_SECONDS } from '../browser-annotate/ttl.js';

/** ⛔ 던지지 않는다 — 이유를 «값»으로 낸다(사람에게 스택 트레이스를 주지 않는다). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const SHAPE_KINDS = ['polyline', 'line', 'arrow', 'label', 'box'] as const;
/** 그린 것을 나중에 지우려면 이름이 필요하다. 안 주면 이 이름을 쓴다. */
export const DEFAULT_ANNOTATION_ID = 'monad-cli';
export const DEFAULT_CHART_WIDTH = 960;
export const DEFAULT_CHART_HEIGHT = 600;

/**
 * 도형 배열 JSON 을 «본다». 순수.
 * ⛔ 「배열이 아니다」·「모르는 종류다」·「비었다」를 ***각각 다른 이유***로 낸다 —
 *    한 문면으로 접으면 사람이 어디를 고칠지 모른다.
 */
export function parseShapes(raw: string): Parsed<AnnotationShape[]> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch (e) {
    return { ok: false, reason: `도형 파일이 JSON 이 아니다: ${String(e).slice(0, 120)}` };
  }
  if (!Array.isArray(value)) return { ok: false, reason: '도형 파일은 «배열»이어야 한다(객체 하나가 아니다)' };
  if (value.length === 0) return { ok: false, reason: '도형이 «0개»다 — 그릴 것이 없다' };
  for (const [index, shape] of value.entries()) {
    if (typeof shape !== 'object' || shape === null) {
      return { ok: false, reason: `도형 ${index} 가 객체가 아니다` };
    }
    const kind = (shape as { kind?: unknown }).kind;
    if (typeof kind !== 'string' || !SHAPE_KINDS.includes(kind as (typeof SHAPE_KINDS)[number])) {
      // ⛔ 아는 이름을 «같이» 댄다 — 「모른다」만 말하면 사람이 다시 물어야 한다.
      return { ok: false, reason: `도형 ${index} 의 종류를 모른다: ${String(kind)} (아는 것: ${SHAPE_KINDS.join(' · ')})` };
    }
  }
  return { ok: true, value: value as AnnotationShape[] };
}

/** 봉 배열 JSON 을 «본다». 순수. ⛔ 값의 «유효성»은 `renderCandlestickChart` 가 진다(중복 판정 금지). */
export function parseCandles(raw: string): Parsed<Candlestick[]> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch (e) {
    return { ok: false, reason: `봉 파일이 JSON 이 아니다: ${String(e).slice(0, 120)}` };
  }
  if (!Array.isArray(value)) return { ok: false, reason: '봉 파일은 «배열»이어야 한다' };
  if (value.length === 0) return { ok: false, reason: '봉이 «0개»다 — 그릴 것이 없다' };
  const FIELDS = ['time', 'open', 'high', 'low', 'close'] as const;
  for (const [index, bar] of value.entries()) {
    if (typeof bar !== 'object' || bar === null) return { ok: false, reason: `봉 ${index} 가 객체가 아니다` };
    const missing = FIELDS.filter((field) => typeof (bar as Record<string, unknown>)[field] !== 'number');
    if (missing.length > 0) return { ok: false, reason: `봉 ${index} 에 수가 아닌 칸: ${missing.join(' · ')}` };
  }
  return { ok: true, value: value as Candlestick[] };
}

/** 포트 문자열을 «본다». 순수. ⛔ 0 과 「못 읽었다」를 가른다. */
export function parsePort(raw: string | undefined): Parsed<number> {
  if (raw === undefined || raw.trim() === '') return { ok: false, reason: '--port 가 «없다»' };
  if (!/^\d+$/.test(raw.trim())) return { ok: false, reason: `--port 가 수가 아니다: ${raw}` };
  const port = Number(raw.trim());
  if (port < 1 || port > 65535) return { ok: false, reason: `--port 가 범위 밖이다: ${port}` };
  return { ok: true, value: port };
}

/**

 * 🔢 치수·초 같은 «양수»를 «본다». 순수.
 * ⛔ `Number()` 를 그냥 쓰면 `NaN`·`Infinity` 가 차트 SVG·`anchors`·JSON 산출까지 «흘러간다»
 *    (자기 리뷰 `#15017`). 이 축의 「거짓 초록」 부류다 — 산출이 나오는데 «뜻이 없다».
 */
export function parsePositive(raw: string | undefined, fallback: number, label: string): Parsed<number> {
  if (raw === undefined) return { ok: true, value: fallback };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false, reason: `${label} 이 «수»가 아니다: ${raw}` };
  if (value <= 0) return { ok: false, reason: `${label} 은 «양수»여야 한다: ${value}` };
  return { ok: true, value };
}

/**
 * 🗣️ 사람이 받는 글. 순수 — 그래야 시험이 「무엇을 말하나」를 «직접» 문다.
 * ⛔⭐ `verdict` 가 `ok` 가 «아니면» 그 이름을 «그대로» 말한다 — 「그렸다」를 「보인다」로 접지 않는다.
 */
export function describeDraw(outcome: DrawOutcome, what: string): string {
  if (outcome.verdict === 'ok') {
    const size = outcome.width !== undefined ? ` · ${outcome.width}×${outcome.height}` : '';
    return `✅ ${what} — 그렸고 «보인다»${size}`;
  }
  const why: Record<string, string> = {
    'no-root': '그릴 것이 «없거나» 도형이 거절됐다',
    'wrong-namespace': '붙었는데 ***SVG 가 아니다*** — 크기가 0 이 된다',
    'zero-size': '붙었는데 ***크기가 0*** 이다 — 좌표가 화면 밖이거나 페이지가 아직 레이아웃 전이다',
    unreadable: '저쪽이 «뜻 모를» 값을 냈다 — 「안 보인다」가 아니라 ***「못 읽었다」***다',
  };
  return `⛔ ${what} — 판정 «${outcome.verdict}»: ${why[outcome.verdict] ?? '알 수 없다'}`;
}

/**
 * 🗣️ 「어느 탭에 했나」를 사람에게. 순수.
 * ⛔ 탭이 여럿이면 그 사실을 «말한다» — 말없이 첫 탭을 고르면 엉뚱한 곳을 덮고도 아무도 모른다.
 */
export function describePage(page: PickedPage): string {
  const many = page.total > 1
    ? ` ⚠️ 페이지 ${page.total}개 중 «첫 번째»를 골랐다 — 다른 탭이면 이 명령이 엉뚱한 곳에 한다`
    : '';
  return `   🖥️ 대상: ${page.url}${many}`;
}

export interface BrowserAnnotateDeps {
  out?: { log: (s: string) => void };
  readFile?: (path: string) => string;
  /** ⛔ 실제 CDP 대신 목을 넣을 수 있어야 «배선»을 시험이 문다. */
  connect?: (port: number) => Promise<Connected>;
  exit?: (code: number) => void;
}

/** CDP `/json/list` 의 한 항목 중 «우리가 쓰는» 칸만. */
export interface CdpTargetRow { type?: unknown; url?: unknown; webSocketDebuggerUrl?: unknown }

/**
 * 🩸⭐⭐ **「페이지」 타깃을 고른다** — 순수. 2026-09-01 · 42차 · ***실물이 죽어서 생겼다.***
 *
 * ⛔ 첫 판은 `resolveDebuggerUrl(port)` 를 썼는데 그것은 ***«브라우저 레벨»*** 소켓이다.
 *    브라우저 타깃엔 `Page` 도메인이 «없어» 실물이 `'Page.enable' wasn't found` 로 죽었다.
 * 🔑 그리고 ***시험 열여덟이 전부 초록이었다*** — `connect` 를 목으로 줬기 때문이다.
 *    ⇒ 이 창이 만난 «두 번째» 같은 계급이다(첫째는 주입 노드의 `rect 0×0`).
 *    ⇒ 그래서 «고를 수 있는 부분»을 순수로 뺀다. 나머지(fetch)는 여전히 실물만 답한다.
 * ⛔ `createPageTarget` 을 쓰지 «않는다» — 그것은 `/json/new` 로 ***새 탭을 만든다***.
 *    우리는 봇이 «지금 보고 있는» 페이지에 그려야 한다.
 */
export interface PickedPage { wsUrl: string; url: string; total: number }

export function pickPageTarget(targets: readonly CdpTargetRow[]): Parsed<PickedPage> {
  const pages = targets.filter((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string');
  if (pages.length === 0) {
    const kinds = [...new Set(targets.map((t) => String(t.type ?? '?')))];
    return { ok: false, reason: `«페이지» 타깃이 없다 — 본 것: ${kinds.join(' · ') || '(0개)'}` };
  }
  // ⛔⭐ 여럿이면 «첫 번째»를 쓴다 — 봇은 탭 하나로 몰기 때문이다. 그러나 그 전제가 깨질 수 있으므로
  //    ***무엇을 골랐는지와 몇 개 중 골랐는지를 «값으로» 낸다***(자기 리뷰 `#15017`).
  //    🔑 말없이 고르면, 탭이 여럿인 브라우저에서 «엉뚱한 탭»의 문서를 덮고도 아무도 모른다.
  return {
    ok: true,
    value: { wsUrl: pages[0]!.webSocketDebuggerUrl as string, url: String(pages[0]!.url ?? '(주소 없음)'), total: pages.length },
  };
}

export interface Connected { transport: CdpTransport; page: PickedPage }

async function defaultConnect(port: number): Promise<Connected> {
  let rows: CdpTargetRow[];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(8_000) });
    rows = await res.json() as CdpTargetRow[];
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`CDP 에 못 붙었다 — 127.0.0.1:${port} 가 응답하지 않는다: ${why.slice(0, 100)}`);
  }
  const picked = pickPageTarget(rows);
  if (!picked.ok) throw new Error(`${picked.reason} (127.0.0.1:${port})`);
  return { transport: await createCdpTransport(picked.value.wsUrl), page: picked.value };
}

/**
 * ⛔ 프로그램을 «스스로 만들지 않는다» — 부르는 쪽이 준다(`where-cli.ts` 와 같은 꼴).
 */
export function registerBrowserAnnotateCommand(program: Command, deps: BrowserAnnotateDeps = {}): void {
  const out = deps.out ?? { log: (s: string) => console.log(s) };
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const connect = deps.connect ?? defaultConnect;
  const exit = deps.exit ?? ((code: number) => { process.exitCode = code; });

  /** ⛔ 사람 글에 `Error:` 접두를 흘리지 않는다 — 스택도 아니고 접두도 아니다, 그냥 «말»이다. */
  const humanize = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

  const fail = (reason: string, json?: boolean): void => {
    out.log(json ? JSON.stringify({ ok: false, reason }) : `⛔ ${reason}`);
    exit(1);
  };

  const browser = program.command('browser').description(
    '🎨 봇이 모는 브라우저 페이지 «안»에 그린다 — 도형 · 캔들 차트 · 지우기',
  );

  browser.command('annotate')
    .description('도형을 그린다 (⛔ 「그렸다」가 아니라 «보이나»를 판정으로 낸다)')
    .requiredOption('--port <n>', '봇 브라우저의 CDP 포트')
    .requiredOption('--shapes <path>', '도형 명세 JSON 파일(배열)')
    .option('--ttl <sec>', `살아 있을 초 (기본 ${DEFAULT_TTL_SECONDS})`)
    .option('--id <name>', `그림 이름 (기본 ${DEFAULT_ANNOTATION_ID})`)
    .option('--json', 'JSON 한 줄로')
    .action(async (o: { port?: string; shapes?: string; ttl?: string; id?: string; json?: boolean }) => {
      const port = parsePort(o.port);
      if (!port.ok) return fail(port.reason, o.json);
      let raw: string;
      try { raw = readFile(o.shapes!); } catch (e) { return fail(`도형 파일을 못 읽었다: ${humanize(e)}`, o.json); }
      const shapes = parseShapes(raw);
      if (!shapes.ok) return fail(shapes.reason, o.json);
      const id = o.id ?? DEFAULT_ANNOTATION_ID;
      const ttlParsed = parsePositive(o.ttl, DEFAULT_TTL_SECONDS, '--ttl');
      if (!ttlParsed.ok) return fail(ttlParsed.reason, o.json);
      let conn: Connected;
      try { conn = await connect(port.value); } catch (e) { return fail(humanize(e), o.json); }
      // ⛔⭐ **작업 오류도 «사람 글»이다** — 여기서 안 잡으면 Commander 가 스택을 사람에게 던진다(자기 리뷰).
      try {
        const outcome = await createAnnotationLedger(conn.transport).draw(id, shapes.value, ttlParsed.value);
        out.log(o.json
          ? JSON.stringify({ ok: outcome.verdict === 'ok', id, shapes: shapes.value.length, page: conn.page, ...outcome })
          : `${describeDraw(outcome, `도형 ${shapes.value.length}개(${id})`)}\n${describePage(conn.page)}`);
        if (outcome.verdict !== 'ok') exit(1);
      } catch (e) {
        return fail(humanize(e), o.json);
      } finally { conn.transport.close(); }
    });

  browser.command('chart')
    .description('캔들 차트를 그리고 그 «축»을 같이 낸다 (⭐ 그 축으로 다음 도형을 계산한다)')
    .requiredOption('--port <n>', '봇 브라우저의 CDP 포트')
    .requiredOption('--candles <path>', '봉 배열 JSON 파일')
    .option('--width <n>', `너비 (기본 ${DEFAULT_CHART_WIDTH})`)
    .option('--height <n>', `높이 (기본 ${DEFAULT_CHART_HEIGHT})`)
    .option('--shapes <path>', '차트 «위에» 같이 그릴 도형 JSON 파일')
    .option('--ttl <sec>', `살아 있을 초 (기본 ${CHART_TTL_SECONDS})`)
    .option('--id <name>', `그림 이름 (기본 ${DEFAULT_ANNOTATION_ID})`)
    .option('--json', 'JSON 한 줄로')
    .action(async (o: { port?: string; candles?: string; width?: string; height?: string; shapes?: string; ttl?: string; id?: string; json?: boolean }) => {
      const port = parsePort(o.port);
      if (!port.ok) return fail(port.reason, o.json);
      let raw: string;
      try { raw = readFile(o.candles!); } catch (e) { return fail(`봉 파일을 못 읽었다: ${humanize(e)}`, o.json); }
      const candles = parseCandles(raw);
      if (!candles.ok) return fail(candles.reason, o.json);
      const width = parsePositive(o.width, DEFAULT_CHART_WIDTH, '--width');
      if (!width.ok) return fail(width.reason, o.json);
      const height = parsePositive(o.height, DEFAULT_CHART_HEIGHT, '--height');
      if (!height.ok) return fail(height.reason, o.json);
      const chart = renderCandlestickChart(candles.value, { width: width.value, height: height.value });
      if (!chart.ok) return fail(`차트를 못 그렸다: ${chart.reason}`, o.json);
      // ⭐ 차트 «위에» 얹을 도형 — 없으면 차트만.
      let extra: AnnotationShape[] = [];
      if (o.shapes !== undefined) {
        let shapeRaw: string;
        try { shapeRaw = readFile(o.shapes); } catch (e) { return fail(`도형 파일을 못 읽었다: ${humanize(e)}`, o.json); }
        const parsed = parseShapes(shapeRaw);
        if (!parsed.ok) return fail(parsed.reason, o.json);
        extra = parsed.value;
      }
      // ⛔ 차트 SVG 는 «이미 루트»이므로 그대로 넣고, 도형은 원장이 자기 루트로 감싼다.
      //    ⇒ 둘을 «한 노드»로 합치지 않는다 — 합치면 어느 쪽이 안 보이는지 못 가른다.
      const id = o.id ?? DEFAULT_ANNOTATION_ID;
      const ttlParsed = parsePositive(o.ttl, CHART_TTL_SECONDS, '--ttl');
      if (!ttlParsed.ok) return fail(ttlParsed.reason, o.json);
      let conn: Connected;
      try { conn = await connect(port.value); } catch (e) { return fail(humanize(e), o.json); }
      const transport = conn.transport;
      try {
        const ledger = createAnnotationLedger(transport);
        // ⑴ 차트를 페이지 «문서»로 세운다 — 내비게이션 없이(히스토리·주소창 무접촉).
        await transport.send('Page.enable');
        const tree = await transport.send('Page.getFrameTree') as { frameTree?: { frame?: { id?: string; url?: string } } };
        const frameId = tree.frameTree?.frame?.id;
        // ⛔ 덮기 «전»에 무엇이 있었는지 잡아 둔다 — 덮은 뒤엔 못 묻는다.
        const replacedUrl = String(tree.frameTree?.frame?.url ?? conn.page.url);
        if (frameId === undefined) return fail('프레임을 못 찾았다 — 이 대상은 페이지가 아닐 수 있다', o.json);
        await transport.send('Page.setDocumentContent', {
          frameId,
          html: `<!doctype html><html><head><meta charset="utf-8"><title>monad chart</title></head>`
            + `<body style="margin:0;background:#0d1117">${chart.svg}</body></html>`,
        });
        // ⑵ 그 «위에» 도형 — 없으면 여기서 끝난다(차트는 이미 문서다).
        const drawn = extra.length > 0 ? await ledger.draw(id, extra, ttlParsed.value) : null;
        const payload = {
          ok: drawn === null || drawn.verdict === 'ok',
          candles: candles.value.length, anchors: chart.anchors, plot: chart.plot,
          page: conn.page, replaced: replacedUrl,
          ...(drawn === null ? {} : { annotation: drawn }),
        };
        out.log(o.json ? JSON.stringify(payload) : [
          `✅ 캔들 ${candles.value.length}개를 그렸다 · plot ${chart.plot.width}×${chart.plot.height} @(${chart.plot.left},${chart.plot.top})`,
          `📐 축 — 시각 ${chart.anchors.time[0].value}→${Math.round(chart.anchors.time[0].pixel)}px `
            + `· ${chart.anchors.time[1].value}→${Math.round(chart.anchors.time[1].pixel)}px`
            + ` · 가격 ${chart.anchors.price[0].value}→${Math.round(chart.anchors.price[0].pixel)}px `
            + `· ${chart.anchors.price[1].value}→${Math.round(chart.anchors.price[1].pixel)}px`,
          `   ⭐ 이 축을 그대로 써서 다음 도형의 (시각,가격)을 픽셀로 옮긴다`,
          describePage(conn.page),
          // ⛔⭐ **이 명령은 그 페이지의 문서를 «통째로» 덮는다** — 되돌리는 장치가 «없다».
          //    ⇒ 무엇을 덮었는지 «반드시» 말한다(자기 리뷰 `#15017`). 말 안 하면 사람이 잃은 줄도 모른다.
          `⚠️ 그 페이지의 문서를 «덮었다» — 이전 주소: ${replacedUrl} (되돌리는 장치는 «없다»)`,
          ...(drawn === null ? [] : [describeDraw(drawn, `도형 ${extra.length}개(${id})`)]),
        ].join('\n'));
        if (drawn !== null && drawn.verdict !== 'ok') exit(1);
      } catch (e) {
        return fail(humanize(e), o.json);
      } finally { transport.close(); }
    });

  browser.command('clear')
    .description('그린 것을 지운다')
    .requiredOption('--port <n>', '봇 브라우저의 CDP 포트')
    .option('--id <name>', `그림 이름 (기본 ${DEFAULT_ANNOTATION_ID})`)
    .option('--json', 'JSON 한 줄로')
    .action(async (o: { port?: string; id?: string; json?: boolean }) => {
      const port = parsePort(o.port);
      if (!port.ok) return fail(port.reason, o.json);
      const id = o.id ?? DEFAULT_ANNOTATION_ID;
      let conn: Connected;
      try { conn = await connect(port.value); } catch (e) { return fail(humanize(e), o.json); }
      try {
        // ⛔⭐ **「보냈다」를 「지웠다」로 말하지 않는다**(자기 리뷰 `#15017`).
        //    지우기 «전»에 있었나, 지운 «뒤»에 없나 — 그 둘을 «각각» 묻는다.
        //    🔑 이 원장의 규율(「그렸다 ≠ 보인다」)의 짝이다.
        const evaluate = async (expression: string): Promise<unknown> =>
          (await conn.transport.send('Runtime.evaluate', { expression, returnByValue: true }) as
            { result?: { value?: unknown } } | undefined)?.result?.value;
        const before = await evaluate(existsExpression(id));
        await evaluate(eraseExpression(id));
        const after = await evaluate(existsExpression(id));
        if (before !== true) {
          out.log(o.json
            ? JSON.stringify({ ok: false, id, reason: 'absent', page: conn.page })
            : `⚪ ${id} 가 «없었다» — 지울 것이 없다(⛔ 「지웠다」가 아니다)\n${describePage(conn.page)}`);
          return exit(1);
        }
        if (after !== false) {
          out.log(o.json
            ? JSON.stringify({ ok: false, id, reason: 'still-present', page: conn.page })
            : `⛔ ${id} 가 «아직 있다» — 지우기가 먹지 않았다\n${describePage(conn.page)}`);
          return exit(1);
        }
        out.log(o.json ? JSON.stringify({ ok: true, id, page: conn.page }) : `🧹 ${id} 를 지웠다 — «없어진 것»을 확인했다`);
      } catch (e) {
        return fail(humanize(e), o.json);
      } finally { conn.transport.close(); }
    });
}
