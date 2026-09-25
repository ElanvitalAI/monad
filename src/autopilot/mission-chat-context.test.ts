import { describe, it, expect, afterEach } from 'bun:test';
import {
  extractMissionIds,
  recordChatMissionMention, recordChatMissionMentionsFromText, getRecentChatMission, clearChatMissionMention,
  savePendingReviseContext, readPendingReviseContext, clearPendingReviseContext,
} from './mission-chat-context.js';

const CHAT = 987654;
afterEach(() => { clearChatMissionMention(CHAT); clearPendingReviseContext(CHAT); });

describe('extractMissionIds', () => {
  it('apm_ id 추출(중복제거·등장순)', () => {
    expect(extractMissionIds('apm_foo_a1 얘기하다가 apm_bar_b2 도, 다시 apm_foo_a1')).toEqual(['apm_foo_a1', 'apm_bar_b2']);
  });
  it('id 없으면 빈 배열', () => {
    expect(extractMissionIds('그냥 대화')).toEqual([]);
  });
});

describe('최근 언급 미션 추적', () => {
  it('record -> get 라운드트립', () => {
    recordChatMissionMention(CHAT, 'apm_mission_x', 1000);
    expect(getRecentChatMission(CHAT, { now: 1000 + 60_000 })).toBe('apm_mission_x');
  });

  it('window 밖(30분 초과)이면 null', () => {
    recordChatMissionMention(CHAT, 'apm_mission_x', 1000);
    expect(getRecentChatMission(CHAT, { now: 1000 + 31 * 60_000 })).toBeNull();
  });

  it('텍스트에서 마지막 apm_id 를 기록', () => {
    recordChatMissionMentionsFromText(CHAT, 'apm_first_a 랑 apm_second_b 논의', 2000);
    expect(getRecentChatMission(CHAT, { now: 2000 })).toBe('apm_second_b');
  });

  it('텍스트에 id 없으면 no-op', () => {
    recordChatMissionMentionsFromText(CHAT, '미션 얘기지만 id 없음', 3000);
    expect(getRecentChatMission(CHAT, { now: 3000 })).toBeNull();
  });

  it('clear 후 null', () => {
    recordChatMissionMention(CHAT, 'apm_x', 1);
    clearChatMissionMention(CHAT);
    expect(getRecentChatMission(CHAT, { now: 1 })).toBeNull();
  });
});

describe('선택 카드 대기 컨텍스트', () => {
  it('save -> read 라운드트립', () => {
    savePendingReviseContext(CHAT, '위 답변을 바탕으로 개정해줘', 5000);
    expect(readPendingReviseContext(CHAT, { now: 5000 })).toBe('위 답변을 바탕으로 개정해줘');
  });
  it('window 밖(10분 초과)이면 null', () => {
    savePendingReviseContext(CHAT, 'ctx', 5000);
    expect(readPendingReviseContext(CHAT, { now: 5000 + 11 * 60_000 })).toBeNull();
  });
  it('clear 후 null', () => {
    savePendingReviseContext(CHAT, 'ctx', 1);
    clearPendingReviseContext(CHAT);
    expect(readPendingReviseContext(CHAT, { now: 1 })).toBeNull();
  });
});
