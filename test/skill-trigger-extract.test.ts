// ── Skill trigger extraction tests ──
//
// Pinned against real SKILL.md descriptions so drift is obvious —
// if someone rewrites a description and these tests start failing,
// the fix is to inspect, not to blindly update expectations.

import { describe, test, expect } from 'bun:test';
import {
  extractTriggers, extractTriggerSegments,
} from '../src/skills/trigger-extract';

describe('extractTriggers — forward "Use when ... :" marker', () => {
  test('youtube-master full description (real fixture)', () => {
    const desc = [
      '통합 YouTube 처리 스킬. YouTube URL에서 자막 추출, 요약(brief/cards/detailed),',
      '학습노트 생성까지 하나의 엔트리포인트로 처리. 출력 타겟은 Obsidian, markdown,',
      'web, pdf. 전사 품질은 Supadata 우선, 필요 시 Cloud STT 자동 전환.',
      'Use when the user provides a youtube.com / youtu.be URL with any intent:',
      '요약, 정리, 저장, Obsidian, 노트, 학습노트, study note, 자막, transcript,',
      '상세 분석, 간단 요약, cc웹, ccv웹, pdf, 자막 강화, 전사 강화.',
    ].join(' ');
    const triggers = extractTriggers(desc);
    // Must include the meat of the trigger list.
    expect(triggers).toContain('요약');
    expect(triggers).toContain('정리');
    expect(triggers).toContain('저장');
    expect(triggers).toContain('transcript');
    expect(triggers).toContain('자막');
    expect(triggers).toContain('학습노트');
    // Should NOT include preamble sentence words.
    expect(triggers).not.toContain('통합 YouTube 처리 스킬');
    expect(triggers).not.toContain('Cloud STT 자동 전환');
  });

  test('omni-digest — comma-list after "Use when ... asks for:"', () => {
    const desc = 'Use when the user provides any URL or file and asks for: 요약, 정리, 저장, 분석, digest, summarize, sum, enrich, 풍부, cc웹, ccv웹, pdf, obsidian.';
    const triggers = extractTriggers(desc);
    expect(triggers).toEqual(expect.arrayContaining(['요약', '정리', 'digest', 'summarize', 'enrich', 'obsidian']));
  });

  test('youtube.com period does NOT split the marker sentence', () => {
    // Regression for the domain-masking path. Without masking, the
    // period in `youtube.com` would break splitSentences before we
    // reach the colon.
    const desc = 'Use when the user provides a youtube.com / youtu.be URL: 요약, 자막.';
    expect(extractTriggers(desc)).toEqual(expect.arrayContaining(['요약', '자막']));
  });
});

describe('extractTriggers — forward "Trigger on:" marker', () => {
  test('show-image — quoted list (real fixture excerpt)', () => {
    const desc = [
      '대화 중 생성되거나 참조된 이미지(PNG, JPG, GIF, WebP, SVG)를 표시하는 스킬.',
      'Use this skill whenever the user wants to view, display, or show an image in the terminal.',
      'Trigger on: "이미지 보여줘", "사진 봐줘", "결과 보여줘", "show image", "view image",',
      '"이미지 확인", "열어줘", "확인해줘" (when image context exists).',
      'Also trigger on open/preview/display requests for any file.',
    ].join(' ');
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('이미지 보여줘');
    expect(triggers).toContain('show image');
    expect(triggers).toContain('확인해줘');
    // Prose "Use this skill whenever..." has no colon → ignored.
    expect(triggers).not.toContain('view');
    expect(triggers).not.toContain('display');
    // "Also trigger on ..." has no colon → ignored.
    expect(triggers).not.toContain('open/preview/display requests for any file');
  });
});

describe('extractTriggers — backward "~ 시 사용" marker', () => {
  test('kr-flow — ~" 시 사용" suffix with quoted list (real fixture)', () => {
    const desc = [
      '한국 시장 투자자 수급 데이터 스킬.',
      '"외국인 순매수", "외국인 보유비중", "투자자별", "기관 순매수", "개인 매도",',
      '"수급", "외국인 수급", "삼성전자 외국인", "KOSPI 외국인", "한국 수급", "KRX",',
      '"foreign flow", "investor trend" 시 사용.',
    ].join(' ');
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('외국인 순매수');
    expect(triggers).toContain('KRX');
    expect(triggers).toContain('foreign flow');
    expect(triggers).toContain('investor trend');
  });

  test('semiconductor-attractiveness — "등의 언급 시 이 스킬 사용" (real fixture)', () => {
    const desc = [
      '삼성전자 외국인 수급 판단 종합 매력도 스킬.',
      '"반도체 매력도", "삼성전자 살지", "SOX 모멘텀", "HBM 수요", "메모리 가격",',
      '"외국인 수급", "반도체 사이클", "매력도 분석", "삼성전자 외국인" 등의 언급 시 이 스킬 사용.',
    ].join(' ');
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('반도체 매력도');
    expect(triggers).toContain('SOX 모멘텀');
    expect(triggers).toContain('외국인 수급');
    expect(triggers).toContain('매력도 분석');
  });

  test('"필요 시 X" does NOT mis-trigger the backward marker', () => {
    // "시" followed by non-사용 token should NOT match.
    const desc = '필요 시 Cloud STT 자동 전환.';
    expect(extractTriggers(desc)).toEqual([]);
  });
});

describe('extractTriggers — mixed / multi-marker', () => {
  test('stochastic-multi-agent-consensus — "Use when:" + tilde placeholders (real fixture)', () => {
    const desc = [
      'Spawn N agents with different expert personas from a 49-persona pool.',
      'Use when: "poll 10 agents on ~", "what do 10 agents think about ~", "stochastic consensus on ~",',
      '"spawn N agents to analyze ~", "multi-agent vote: ~", "consensus on ~", "get multiple opinions on ~".',
      'Examples: "poll 10 agents on 삼성전자 2026 주식 전망".',
    ].join(' ');
    const triggers = extractTriggers(desc);
    // Tildes stripped, colons trimmed.
    expect(triggers).toContain('poll 10 agents on');
    expect(triggers).toContain('consensus on');
    expect(triggers).toContain('multi-agent vote');
    // "Examples:" is not a recognized marker → its items are not triggers.
    expect(triggers).not.toContain('poll 10 agents on 삼성전자 2026 주식 전망');
  });

  test('browser-debug — single-quoted list after "Use when:" (real fixture)', () => {
    const desc = [
      'CDP 기반 브라우저 디버깅 스킬. 웹 배포 전 로컬 검증에 사용.',
      "Use when: '브라우저 디버깅', '로컬 확인', '스크린샷', 'full page screenshot',",
      "'전체 스크린샷', '페이지 확인', '배포 전 검증', 'debug', 'CDP'.",
    ].join(' ');
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('브라우저 디버깅');
    expect(triggers).toContain('full page screenshot');
    expect(triggers).toContain('CDP');
    expect(triggers).toContain('debug');
  });

  test('omni-market — long comma-list spanning multiple lines (real fixture excerpt)', () => {
    const desc = [
      '멀티 프로바이더 금융 데이터 통합 스킬.',
      'Use when the user wants to: 주가, 환율, 금 가격, 유가, 국채, 금리, 수익률곡선,',
      '종목 분석, 재무제표, stock price, forex, earnings, dividend, KOSPI, S&P500, NASDAQ.',
    ].join(' ');
    const triggers = extractTriggers(desc);
    expect(triggers.length).toBeGreaterThan(8);
    expect(triggers).toContain('주가');
    expect(triggers).toContain('stock price');
    expect(triggers).toContain('KOSPI');
  });
});

describe('extractTriggers — negative / conservative paths', () => {
  test('apify-x-asset-sentiment — "Use when" without colon → no triggers', () => {
    // Real fixture: description has "Use when the user wants to change searchTerms..."
    // with NO colon-list. We must NOT hallucinate triggers from prose.
    const desc = 'Run Apify tweet-scraper for asset research on X. Use when the user wants to change searchTerms and pull latest tweets.';
    expect(extractTriggers(desc)).toEqual([]);
  });

  test('diagram-master — free-floating comma-list without any marker → skipped', () => {
    // Conservative path: author listed triggers but used no marker phrase.
    // Precision-first → we skip rather than guess.
    const desc = '통합 다이어그램 스킬. 6개 엔진 자동 라우팅. 다이어그램, 차트, 시각화, 그래프, diagram, chart.';
    expect(extractTriggers(desc)).toEqual([]);
  });

  test('empty description', () => {
    expect(extractTriggers('')).toEqual([]);
    expect(extractTriggers('   ')).toEqual([]);
  });

  test('description without any markers', () => {
    const desc = 'A cool skill that does amazing things and takes no arguments.';
    expect(extractTriggers(desc)).toEqual([]);
  });

  test('"Use this skill whenever..." without colon is NOT a marker', () => {
    const desc = 'Use this skill whenever the user mentions something vague and unstructured.';
    expect(extractTriggers(desc)).toEqual([]);
  });
});

describe('extractTriggers — post-processing', () => {
  test('tilde placeholders are stripped', () => {
    const desc = 'Use when: "analyze ~ for risk", "rank ~ by score".';
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('analyze');
    expect(triggers).toContain('rank');
  });

  test('trailing colon inside quoted trigger is stripped', () => {
    const desc = 'Use when: "multi-agent vote:", "consensus on X".';
    expect(extractTriggers(desc)).toContain('multi-agent vote');
  });

  test('case-insensitive dedup preserves first occurrence', () => {
    const desc = 'Use when: "Summary", "summary", "SUMMARY".';
    const triggers = extractTriggers(desc);
    expect(triggers).toEqual(['Summary']);
  });

  test('stopwords filtered out', () => {
    const desc = 'Use when: the, of, a, 요약, 정리.';
    const triggers = extractTriggers(desc);
    expect(triggers).not.toContain('the');
    expect(triggers).not.toContain('of');
    expect(triggers).not.toContain('a');
    expect(triggers).toContain('요약');
  });

  test('pure-digit tokens filtered', () => {
    const desc = 'Use when: 123, 요약, 2026.';
    const triggers = extractTriggers(desc);
    expect(triggers).not.toContain('123');
    expect(triggers).not.toContain('2026');
    expect(triggers).toContain('요약');
  });

  test('overly long sentence fragment filtered (>40 chars OR >5 spaces)', () => {
    const desc = 'Use when: 요약, "this is a very long sentence fragment that is not a trigger at all really".';
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('요약');
    // Long fragment pushed out.
    expect(triggers).not.toContain('this is a very long sentence fragment that is not a trigger at all really');
  });

  test('trigger with exactly 1 space kept (common multi-word triggers)', () => {
    const desc = 'Use when: "foreign flow", "investor trend", "stock price".';
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('foreign flow');
    expect(triggers).toContain('investor trend');
    expect(triggers).toContain('stock price');
  });
});

describe('extractTriggerSegments — raw segments (for debug / UI)', () => {
  test('returns one segment per recognized marker sentence', () => {
    const desc = 'Use when: a, b. Trigger on: "c", "d". Unrelated sentence here.';
    const segs = extractTriggerSegments(desc);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toContain('a, b');
    expect(segs[1]).toContain('"c", "d"');
  });

  test('empty when no markers present', () => {
    expect(extractTriggerSegments('Just a plain description.')).toEqual([]);
  });
});

// Session 21 — ASCII tokens must be ≥3 chars; CJK 2-char tokens still OK.
describe('extractTriggers — ASCII min-length 3 filter', () => {
  test('drops 2-char ASCII tokens like "ai", "pr", "ui"', () => {
    const desc = 'Use when the user asks: ai, pr, ui, api, frontend.';
    const triggers = extractTriggers(desc);
    expect(triggers).not.toContain('ai');
    expect(triggers).not.toContain('pr');
    expect(triggers).not.toContain('ui');
    // 3-char+ survives.
    expect(triggers).toContain('api');
    expect(triggers).toContain('frontend');
  });

  test('keeps 2-char CJK tokens like "요약", "수급"', () => {
    const desc = 'Use when the user asks: 요약, 수급, 분석.';
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('요약');
    expect(triggers).toContain('수급');
    expect(triggers).toContain('분석');
  });

  test('mixed ASCII/CJK token: the whole token is kept if it contains any CJK', () => {
    const desc = 'Use when the user asks: KR수급, X분석.';
    const triggers = extractTriggers(desc);
    expect(triggers).toContain('KR수급');
    expect(triggers).toContain('X분석');
  });
});
