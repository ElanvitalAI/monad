// research/resolution mandate 단위테스트 — 순수(주입 usage·부작용 경계·범위·예산/주기). A4.
import { test, expect, describe } from 'bun:test';
import {
  DEFAULT_RESEARCH_MANDATE, loadResearchMandate, evaluateResearchMandate,
  type ResearchMandate, type ResearchRequest,
} from './research-mandate.js';

const req = (over: Partial<ResearchRequest> = {}): ResearchRequest => ({ sideEffect: 'none', ...over });
const md = (over: Partial<ResearchMandate> = {}): ResearchMandate => ({ ...DEFAULT_RESEARCH_MANDATE, ...over });

describe('loadResearchMandate — fail-soft 기본', () => {
  test('부재 경로 → 기본(enabled·무제한)', () => {
    const m = loadResearchMandate('/nonexistent/research-mandate.json');
    expect(m.enabled).toBe(true);
    expect(m.allowedSectors).toEqual([]);
    expect(m.dailyBudget).toBe(0);
  });
});

describe('구조적 경계 — 매매·코드변경은 항상 HITL', () => {
  test('sideEffect=trade → boundary 거부(enabled 여도)', () => {
    const v = evaluateResearchMandate(req({ sideEffect: 'trade' }), md());
    expect(v.autoAccept).toBe(false);
    expect(v.boundary).toBe(true);
    expect(v.reason).toContain('경계');
  });
  test('sideEffect=code → boundary 거부', () => {
    const v = evaluateResearchMandate(req({ sideEffect: 'code' }), md());
    expect(v.autoAccept).toBe(false);
    expect(v.boundary).toBe(true);
  });
});

describe('자동수용 — 부작용 없는 범위 내', () => {
  test('기본(무제한) + sideEffect=none → 자동수용', () => {
    const v = evaluateResearchMandate(req({ sector: '반도체', output: 'analysis-doc' }), md());
    expect(v.autoAccept).toBe(true);
    expect(v.boundary).toBe(false);
  });
  test('enabled=false → HITL(경계 아님)', () => {
    const v = evaluateResearchMandate(req(), md({ enabled: false }));
    expect(v.autoAccept).toBe(false);
    expect(v.boundary).toBe(false);
    expect(v.reason).toContain('disabled');
  });
});

describe('범위 화이트리스트', () => {
  test('허용 섹터 안 → 자동수용', () => {
    const v = evaluateResearchMandate(req({ sector: '반도체' }), md({ allowedSectors: ['반도체', '2차전지'] }));
    expect(v.autoAccept).toBe(true);
  });
  test('허용 섹터 밖 → HITL', () => {
    const v = evaluateResearchMandate(req({ sector: '바이오' }), md({ allowedSectors: ['반도체'] }));
    expect(v.autoAccept).toBe(false);
    expect(v.reason).toContain('섹터');
  });
  test('허용 산출물 밖 → HITL', () => {
    const v = evaluateResearchMandate(req({ output: 'trade-order' }), md({ allowedOutputs: ['analysis-doc', 'knowledge'] }));
    expect(v.autoAccept).toBe(false);
    expect(v.reason).toContain('산출물');
  });
});

describe('예산·주기 게이트', () => {
  test('일일 예산 소진 → HITL', () => {
    const v = evaluateResearchMandate(req(), md({ dailyBudget: 5 }), { usedToday: 5 });
    expect(v.autoAccept).toBe(false);
    expect(v.reason).toContain('예산');
  });
  test('예산 여유 → 자동수용', () => {
    const v = evaluateResearchMandate(req(), md({ dailyBudget: 5 }), { usedToday: 3 });
    expect(v.autoAccept).toBe(true);
  });
  test('최소 주기 미만 → HITL', () => {
    const now = Date.parse('2026-07-11T12:00:00Z');
    const v = evaluateResearchMandate(req(), md({ minIntervalMin: 30 }), { lastRunMs: now - 10 * 60_000, nowMs: now });
    expect(v.autoAccept).toBe(false);
    expect(v.reason).toContain('주기');
  });
  test('최소 주기 충족 → 자동수용', () => {
    const now = Date.parse('2026-07-11T12:00:00Z');
    const v = evaluateResearchMandate(req(), md({ minIntervalMin: 30 }), { lastRunMs: now - 40 * 60_000, nowMs: now });
    expect(v.autoAccept).toBe(true);
  });
});
