import { test, expect, describe } from 'bun:test';
import {
  parseTasteType, isNegativePref, cosine, weightedCentroid,
  syncTasteVectors, computeTasteProfile, tasteAffinity,
  type TasteProfile,
} from './taste-model.js';
import { openSurfaceEventsDb, recordEvent } from './surface-events.js';
import { openKnowledgeDb, loadKindVectors, type EmbedFn } from './knowledge.js';

const sdb = () => openSurfaceEventsDb(':memory:');
const kdb = () => openKnowledgeDb(':memory:');

// 결정론 fake embedder — 텍스트의 키워드로 축을 켠 3D 유닛 벡터(nomic 대체).
//   '반도체'→x, '요리'→y, '싫'→z. 같은 축끼리 cosine=1.
const fakeEmbed: EmbedFn = async (text: string) => {
  const v = new Float32Array([
    /반도체|칩|semi/i.test(text) ? 1 : 0,
    /요리|음식|food/i.test(text) ? 1 : 0,
    /싫|말고|dislike/i.test(text) ? 1 : 0,
  ]);
  // 축이 하나도 안 켜지면 원점 회피(테스트 안정).
  if (v[0] === 0 && v[1] === 0 && v[2] === 0) v[0] = 0.01;
  return { vector: v, model: 'fake-3d' };
};

const tasteEvt = (sd: ReturnType<typeof sdb>, type: string, text: string, importance = 5, ts?: string) =>
  recordEvent(sd, {
    surface: 'cli', direction: 'inbound', kind: 'taste', category: 'taste.capture',
    domain: 'elanous', text, importance, tags: `taste:${type},conf:0.7`, ...(ts ? { ts } : {}),
  });

describe('parseTasteType', () => {
  test('tag 에서 type 추출', () => {
    expect(parseTasteType('taste:style_pref,conf:0.80')).toBe('style_pref');
    expect(parseTasteType('conf:0.5,taste:fact')).toBe('fact');
    expect(parseTasteType(null)).toBeNull();
    expect(parseTasteType('mission:x')).toBeNull();
  });
});

describe('isNegativePref', () => {
  test('style_pref + 거부 마커만 부정', () => {
    expect(isNegativePref('style_pref', '긴 설명은 싫어')).toBe(true);
    expect(isNegativePref('style_pref', '이모지 말고 텍스트로')).toBe(true);
    expect(isNegativePref('style_pref', '간결한 한국어 좋아')).toBe(false);
    expect(isNegativePref('fact', '나는 싫은 게 많다')).toBe(false); // fact 는 제외
  });
});

describe('cosine + weightedCentroid (순수)', () => {
  test('cosine 동일축=1·직교=0', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 0]))).toBe(0); // 영벡터 안전
  });
  test('weightedCentroid 가중 평균 + 단위 정규화', () => {
    const c = weightedCentroid([new Float32Array([1, 0]), new Float32Array([0, 1])], [3, 1]);
    expect(c).not.toBeNull();
    // 무게가 x 쪽으로 3:1 → x 성분이 우세.
    expect(c![0]!).toBeGreaterThan(c![1]!);
    expect(Math.hypot(c![0]!, c![1]!)).toBeCloseTo(1); // 유닛
  });
  test('빈 입력 → null', () => {
    expect(weightedCentroid([])).toBeNull();
    expect(weightedCentroid([new Float32Array([1])], [0])).toBeNull(); // wsum 0
  });
});

describe('syncTasteVectors — surface_events → knowledge.db 미러(멱등)', () => {
  test('taste 에피소드 임베딩 + source_ref 태깅 · 재실행 멱등', async () => {
    const sd = sdb(), kd = kdb();
    tasteEvt(sd, 'recurring_topic', '반도체 사이클');
    tasteEvt(sd, 'style_pref', '긴 설명 싫어', 7);
    const r1 = await syncTasteVectors({ surfaceDb: sd, knowledgeDb: kd, embed: fakeEmbed });
    expect(r1.embedded).toBe(2);

    const docs = loadKindVectors(kd, 'taste', 'elanous');
    expect(docs).toHaveLength(2);
    const neg = docs.find(d => JSON.parse(d.source_ref!).negative === true)!;
    expect(neg).toBeTruthy();
    expect(JSON.parse(neg.source_ref!).type).toBe('style_pref');

    // 재실행 = 멱등(id 재사용 → skip).
    const r2 = await syncTasteVectors({ surfaceDb: sd, knowledgeDb: kd, embed: fakeEmbed });
    expect(r2.embedded).toBe(0);
    expect(r2.skipped).toBe(2);
  });
});

describe('computeTasteProfile — dual centroid + 부정', () => {
  test('long(가중)·short(최근창)·neg 분리', async () => {
    const sd = sdb(), kd = kdb();
    const dayMs = 86400_000;
    const now = Date.parse('2000-07-18T00:00:00Z');
    const iso = (offDays: number) => new Date(now - offDays * dayMs).toISOString();
    tasteEvt(sd, 'recurring_topic', '반도체 칩', 9, iso(30)); // 오래됨·고importance → long 지배
    tasteEvt(sd, 'recurring_topic', '요리 음식', 3, iso(1));  // 최근 → short 포함
    tasteEvt(sd, 'style_pref', '반도체 말고', 5, iso(2));      // 부정(싫 계열 '말고')
    tasteEvt(sd, 'recurring_topic', '시작 경계 반도체', 1, new Date(now - 24 * 365 * 3.6e6).toISOString());
    tasteEvt(sd, 'recurring_topic', '종료 경계 요리', 1, new Date(now).toISOString());
    tasteEvt(sd, 'recurring_topic', '미래 요리 음식', 10, new Date(now + dayMs).toISOString());
    // 구현 결함 판정: 동기화 후보 창은 고정 now 양끝을 포함하고 그 이후 fixture를 배제해야 한다.
    await syncTasteVectors({ surfaceDb: sd, knowledgeDb: kd, embed: fakeEmbed, sinceHours: 24 * 365, nowMs: now });

    const prof = computeTasteProfile({ knowledgeDb: kd, shortWindowDays: 7, nowMs: now });
    expect(prof.counts.total).toBe(5); // 시작·종료 경계 포함, nowMs 초과 fixture 제외
    expect(prof.counts.neg).toBe(1);
    expect(prof.counts.long).toBe(4);   // 부정 제외 4
    expect(prof.counts.short).toBe(2);  // 7일 내 = 요리(1일)·종료 경계 (반도체 30일 제외)
    expect(prof.embedModel).toBe('fake-3d');
    expect(prof.long).not.toBeNull();
    expect(prof.neg).not.toBeNull();
  });

  test('빈 코퍼스 → null 프로필', () => {
    const prof = computeTasteProfile({ knowledgeDb: kdb() });
    expect(prof.long).toBeNull();
    expect(prof.counts.total).toBe(0);
  });
});

describe('tasteAffinity — P6 gate primitive', () => {
  test('관심축은 blended 높고 · 부정축은 감산', async () => {
    const sd = sdb(), kd = kdb();
    tasteEvt(sd, 'recurring_topic', '반도체 칩', 8);
    tasteEvt(sd, 'style_pref', '요리 말고', 5); // 부정: 요리(y)+싫(z) 축
    await syncTasteVectors({ surfaceDb: sd, knowledgeDb: kd, embed: fakeEmbed });
    const prof = computeTasteProfile({ knowledgeDb: kd, shortWindowDays: 3650 });

    const semi = await tasteAffinity('새 반도체 리서치', prof, fakeEmbed);
    const food = await tasteAffinity('요리 레시피', prof, fakeEmbed);
    // 반도체는 long 관심축과 정렬 → blended 양수·food 보다 높다.
    expect(semi.longSim).toBeGreaterThan(0.9);
    expect(semi.blended).toBeGreaterThan(food.blended);
  });

  test('빈 프로필이면 전부 0', async () => {
    const prof: TasteProfile = { long: null, short: null, neg: null, counts: { total: 0, long: 0, short: 0, neg: 0 }, embedModel: null };
    const a = await tasteAffinity('아무거나', prof, fakeEmbed);
    expect(a).toEqual({ longSim: 0, shortSim: 0, negSim: 0, blended: 0 });
  });
});
