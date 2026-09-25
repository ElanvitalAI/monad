import { describe, expect, test } from 'bun:test';
import { activeToolProfile, applyToolProfile, childToolProfile, parseToolProfile } from './tool-profile.js';

// BACKLOG L1 — 기본(다이어트) ⊕ 추가 묶음. 대표 09-25: 이원화 없이 «ADD».
describe('tool profile = base ⊕ extra groups (BACKLOG L1)', () => {
  const tools = ['Read', 'Edit', 'Bash', 'memory_recall', 'logs_query', 'skill_exec', 'finance_quote', 'finance_13f', 'conatus_position', 'schedule_manage', 'ops_status', 'mission_decide', 'update_goal']
    .map((name) => ({ name }));
  const names = (p: string) => applyToolProfile(tools, parseToolProfile(p)).tools!.map((t) => t.name);
  test('no profile → unchanged (chat·telegram·daemon)', () => {
    expect(activeToolProfile({})).toBeNull();
    expect(applyToolProfile(tools, null).tools).toBe(tools);
  });
  test('coding = base only; full = everything; a group adds only that group', () => {
    expect(names('coding')).toEqual(['Read', 'Edit', 'Bash', 'memory_recall', 'logs_query', 'skill_exec', 'update_goal']);
    expect(names('full')).toEqual(tools.map((t) => t.name));
    expect(names('finance')).toEqual(['Read', 'Edit', 'Bash', 'memory_recall', 'logs_query', 'skill_exec', 'finance_quote', 'finance_13f', 'conatus_position', 'update_goal']);
  });
  test('every mode is a superset of coding (a mode switch never drops a tool used earlier)', () => {
    const base = new Set(names('coding'));
    for (const p of ['full', 'finance', 'ops', 'finance,ops']) for (const n of base) expect(names(p)).toContain(n);
  });
  test('child profile: default coding, parent chooses full or groups; unknown group falls back to coding', () => {
    expect(childToolProfile({})).toBe('coding');
    expect(childToolProfile({ MONAD_CHILD_TOOL_PROFILE: 'full' })).toBe('full');
    expect(parseToolProfile('nope')!.name).toBe('coding');
  });
});

// 대표 09-25 「config 가 아니라 상황별로 풀 모드」
import { omittedToolGroupsNote, situationalToolGroups } from './tool-profile.js';
describe('situational tool groups', () => {
  test('goal text adds the matching groups; explicit env wins; plain coding goal stays coding', () => {
    expect(situationalToolGroups('삼성전자 종목 13F 포지션을 조회해 리포트')).toEqual(['finance']);
    expect(childToolProfile({}, '포트폴리오 백테스트 후 스케줄 등록')).toBe('finance,ops');
    expect(childToolProfile({}, '대상 경로: src/foo.ts · 파서 버그 수정')).toBe('coding');
    expect(childToolProfile({ MONAD_CHILD_TOOL_PROFILE: 'coding' }, '종목 매매')).toBe('coding');
    expect(childToolProfile({ MONAD_CHILD_TOOL_PROFILE: 'full' }, '파서 수정')).toBe('full');
  });
  test('omitted groups are announced in one line (names only, no schemas)', () => {
    const note = omittedToolGroupsNote(['finance_quote', 'finance_13f', 'ops_status']);
    expect(note).toContain('finance(2');
    expect(note).toContain('ops(1');
    expect(note).toContain('ToolSearch');
    expect(omittedToolGroupsNote([])).toBeNull();
  });
});
