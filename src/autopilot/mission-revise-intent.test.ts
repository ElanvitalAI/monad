import { describe, it, expect, afterEach } from 'bun:test';
import { detectReviseIntent, resolveActiveMissionForChat } from './mission-revise-intent.js';
import { tryInterceptMissionReviseIntent } from './mission-hitl-callback.js';
import { readPendingRevise, clearPendingRevise } from './mission-pending-revise.js';
import { clearPendingReviseContext } from './mission-chat-context.js';
import type { MissionRow } from './mission-registry.js';

describe('detectReviseIntent', () => {
  it('명령형 정정 의도 감지', () => {
    expect(detectReviseIntent('이 미션 개정해줘').isIntent).toBe(true);
    expect(detectReviseIntent('미션 범위 좀 바꿔주세요').isIntent).toBe(true);
    expect(detectReviseIntent('골 좀 고쳐줘').isIntent).toBe(true);
    expect(detectReviseIntent('저 미션 재분해해줘').isIntent).toBe(true);
  });

  it('명시 apm_id 추출', () => {
    const r = detectReviseIntent('apm_price_guard_x 이거 개정해줘');
    expect(r.isIntent).toBe(true);
    expect(r.explicitId).toBe('apm_price_guard_x');
  });

  it('질문은 트리거 안 함(하이재킹 방지)', () => {
    expect(detectReviseIntent('미션 개정 어떻게 해?').isIntent).toBe(false);
    expect(detectReviseIntent('미션 개정하는 방법 뭐야').isIntent).toBe(false);
    expect(detectReviseIntent('미션 바꿀 수 있나요?').isIntent).toBe(false);
  });

  it('미션 언급 없으면 트리거 안 함', () => {
    expect(detectReviseIntent('날씨 좀 바꿔줘').isIntent).toBe(false);
    expect(detectReviseIntent('이거 고쳐줘').isIntent).toBe(false);
  });

  it('정정 동사 없으면 트리거 안 함', () => {
    expect(detectReviseIntent('미션 목록 보여줘').isIntent).toBe(false);
    expect(detectReviseIntent('이 미션 상태 알려줘').isIntent).toBe(false);
  });

  it('슬래시 명령·과장문은 트리거 안 함', () => {
    expect(detectReviseIntent('/mission_revise 미션 개정').isIntent).toBe(false);
    expect(detectReviseIntent('미션 개정 '.repeat(80)).isIntent).toBe(false); // >400자
  });
});

describe('resolveActiveMissionForChat', () => {
  const row = (id: string, status: string, createdAt: number): MissionRow => ({
    id, goal: 'g', source: 'human-intent', execution_model: null, domain: null, tier: null, engine: null,
    mode: null, rationale: null, confidence: null, status, run_ids: null,
    created_at: new Date(createdAt).toISOString(), updated_at: new Date(createdAt).toISOString(),
  });

  it('이 채팅방의 최근 활성 미션(최신순 첫 건) 반환', () => {
    // listMissions 는 최신순(DESC) 반환 계약 — 여기선 DESC 로 준비.
    const list = () => [row('apm_new', 'running', 200), row('apm_old', 'armed', 100)];
    const origin = (id: string) => (id === 'apm_new' || id === 'apm_old' ? { channel: 'telegram' as const, chatId: 777 } : null);
    const r = resolveActiveMissionForChat(777, { list, origin });
    expect(r.missionId).toBe('apm_new');
    expect(r.candidates.map((c) => c.id)).toEqual(['apm_new', 'apm_old']);
  });

  it('종결 미션(done/rejected)은 제외', () => {
    const list = () => [row('apm_done', 'done', 300), row('apm_run', 'running', 200)];
    const origin = () => ({ channel: 'telegram' as const, chatId: 5 });
    const r = resolveActiveMissionForChat(5, { list, origin });
    expect(r.missionId).toBe('apm_run');
  });

  it('다른 채팅방 미션은 제외', () => {
    const list = () => [row('apm_other', 'running', 100)];
    const origin = () => ({ channel: 'telegram' as const, chatId: 999 });
    expect(resolveActiveMissionForChat(1, { list, origin }).missionId).toBeNull();
  });

  it('활성 미션 없으면 null', () => {
    expect(resolveActiveMissionForChat(1, { list: () => [], origin: () => null }).missionId).toBeNull();
  });
});

describe('tryInterceptMissionReviseIntent', () => {
  const TEST_MISSION = 'apm_test_intent_route_x';
  afterEach(() => {
    for (const id of [TEST_MISSION, 'apm_recent_first', 'apm_other_z', 'apm_other_y']) clearPendingRevise(id);
    clearPendingReviseContext(1);
  });

  const mockBot = () => {
    const sent: string[] = [];
    return { sent, bot: { sendMessage: async (_c: number, text: string) => { sent.push(text); return {}; } } };
  };

  it('비의도 텍스트는 false(LLM 폴백)', async () => {
    const { bot } = mockBot();
    expect(await tryInterceptMissionReviseIntent({ text: '안녕하세요', chatId: 1 }, bot)).toBe(false);
  });

  const cand = (id: string, goal = 'g') => ({ id, goal, status: 'running' });

  it('의도지만 활성 미션 없으면 false(하이재킹 안 함)', async () => {
    const { bot } = mockBot();
    const resolve = () => ({ missionId: null, candidates: [] });
    expect(await tryInterceptMissionReviseIntent({ text: '이 미션 개정해줘', chatId: 1 }, bot, { resolve })).toBe(false);
  });

  it('명시 apm_id 최우선 -> 그 미션 추천 카드', async () => {
    const { sent, bot } = mockBot();
    // resolve 는 다른 미션을 주지만 명시 id 가 이겨야 한다.
    const resolve = () => ({ missionId: 'apm_other_z', candidates: [cand('apm_other_z')] });
    const ok = await tryInterceptMissionReviseIntent({ text: `${TEST_MISSION} 이거 범위 줄여서 개정해줘`, chatId: 1 }, bot, { resolve });
    expect(ok).toBe(true);
    expect(sent[0]).toContain('골 정정(revise) 추천');
    expect(readPendingRevise(TEST_MISSION)).not.toBeNull(); // 명시 id 미션에 초안 저장
  });

  it('단일 활성 미션 -> 초안 저장 + 카드 발송', async () => {
    const { sent, bot } = mockBot();
    const resolve = () => ({ missionId: TEST_MISSION, candidates: [cand(TEST_MISSION)] });
    const ok = await tryInterceptMissionReviseIntent({ text: '이 미션 범위 좀 줄여서 개정해줘', chatId: 1 }, bot, { resolve });
    expect(ok).toBe(true);
    expect(sent[0]).toContain('골 정정(revise) 추천');
    const draft = readPendingRevise(TEST_MISSION);
    expect(draft).not.toBeNull();
    expect(draft!.comment).toContain('줄여');
  });

  it('맥락-인지: 최근 논의 미션이 후보 중이면 recency 대신 그것 선택', async () => {
    const { sent, bot } = mockBot();
    // 후보 첫 건(recency)은 apm_recent_first 지만, 최근 논의는 TEST_MISSION 이어야 이긴다.
    const resolve = () => ({ missionId: 'apm_recent_first', candidates: [cand('apm_recent_first'), cand(TEST_MISSION)] });
    const recentMission = () => TEST_MISSION;
    await tryInterceptMissionReviseIntent({ text: '미션 범위 줄여서 개정해줘', chatId: 1 }, bot, { resolve, recentMission });
    expect(sent[0]).toContain('골 정정(revise) 추천');
    // recency 첫 건이 아니라 최근 논의(TEST_MISSION)에 초안이 저장돼야 한다.
    expect(readPendingRevise(TEST_MISSION)).not.toBeNull();
    expect(readPendingRevise('apm_recent_first')).toBeNull();
  });

  it('모호(2건+·맥락 없음) -> recency 로 찍지 말고 선택 카드', async () => {
    const { sent, bot } = mockBot();
    const resolve = () => ({ missionId: TEST_MISSION, candidates: [cand(TEST_MISSION, 'price guard'), cand('apm_other_y', 'coordinator')] });
    const recentMission = () => null; // 최근 논의 없음
    const ok = await tryInterceptMissionReviseIntent({ text: '미션 개정해줘 범위 축소', chatId: 1 }, bot, { resolve, recentMission });
    expect(ok).toBe(true);
    expect(sent[0]).toContain('어느 미션을 개정할까요');
    // 자동 초안 저장 안 함(선택 대기).
    expect(readPendingRevise(TEST_MISSION)).toBeNull();
  });
});
