// PLAN §7 P2 — PTY write arbiter 접근 매트릭스 집행(순수). herdr 배타 owner + 접근모드.
import { describe, expect, test } from 'bun:test';
import { resolveWriteDecision, resolveTakeover, resolveRemoteControlActor, parsePtyWriteActor } from './pty-write-arbiter.js';

describe('resolveWriteDecision (접근 매트릭스)', () => {
  test('read → 둘 다 거부(관찰 전용)', () => {
    expect(resolveWriteDecision('read', 'human').allow).toBe(false);
    expect(resolveWriteDecision('read', 'agent').allow).toBe(false);
  });
  test('write → human ✓ · agent ✗', () => {
    expect(resolveWriteDecision('write', 'human').allow).toBe(true);
    expect(resolveWriteDecision('write', 'agent').allow).toBe(false);
  });
  test('auto → agent ✓ · human ✗', () => {
    expect(resolveWriteDecision('auto', 'agent').allow).toBe(true);
    expect(resolveWriteDecision('auto', 'human').allow).toBe(false);
  });
  test('거부에 reason 동봉(관측·HITL)', () => {
    expect(resolveWriteDecision('auto', 'human').reason).toMatch(/takeover/);
    expect(resolveWriteDecision('read', 'agent').reason).toMatch(/관찰/);
  });
});

describe('resolveTakeover (소유권 이양)', () => {
  test('human on auto+open → auto→write 허용', () => {
    const d = resolveTakeover('auto', 'open', 'human');
    expect(d.allow).toBe(true);
    expect(d.newMode).toBe('write');
  });
  test('human on auto+locked → 거부(보호된 자율)', () => {
    const d = resolveTakeover('auto', 'locked', 'human');
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/locked/);
  });
  test('agent on write+open → write→auto 허용(brain 소유)', () => {
    const d = resolveTakeover('write', 'open', 'agent');
    expect(d.allow).toBe(true);
    expect(d.newMode).toBe('auto');
  });
  test('agent on write+locked → 거부', () => {
    expect(resolveTakeover('write', 'locked', 'agent').allow).toBe(false);
  });
  test('이미 소유 모드 → 멱등 허용', () => {
    expect(resolveTakeover('write', 'locked', 'human')).toMatchObject({ allow: true, newMode: 'write' });
    expect(resolveTakeover('auto', 'locked', 'agent')).toMatchObject({ allow: true, newMode: 'auto' });
  });
  test('read+open → 목표로 전환 허용(관찰 승격)', () => {
    expect(resolveTakeover('read', 'open', 'human')).toMatchObject({ allow: true, newMode: 'write' });
    expect(resolveTakeover('read', 'locked', 'human').allow).toBe(false); // read+locked = 관찰 영구
  });
});

// ── F3 `agent` 슬라이스 — 크로스-프로세스 actor 인가(순수) ──
describe('resolveRemoteControlActor (크로스-프로세스 actor 인가)', () => {
  test('human 은 run 과 무관하게 통과 — 접근 매트릭스가 이미 판정한다(무회귀)', () => {
    expect(resolveRemoteControlActor('human', '', '')).toMatchObject({ allow: true, actor: 'human' });
    expect(resolveRemoteControlActor('human', 'run-a', 'run-b')).toMatchObject({ allow: true, actor: 'human' });
  });

  test('agent 는 같은 run 일 때만 통과한다', () => {
    expect(resolveRemoteControlActor('agent', 'run-a', 'run-a')).toMatchObject({ allow: true, actor: 'agent' });
  });

  test('agent + 다른 run → run-mismatch(무관한 프로세스가 자율 자식을 흔들지 못한다)', () => {
    expect(resolveRemoteControlActor('agent', 'run-a', 'run-b')).toMatchObject({ allow: false, reason: 'run-mismatch' });
  });

  test('⭐ fail-closed — 어느 쪽이든 run 을 모르면 거부하고, 어느 쪽이 빈지 사유로 갈린다', () => {
    // 사유가 갈려야 "인가가 없다"와 "run 이 안 찍혔다"를 관측에서 구분한다.
    expect(resolveRemoteControlActor('agent', '', 'run-a')).toMatchObject({ allow: false, reason: 'agent-run-unidentified' });
    expect(resolveRemoteControlActor('agent', 'run-a', '')).toMatchObject({ allow: false, reason: 'target-run-unidentified' });
    expect(resolveRemoteControlActor('agent', '', '')).toMatchObject({ allow: false, reason: 'agent-run-unidentified' });
  });

  test('공백만 있는 run 은 빈 것으로 본다(양쪽 공백이 서로 "일치"로 통과하면 안 된다)', () => {
    expect(resolveRemoteControlActor('agent', '  ', '  ')).toMatchObject({ allow: false, reason: 'agent-run-unidentified' });
    expect(resolveRemoteControlActor('agent', ' run-a ', 'run-a')).toMatchObject({ allow: true, actor: 'agent' });
  });

  test('거부 결정에는 actor 가 아예 없다 — 호출부가 undefined 를 기본값 human 으로 강등시킬 여지 자체를 없앤다', () => {
    const denied = resolveRemoteControlActor('agent', 'run-a', 'run-b');
    expect(denied.allow).toBe(false);
    expect('actor' in denied).toBe(false);
  });
});

describe('parsePtyWriteActor (신뢰 경계 밖 문자열)', () => {
  test('미지정은 null·undefined **뿐** — 마이그레이션 前 행(컬럼 NULL)·플래그 생략과 호환', () => {
    expect(parsePtyWriteActor(null)).toBe('human');
    expect(parsePtyWriteActor(undefined)).toBe('human');
  });
  test('⭐ 빈 문자열·공백은 미지정이 아니라 미지원 — "비워서 보냈다"는 "안 보냈다"가 아니다', () => {
    expect(parsePtyWriteActor('')).toBeNull();
    expect(parsePtyWriteActor('   ')).toBeNull();
  });
  test('아는 값은 정규화해서 통과', () => {
    expect(parsePtyWriteActor('agent')).toBe('agent');
    expect(parsePtyWriteActor(' AGENT ')).toBe('agent');
    expect(parsePtyWriteActor('Human')).toBe('human');
  });
  test('⭐ 모르는 값은 human 으로 강등되지 않고 null — human 은 takeover 로 소유권을 뺏을 수 있는 강한 쪽이다', () => {
    for (const raw of ['brain', 'agentt', 'system', 'root', '0', 'true']) {
      expect(parsePtyWriteActor(raw)).toBeNull();
    }
  });
});
