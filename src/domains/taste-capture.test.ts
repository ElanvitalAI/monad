import { test, expect, describe, afterEach } from 'bun:test';
import {
  parseTasteItems,
  imprintTasteItems,
  captureTaste,
  TASTE_ITEM_TYPES,
  type TasteItem,
} from './taste-capture.js';
import { openSurfaceEventsDb, queryEvents } from './surface-events.js';
import { setUserConfigOverlay } from '../user-config.js';

const db = () => openSurfaceEventsDb(':memory:');

afterEach(() => setUserConfigOverlay(null));

describe('parseTasteItems — LLM raw 파싱(순수·fail-soft)', () => {
  test('유효 JSON 배열 파싱', () => {
    const raw = JSON.stringify([
      { type: 'fact', text: '대표는 monad 오너', confidence: 0.9 },
      { type: 'style_pref', text: '간결한 한국어', confidence: 0.7 },
    ]);
    const items = parseTasteItems(raw);
    expect(items).toHaveLength(2);
    expect(items[0]!.type).toBe('fact');
    expect(items[1]!.text).toBe('간결한 한국어');
  });

  test('코드펜스·앞뒤 산문 관대(첫 [ ~ 마지막 ])', () => {
    const raw = 'Here you go:\n```json\n[{"type":"insight","text":"자동화 선호","confidence":0.6}]\n```\ndone';
    const items = parseTasteItems(raw);
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('insight');
  });

  test('미상 type·빈 text 드롭 · confidence 클램프', () => {
    const raw = JSON.stringify([
      { type: 'bogus', text: 'x', confidence: 0.5 },        // 미상 type → 드롭
      { type: 'fact', text: '   ', confidence: 0.5 },        // 빈 text → 드롭
      { type: 'intent_tag', text: '리서치', confidence: 5 }, // 범위밖 → 1 로 클램프
      { type: 'fact', text: 'ok', confidence: -3 },          // 음수 → 0 클램프
    ]);
    const items = parseTasteItems(raw);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.type === 'intent_tag')!.confidence).toBe(1);
    expect(items.find((i) => i.text === 'ok')!.confidence).toBe(0);
  });

  test('confidence 미지정 시 0.5 디폴트', () => {
    const items = parseTasteItems(JSON.stringify([{ type: 'fact', text: 't' }]));
    expect(items[0]!.confidence).toBe(0.5);
  });

  test('빈 문자열·비배열·깨진 JSON → []', () => {
    expect(parseTasteItems('')).toEqual([]);
    expect(parseTasteItems('no brackets here')).toEqual([]);
    expect(parseTasteItems('{"type":"fact"}')).toEqual([]); // 객체(배열 아님)
    expect(parseTasteItems('[broken')).toEqual([]);
  });

  test('프롬프트당 12개 상한', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ type: 'fact', text: `f${i}`, confidence: 0.5 }));
    expect(parseTasteItems(JSON.stringify(many))).toHaveLength(12);
  });
});

describe('imprintTasteItems — surface_events 각인', () => {
  test('kind:taste·category:taste.capture 로 각인 · type 별 태그', () => {
    const d = db();
    const items: TasteItem[] = [
      { type: 'fact', text: '대표 오너', confidence: 1 },
      { type: 'intent_tag', text: '리서치', confidence: 0.4 },
    ];
    const ids = imprintTasteItems(items, { channel: 'pwa', db: d });
    expect(ids).toHaveLength(2);

    const rows = queryEvents(d, { category: 'taste.capture' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'taste')).toBe(true);
    expect(rows.every((r) => r.surface === 'pwa')).toBe(true);
    const fact = rows.find((r) => (r.tags ?? '').includes('taste:fact'))!;
    expect(fact.importance).toBe(8); // 3 + 1*5
    const tag = rows.find((r) => (r.tags ?? '').includes('taste:intent_tag'))!;
    expect(tag.importance).toBe(5); // round(3 + 0.4*5)
  });

  test('빈 배열 → 각인 0', () => {
    const d = db();
    expect(imprintTasteItems([], { channel: 'cli', db: d })).toEqual([]);
    expect(queryEvents(d, { category: 'taste.capture' })).toHaveLength(0);
  });
});

describe('captureTaste — 중앙 진입점 훅', () => {
  test('config OFF(미설정) → 완전 no-op(distill 미호출)', async () => {
    const d = db();
    let called = 0;
    await captureTaste({
      text: '반도체 사이클 계속 물어보네',
      channel: 'cli',
      db: d,
      distill: async () => { called++; return '[]'; },
    });
    expect(called).toBe(0);
    expect(queryEvents(d, { category: 'taste.capture' })).toHaveLength(0);
  });

  test('config ON + distill seam → 각인', async () => {
    setUserConfigOverlay((c) => ({ ...c, taste: { captureEnabled: true } }));
    const d = db();
    await captureTaste({
      text: '항상 간결한 한국어로 답해줘',
      channel: 'telegram',
      db: d,
      distill: async () => JSON.stringify([{ type: 'style_pref', text: '간결한 한국어', confidence: 0.8 }]),
    });
    const rows = queryEvents(d, { category: 'taste.capture' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('taste');
  });

  test('짧은 텍스트(<8자)는 스킵', async () => {
    setUserConfigOverlay((c) => ({ ...c, taste: { captureEnabled: true } }));
    const d = db();
    let called = 0;
    await captureTaste({ text: '응', channel: 'cli', db: d, distill: async () => { called++; return '[]'; } });
    expect(called).toBe(0);
  });

  test('distill throw 는 fire-soft(reject 안 함·각인 0)', async () => {
    setUserConfigOverlay((c) => ({ ...c, taste: { captureEnabled: true } }));
    const d = db();
    await expect(
      captureTaste({
        text: '이건 실패해야 하는 긴 문장이다',
        channel: 'cli',
        db: d,
        distill: async () => { throw new Error('LLM down'); },
      }),
    ).resolves.toBeUndefined();
    expect(queryEvents(d, { category: 'taste.capture' })).toHaveLength(0);
  });
});

describe('TASTE_ITEM_TYPES 계약', () => {
  test('5종 고정', () => {
    expect([...TASTE_ITEM_TYPES]).toEqual(['fact', 'style_pref', 'recurring_topic', 'insight', 'intent_tag']);
  });
});
