import { test, expect, describe, afterEach } from 'bun:test';
import {
  detectBehavioralSignals, sentimentReward, adjustAffinity,
  captureSentiment, recentSentimentReward,
} from './taste-sentiment.js';
import { openSurfaceEventsDb, queryEvents } from './surface-events.js';
import { setUserConfigOverlay } from '../user-config.js';

const db = () => openSurfaceEventsDb(':memory:');
afterEach(() => setUserConfigOverlay(null));

describe('detectBehavioralSignals — Layer1 행동규칙(순수·정밀)', () => {
  test('만족(양)', () => {
    const s = detectBehavioralSignals('오 완벽해 고마워');
    expect(s.some((x) => x.kind === 'satisfaction' && x.reward > 0)).toBe(true);
  });
  test('정정(음)', () => {
    expect(detectBehavioralSignals('아니 그게 아니라 다른 걸 말한 거야').some((x) => x.kind === 'correction')).toBe(true);
    expect(detectBehavioralSignals("no that's wrong").some((x) => x.kind === 'correction')).toBe(true);
  });
  test('좌절(강한 음)', () => {
    const s = detectBehavioralSignals('왜 자꾸 안 되지 답답하네');
    expect(s.some((x) => x.kind === 'frustration' && x.reward <= -0.8)).toBe(true);
  });
  test('중단(음)', () => {
    expect(detectBehavioralSignals('됐어 그만해').some((x) => x.kind === 'abandonment')).toBe(true);
  });
  test('중립 발화는 신호 없음(과탐 회피)', () => {
    expect(detectBehavioralSignals('반도체 사이클 분석해줘')).toEqual([]);
    expect(detectBehavioralSignals('내일 날씨 어때')).toEqual([]);
  });
});

describe('sentimentReward — net 클램프', () => {
  test('합산 후 [-1,1] 클램프', () => {
    expect(sentimentReward([{ kind: 'frustration', reward: -0.8 }, { kind: 'correction', reward: -0.6 }])).toBe(-1);
    expect(sentimentReward([{ kind: 'satisfaction', reward: 0.7 }])).toBeCloseTo(0.7);
    expect(sentimentReward([])).toBe(0);
  });
  test('부호 상충 상쇄', () => {
    expect(sentimentReward([{ kind: 'satisfaction', reward: 0.7 }, { kind: 'correction', reward: -0.6 }])).toBeCloseTo(0.1);
  });
});

describe('adjustAffinity — P6 gate primitive', () => {
  test('좌절 하향·만족 상향', () => {
    expect(adjustAffinity(0.5, -1)).toBeCloseTo(0.2);
    expect(adjustAffinity(0.5, 1)).toBeCloseTo(0.8);
    expect(adjustAffinity(0.5, 0)).toBe(0.5);
  });
});

describe('captureSentiment — 진입점 훅', () => {
  test('config OFF → no-op', async () => {
    const d = db();
    await captureSentiment({ text: '아니 그게 아니라', channel: 'cli', db: d });
    expect(queryEvents(d, { category: 'taste.sentiment' })).toHaveLength(0);
  });
  test('config ON + 신호 → 각인(primary·reward 태그)', async () => {
    setUserConfigOverlay((c) => ({ ...c, taste: { captureEnabled: true } }));
    const d = db();
    await captureSentiment({ text: '왜 자꾸 안 되지 답답해', channel: 'telegram', db: d });
    const rows = queryEvents(d, { category: 'taste.sentiment' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('taste');
    expect(rows[0]!.tags).toContain('sentiment:frustration');
    expect(rows[0]!.tags).toContain('reward:-');
  });
  test('config ON + 중립 → 각인 안 함', async () => {
    setUserConfigOverlay((c) => ({ ...c, taste: { captureEnabled: true } }));
    const d = db();
    await captureSentiment({ text: '반도체 리서치 해줘', channel: 'cli', db: d });
    expect(queryEvents(d, { category: 'taste.sentiment' })).toHaveLength(0);
  });
  test('Layer2 classify seam 합류', async () => {
    setUserConfigOverlay((c) => ({ ...c, taste: { captureEnabled: true } }));
    const d = db();
    await captureSentiment({
      text: '음 그냥 그래', channel: 'cli', db: d,
      classify: async () => [{ kind: 'frustration', reward: -0.7 }],
    });
    expect(queryEvents(d, { category: 'taste.sentiment' })).toHaveLength(1);
  });
});

describe('recentSentimentReward — 집계', () => {
  test('최근 감정 각인 평균 reward', async () => {
    setUserConfigOverlay((c) => ({ ...c, taste: { captureEnabled: true } }));
    const d = db();
    await captureSentiment({ text: '완벽해 고마워', channel: 'cli', db: d });     // +0.7
    await captureSentiment({ text: '아니 그게 아니라 틀렸어', channel: 'cli', db: d }); // 음
    const r = recentSentimentReward({ db: d, windowHours: 24 });
    expect(r).toBeLessThan(0.7);
    expect(r).toBeGreaterThan(-1);
  });
  test('무기록 → 0', () => {
    expect(recentSentimentReward({ db: db() })).toBe(0);
  });
});
