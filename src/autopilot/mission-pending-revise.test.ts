import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';
import { savePendingRevise, readPendingRevise, clearPendingRevise, pendingRevisePath } from './mission-pending-revise.js';
import { buildReviseConfirmCard, buildReviseDisambiguationCard } from './mission-notify.js';
import { tryInterceptMissionRevise } from './mission-hitl-callback.js';

const TEST_MISSION = 'apm_test_pending_revise_xyz';

afterEach(() => clearPendingRevise(TEST_MISSION));

describe('mission-pending-revise store', () => {
  it('save -> read 라운드트립', () => {
    savePendingRevise(TEST_MISSION, { comment: '범위축소: X 제외', reviseKind: 'revise-scope', rationale: '하드피처 제외', confidence: 'high', source: 'llm', at: '2026-07-14T00:00:00Z' });
    const d = readPendingRevise(TEST_MISSION);
    expect(d).not.toBeNull();
    expect(d!.comment).toBe('범위축소: X 제외');
    expect(d!.reviseKind).toBe('revise-scope');
    expect(d!.source).toBe('llm');
  });

  it('clear 후 read 는 null', () => {
    savePendingRevise(TEST_MISSION, { comment: 'c', reviseKind: 'revise-custom', rationale: '', confidence: 'low', source: 'heuristic' });
    expect(existsSync(pendingRevisePath(TEST_MISSION))).toBe(true);
    clearPendingRevise(TEST_MISSION);
    expect(readPendingRevise(TEST_MISSION)).toBeNull();
  });

  it('최신 초안이 이전 것을 덮음(단일 슬롯)', () => {
    savePendingRevise(TEST_MISSION, { comment: '첫 초안', reviseKind: 'revise-scope', rationale: '', confidence: 'low', source: 'heuristic' });
    savePendingRevise(TEST_MISSION, { comment: '두번째 초안', reviseKind: 'revise-simpler', rationale: '', confidence: 'med', source: 'llm' });
    expect(readPendingRevise(TEST_MISSION)!.comment).toBe('두번째 초안');
  });

  it('없는 미션 read 는 null(fail-soft)', () => {
    expect(readPendingRevise('apm_never_saved_qqq')).toBeNull();
  });

  it('빈 comment 초안은 read 시 null 로 거부', () => {
    savePendingRevise(TEST_MISSION, { comment: '   ', reviseKind: 'revise-custom', rationale: '', confidence: 'low', source: 'heuristic' });
    expect(readPendingRevise(TEST_MISSION)).toBeNull();
  });
});

describe('buildReviseConfirmCard', () => {
  it('정정 초안 + 3버튼(승인/수정/취소)·콜백 64byte 이내', () => {
    const { text, buttons } = buildReviseConfirmCard('apm_x_abc123', { comment: '범위축소: X 제외', reviseKindLabel: '범위축소', confidence: 'high', rationale: '근거', source: 'llm' });
    expect(text).toContain('범위축소');
    expect(text).toContain('범위축소: X 제외');
    expect(text).toContain('되돌릴 수 있음');
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.text)).toEqual(['✅ 승인', '✏️ 수정', '❌ 취소']);
    for (const b of buttons) {
      expect(b.data).toBeTruthy();
      expect(Buffer.byteLength(b.data!)).toBeLessThanOrEqual(64);
    }
    expect(buttons[0]!.data).toContain('revise-apply');
    expect(buttons[1]!.data).toContain('revise-edit');
    expect(buttons[2]!.data).toContain('revise-cancel');
  });

  it('source=heuristic 이면 "규칙 기반" 표기', () => {
    const { text } = buildReviseConfirmCard('apm_x', { comment: 'c', reviseKindLabel: '간소화', confidence: 'med', rationale: 'r', source: 'heuristic' });
    expect(text).toContain('규칙 기반');
  });
});

describe('buildReviseDisambiguationCard', () => {
  it('후보별 revise-pick 버튼 + 취소·콜백 64byte 이내', () => {
    const { text, buttons } = buildReviseDisambiguationCard([
      { id: 'apm_price_guard_4ca472', goal: '코나투스 가격변동 복원' },
      { id: 'apm_coordinator_a6230f', goal: '적응형 투자 오토파일럿 운영 조율' },
    ]);
    expect(text).toContain('어느 미션을 개정할까요');
    expect(text).toContain('apm_price_guard_4ca472');
    // 후보 2 + 취소 = 3행.
    expect(buttons).toHaveLength(3);
    expect(buttons[0]![0]!.data).toContain('revise-pick');
    expect(buttons[2]![0]!.text).toBe('❌ 취소');
    for (const row of buttons) for (const b of row) expect(Buffer.byteLength(b.data!)).toBeLessThanOrEqual(64);
  });
});

describe('tryInterceptMissionRevise 가드', () => {
  const noopBot = { sendMessage: async () => ({}) };

  it('revise 마커 없으면 false(일반 Q&A로 통과)', async () => {
    expect(await tryInterceptMissionRevise({ text: '안녕', chatId: 1 }, noopBot)).toBe(false);
    expect(await tryInterceptMissionRevise({ replyToText: '그냥 메시지', text: 'x', chatId: 1 }, noopBot)).toBe(false);
  });

  it('마커 있어도 미해석 토큰이면 false(fail-soft·throw 없음)', async () => {
    expect(await tryInterceptMissionRevise({ replyToText: 'apm-revise:notarealtoken', text: '범위 줄여', chatId: 1 }, noopBot)).toBe(false);
    expect(await tryInterceptMissionRevise({ replyToText: 'apm-revise-final:notarealtoken', text: 'x', chatId: 1 }, noopBot)).toBe(false);
  });
});
