import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';

import {
  parseShapes, parseCandles, parsePort, describeDraw, registerBrowserAnnotateCommand,
  pickPageTarget, parsePositive, describePage, DEFAULT_ANNOTATION_ID,
} from '../src/cli/browser-annotate-cli.js';
import type { CdpTransport } from '../src/browser-cdp/client.js';

const CANDLES = JSON.stringify([
  { time: 0, open: 100, high: 108, low: 96, close: 106 },
  { time: 3600000, open: 106, high: 112, low: 104, close: 110 },
  { time: 7200000, open: 110, high: 114, low: 108, close: 112 },
]);
const SHAPES = JSON.stringify([{ kind: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }]);

describe('🎨 인자 해석 — ⛔ 「무엇이 틀렸나」를 «각각 다른» 이유로', () => {
  test('배열이 아니면 그렇게 말한다', () => {
    const r = parseShapes('{"kind":"line"}');
    expect(r.ok).toBeFalse();
    if (!r.ok) expect(r.reason).toContain('«배열»');
  });
  test('⛔ 「비었다」와 「배열이 아니다」는 «다른 값»이다', () => {
    const empty = parseShapes('[]');
    const notArray = parseShapes('{}');
    expect(empty.ok).toBeFalse();
    expect(notArray.ok).toBeFalse();
    if (!empty.ok && !notArray.ok) expect(empty.reason).not.toBe(notArray.reason);
  });
  test('⭐ 모르는 종류면 «아는 이름을 같이» 댄다 — 「모른다」만 말하면 다시 물어야 한다', () => {
    const r = parseShapes('[{"kind":"blob"}]');
    expect(r.ok).toBeFalse();
    if (!r.ok) {
      expect(r.reason).toContain('blob');
      expect(r.reason).toContain('polyline');
    }
  });
  test('JSON 이 아니면 «파싱 실패»로 갈린다 — 「배열이 아니다」가 아니다', () => {
    const r = parseShapes('not json');
    expect(r.ok).toBeFalse();
    if (!r.ok) expect(r.reason).toContain('JSON');
  });
  test('정상 입력은 통과한다', () => {
    expect(parseShapes(SHAPES).ok).toBeTrue();
    expect(parseCandles(CANDLES).ok).toBeTrue();
  });
  test('봉에 수가 아닌 칸이 있으면 «그 이름»을 댄다', () => {
    const r = parseCandles('[{"time":0,"open":"x","high":1,"low":0,"close":1}]');
    expect(r.ok).toBeFalse();
    if (!r.ok) expect(r.reason).toContain('open');
  });
  test('🔢 포트 — ⛔ 「없다」·「수가 아니다」·「범위 밖」이 각각 다르다', () => {
    const reasons = [parsePort(undefined), parsePort('abc'), parsePort('99999')]
      .map((r) => (r.ok ? 'ok' : r.reason));
    expect(new Set(reasons).size).toBe(3);
    expect(parsePort('9404')).toEqual({ ok: true, value: 9404 });
  });
});

describe('🗣️ 사람이 받는 글 — ⛔ 「그렸다」를 「보인다」로 접지 않는다', () => {
  test('ok 면 «보인다»고 말하고 크기를 댄다', () => {
    const said = describeDraw({ attached: true, verdict: 'ok', width: 800, height: 600 }, '도형 3개');
    expect(said).toContain('보인다');
    expect(said).toContain('800×600');
  });
  test('⭐ ok 가 «아니면» 그 판정 이름을 «그대로» 말한다', () => {
    for (const verdict of ['zero-size', 'wrong-namespace', 'unreadable', 'no-root'] as const) {
      const said = describeDraw({ attached: true, verdict }, '도형');
      expect(said).toContain(verdict);
      // ⛔ 「보인다」를 «부분문자열»로 보면 `unreadable` 의 「안 보인다」에 걸린다 —
      //    이 저장소가 여러 번 밟은 그 함정이다. ⇒ 초록 문면 «전체»로 문다.
      expect(said).not.toContain('그렸고 «보인다»');
      expect(said.startsWith('⛔')).toBeTrue();
    }
  });
  test('⛔ 「못 읽었다」와 「안 보인다」를 «다른 말»로 낸다', () => {
    const unreadable = describeDraw({ attached: false, verdict: 'unreadable' }, 'x');
    const zero = describeDraw({ attached: true, verdict: 'zero-size' }, 'x');
    expect(unreadable).toContain('못 읽었다');
    expect(zero).not.toContain('못 읽었다');
  });
});

describe('🔌 Commander 등록 — 🩸 「만들었는데 안 닿는다」를 여기서 문다', () => {
  const registered = (): Command => {
    const program = new Command();
    registerBrowserAnnotateCommand(program);
    return program.commands.find((c) => c.name() === 'browser')!;
  };
  test('`browser` 아래 서브커맨드 셋이 «전부» 있다', () => {
    expect(registered().commands.map((c) => c.name()).sort()).toEqual(['annotate', 'chart', 'clear']);
  });
  test('셋 다 `--port` 를 갖는다 ⊕ annotate 는 --shapes · chart 는 --candles', () => {
    const byName = new Map(registered().commands.map((c) => [c.name(), c.options.map((o) => o.long)]));
    for (const name of ['annotate', 'chart', 'clear']) expect(byName.get(name)).toContain('--port');
    expect(byName.get('annotate')).toContain('--shapes');
    expect(byName.get('chart')).toContain('--candles');
    // ⭐ chart 도 «위에 얹을» 도형을 받는다 — 그것이 이 명령의 존재 이유다.
    expect(byName.get('chart')).toContain('--shapes');
  });
});

describe('🔗 배선 — ⛔ CDP 목으로 «실행 경로»를 문다(이음매가 끊기면 죽는다)', () => {
  const run = async (
    argv: string[],
    drawValue: unknown = { attached: true, verdict: 'ok', width: 900, height: 500 },
    existsSeq: boolean[] = [true, false],
  ) => {
    const existsValue = [...existsSeq];
    const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const lines: string[] = [];
    const codes: number[] = [];
    const transport: CdpTransport = {
      async send(method, params) {
        sent.push({ method, params });
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F1', url: 'https://old.example/page' } } };
        if (String(params?.expression ?? '').includes('!== null')) return { result: { value: existsValue.shift() ?? false } };
        const expression = String(params?.expression ?? '');
        if (expression.includes('template.innerHTML')) return { result: { value: drawValue } };
        return { result: { value: true } };
      },
      close() {},
    };
    const program = new Command();
    program.exitOverride();
    registerBrowserAnnotateCommand(program, {
      out: { log: (s) => lines.push(s) },
      readFile: (path) => (path.includes('candle') ? CANDLES : SHAPES),
      connect: async () => ({ transport, page: { wsUrl: 'ws://p', url: 'https://old.example/page', total: 1 } }),
      exit: (code) => codes.push(code),
    });
    await program.parseAsync(['node', 'monad', 'browser', ...argv]);
    return { sent, said: lines.join('\n'), codes };
  };

  test('⭐ `chart` 가 캔들 SVG 를 «문서로» 세우고 축을 산출에 «싣는다»', async () => {
    const { sent, said } = await run(['chart', '--port', '9404', '--candles', 'candles.json', '--json']);
    const setDoc = sent.find((c) => c.method === 'Page.setDocumentContent');
    expect(setDoc).toBeDefined();
    expect(String(setDoc?.params?.html)).toContain('<svg');
    expect(String(setDoc?.params?.html)).toContain('<rect');   // 캔들 몸통
    const payload = JSON.parse(said);
    expect(payload.ok).toBeTrue();
    expect(payload.candles).toBe(3);
    // 🔑 축이 실려야 부르는 쪽이 다음 도형을 «계산»할 수 있다 — 이 계약이 이 명령의 전부다.
    expect(payload.anchors.time).toHaveLength(2);
    expect(payload.anchors.price).toHaveLength(2);
    expect(payload.plot.width).toBeGreaterThan(0);
  });

  test('⭐ `chart --shapes` 는 그 «위에» 도형도 그린다', async () => {
    const { sent } = await run(['chart', '--port', '9404', '--candles', 'candles.json', '--shapes', 'shapes.json']);
    expect(sent.some((c) => String(c.params?.expression ?? '').includes('template.innerHTML'))).toBeTrue();
  });

  test('🔑⛔ 목이 `zero-size` 를 주면 산출이 «그 이름»을 그대로 말하고 exit 1', async () => {
    const { said, codes } = await run(
      ['chart', '--port', '9404', '--candles', 'candles.json', '--shapes', 'shapes.json'],
      { attached: true, verdict: 'zero-size', width: 0, height: 0 },
    );
    expect(said).toContain('zero-size');
    expect(codes).toContain(1);
  });

  test('⛔ `annotate` 가 도형을 원장으로 넘긴다 ⊕ 기본 id 를 쓴다', async () => {
    const { sent } = await run(['annotate', '--port', '9404', '--shapes', 'shapes.json']);
    const draw = sent.find((c) => String(c.params?.expression ?? '').includes('template.innerHTML'));
    expect(draw).toBeDefined();
    expect(String(draw?.params?.expression)).toContain(DEFAULT_ANNOTATION_ID);
  });

  test('🧹 `clear` 가 지우고 «없어진 것»을 확인한다', async () => {
    const { sent, said, codes } = await run(['clear', '--port', '9404'], undefined, [true, false]);
    expect(sent.some((c) => String(c.params?.expression ?? '').includes('node.remove()'))).toBeTrue();
    expect(said).toContain('지웠다');
    expect(said).toContain('확인');
    expect(codes).not.toContain(1);
  });

  test('🔑⛔ `clear` — «없었으면» 「지웠다」고 말하지 «않는다» (자기 리뷰 #15017)', async () => {
    const { said, codes } = await run(['clear', '--port', '9404'], undefined, [false, false]);
    expect(said).toContain('없었다');
    expect(said).not.toContain('🧹');
    expect(codes).toContain(1);
  });

  test('🔑⛔ `clear` — 지웠는데 «아직 있으면» 실패다', async () => {
    const { said, codes } = await run(['clear', '--port', '9404'], undefined, [true, true]);
    expect(said).toContain('아직 있다');
    expect(codes).toContain(1);
  });

  test('⚠️⭐ `chart` 가 ***무엇을 덮었는지*** 말한다 — 되돌리는 장치가 «없다»', async () => {
    const { said } = await run(['chart', '--port', '9404', '--candles', 'candles.json']);
    expect(said).toContain('덮었다');
    expect(said).toContain('https://old.example/page');
    expect(said).toContain('되돌리는 장치는 «없다»');
  });

  test('⛔ `--width` 가 수가 아니면 «붙기도 전에» 거절한다', async () => {
    const { sent, said, codes } = await run(['chart', '--port', '9404', '--candles', 'candles.json', '--width', 'abc']);
    expect(said).toContain('--width');
    expect(codes).toContain(1);
    expect(sent).toHaveLength(0);   // ⛔ 브라우저를 «건드리지도» 않았다
  });

  test('⛔ 못 붙으면 «스택 트레이스»가 아니라 사람 글을 낸다', async () => {
    const lines: string[] = []; const codes: number[] = [];
    const program = new Command(); program.exitOverride();
    registerBrowserAnnotateCommand(program, {
      out: { log: (s) => lines.push(s) },
      readFile: () => SHAPES,
      connect: async (): Promise<never> => { throw new Error('ECONNREFUSED 127.0.0.1:9404'); },
      exit: (code) => codes.push(code),
    });
    await program.parseAsync(['node', 'monad', 'browser', 'annotate', '--port', '9404', '--shapes', 's.json']);
    expect(lines.join('\n')).toContain('ECONNREFUSED');
    expect(lines.join('\n')).not.toContain('at ');   // ⛔ 스택이 아니다
    expect(codes).toContain(1);
  });
});

describe('🩸 페이지 타깃 고르기 — ⛔ 실물이 죽어서 생긴 갈래', () => {
  test('⭐ ***이것이 그 결함이다*** — 「브라우저」 타깃엔 Page 도메인이 «없다»', () => {
    const r = pickPageTarget([{ type: 'browser', webSocketDebuggerUrl: 'ws://b' }]);
    expect(r.ok).toBeFalse();
    // ⛔ 「없다」만 말하지 않는다 — «무엇을 봤는지»를 같이 댄다.
    if (!r.ok) expect(r.reason).toContain('browser');
  });
  test('페이지가 있으면 그 소켓을 고른다', () => {
    // ⛔ 「무엇을 골랐나」를 «값으로» 낸다 — 소켓만 내면 사람이 어느 탭인지 모른다(#15017).
    expect(pickPageTarget([
      { type: 'browser', webSocketDebuggerUrl: 'ws://b' },
      { type: 'page', url: 'https://p/', webSocketDebuggerUrl: 'ws://p' },
    ])).toEqual({ ok: true, value: { wsUrl: 'ws://p', url: 'https://p/', total: 1 } });
  });
  test('⛔ `webSocketDebuggerUrl` 이 «없는» 페이지는 고르지 않는다', () => {
    expect(pickPageTarget([{ type: 'page' }]).ok).toBeFalse();
  });
  test('⛔ 목록이 비면 「(0개)」라고 «말한다» — 「browser 를 봤다」와 다른 값이다', () => {
    const empty = pickPageTarget([]);
    expect(empty.ok).toBeFalse();
    if (!empty.ok) expect(empty.reason).toContain('(0개)');
  });
});

describe('🔢 치수·초 — ⛔ NaN 이 산출까지 «흘러가지» 않는다 (자기 리뷰 #15017)', () => {
  test('안 주면 기본값 · 주면 그 값', () => {
    expect(parsePositive(undefined, 960, '--width')).toEqual({ ok: true, value: 960 });
    expect(parsePositive('480', 960, '--width')).toEqual({ ok: true, value: 480 });
  });
  test('⭐ ***이것이 그 결함이다*** — 수가 아니면 «거절»한다(NaN 이 anchors 까지 간다)', () => {
    const r = parsePositive('abc', 960, '--width');
    expect(r.ok).toBeFalse();
    if (!r.ok) expect(r.reason).toContain('--width');
  });
  test('⛔ 0·음수·Infinity 도 «각각» 거절된다', () => {
    for (const bad of ['0', '-5', 'Infinity']) expect(parsePositive(bad, 960, '--height').ok).toBeFalse();
  });
});

describe('🖥️ 어느 탭에 했나 — ⛔ 말없이 첫 탭을 고르지 않는다', () => {
  test('하나면 주소만 말한다', () => {
    const said = describePage({ wsUrl: 'ws://p', url: 'https://a.example/', total: 1 });
    expect(said).toContain('https://a.example/');
    expect(said).not.toContain('⚠️');
  });
  test('⭐ 여럿이면 «그 사실»을 말한다 — 엉뚱한 탭을 덮을 수 있다', () => {
    const said = describePage({ wsUrl: 'ws://p', url: 'https://a.example/', total: 3 });
    expect(said).toContain('3개');
    expect(said).toContain('첫 번째');
  });
  test('🔑 `pickPageTarget` 이 «몇 개 중 골랐는지»를 값으로 낸다', () => {
    const r = pickPageTarget([
      { type: 'page', url: 'https://a/', webSocketDebuggerUrl: 'ws://a' },
      { type: 'page', url: 'https://b/', webSocketDebuggerUrl: 'ws://b' },
    ]);
    expect(r.ok).toBeTrue();
    if (r.ok) expect(r.value).toEqual({ wsUrl: 'ws://a', url: 'https://a/', total: 2 });
  });
});
