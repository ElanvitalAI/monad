// 2026-07-20 — skill 라우터 개선 테스트:
//   A) 하이픈 skill명이 명시 트리거가 되어 명시 호출("omni-crawl 로…")이 라우팅
//   B) detectLLM tier-aware full-menu — 강한(T1) 모델은 키워드 약/빈일 때 전 메뉴 라우팅,
//      약한(T3) 모델은 tiebreaker 전용 유지, null 판정은 오트리거 안 함(precision)
import { describe, it, expect } from 'bun:test';
import { nameTriggers } from '../src/skills/index.js';
import { detectLLM, type LLMClassifyResult } from '../src/skills/router.js';
import type { SkillIndexEntry } from '../src/skills/index.js';

const entry = (name: string, over: Partial<SkillIndexEntry> = {}): SkillIndexEntry => ({
  name, description: `${name} skill`, triggers: [], extractedTriggers: [],
  triggerSource: 'none', autoTrigger: false, composes: [], skillDir: `/x/${name}`, rootDir: '/x',
  ...over,
});

describe('A) nameTriggers — 하이픈 이름만(precision guard)', () => {
  it('하이픈 이름 → slug + 공백형', () => {
    expect(nameTriggers('omni-crawl')).toEqual(['omni-crawl', 'omni crawl']);
    expect(nameTriggers('kr-flow')).toEqual(['kr-flow', 'kr flow']);
  });
  it('단어형 이름 → 빈(loop/run/review 오트리거 방지)', () => {
    expect(nameTriggers('loop')).toEqual([]);
    expect(nameTriggers('review')).toEqual([]);
    expect(nameTriggers('webtoon')).toEqual([]);
  });
});

const mkClassify = (res: LLMClassifyResult) =>
  async (): Promise<LLMClassifyResult> => res;

describe('B) detectLLM tier-aware full-menu', () => {
  const index = [entry('omni-crawl'), entry('diagram-master'), entry('kr-flow')];

  it('T1 + 키워드 빈 → full-menu classify 로 라우팅', async () => {
    const r = await detectLLM('요즘 반도체 뭔일 있었지', index, {
      activeTier: 'T1',
      classify: mkClassify({ skill: 'omni-crawl', confidence: 0.9 }),
    });
    expect(r.top?.name).toBe('omni-crawl');
  });

  it('T3(local) + 키워드 빈 → classify 호출 안 함(tiebreaker 전용)', async () => {
    let called = false;
    const r = await detectLLM('요즘 반도체 뭔일 있었지', index, {
      activeTier: 'T3',
      classify: async () => { called = true; return { skill: 'omni-crawl', confidence: 0.9 }; },
    });
    expect(called).toBe(false);
    expect(r.top).toBeNull();
  });

  it('T1 + null 판정 → 오트리거 안 함(negative precision)', async () => {
    const r = await detectLLM('오늘 좀 피곤하네', index, {
      activeTier: 'T1',
      classify: mkClassify({ skill: null, confidence: 0 }),
    });
    expect(r.top).toBeNull();
  });

  it('T1 + 낮은 confidence → 키워드 결과 유지(오트리거 방지)', async () => {
    const r = await detectLLM('뭔가 해줘', index, {
      activeTier: 'T1',
      llmConfidenceThreshold: 0.5,
      classify: mkClassify({ skill: 'omni-crawl', confidence: 0.3 }),
    });
    expect(r.top).toBeNull();
  });

  it('activeTier 미지정 → 기존 동작(full-menu 없음)', async () => {
    let called = false;
    const r = await detectLLM('요즘 반도체 뭔일 있었지', index, {
      classify: async () => { called = true; return { skill: 'omni-crawl', confidence: 0.9 }; },
    });
    expect(called).toBe(false);
    expect(r.top).toBeNull();
  });

  it('full-menu confidence 0.80 → 기본 0.85 floor 미달로 거부(트랩 precision)', async () => {
    const r = await detectLLM('어제 유튜브에서 웃긴 영상 봤는데', index, {
      activeTier: 'T1',
      classify: mkClassify({ skill: 'omni-crawl', confidence: 0.80 }),
    });
    expect(r.top).toBeNull();
  });

  it('full-menu confidence 0.90 → 통과', async () => {
    const r = await detectLLM('요즘 반도체 뭔일 있었지', index, {
      activeTier: 'T1',
      classify: mkClassify({ skill: 'omni-crawl', confidence: 0.90 }),
    });
    expect(r.top?.name).toBe('omni-crawl');
  });

  it('LLM 환각 이름 → 무시', async () => {
    const r = await detectLLM('요즘 반도체 뭔일 있었지', index, {
      activeTier: 'T1',
      classify: mkClassify({ skill: 'nonexistent-skill', confidence: 0.99 }),
    });
    expect(r.top).toBeNull();
  });
});
