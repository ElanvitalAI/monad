import { describe, expect, test } from 'bun:test';
import { freezeTrajectoryAsSkill, hostOf, isUsableSkillName } from './browser-act-skill.js';
import type { TrajectoryStep } from './browser-act-trajectory.js';

const step = (over: Partial<TrajectoryStep> = {}): TrajectoryStep => ({
  ts: '2026-08-28T00:00:00.000Z',
  url: 'https://news.ycombinator.com',
  target: '.titleline > a',
  coordinates: { x: 1, y: 2 },
  personaId: 'newsbot',
  captureOutcome: 'ok',
  landedUrl: 'https://news.ycombinator.com',
  shotSavedTo: null,
  ok: true,
  failureReason: null,
  ...over,
});

describe('freezeTrajectoryAsSkill — ⛔ 「거절」이 이 변환기의 본체다', () => {
  test('걸음 0 은 굳히지 않는다', () => {
    const r = freezeTrajectoryAsSkill({ name: 'x-skill', steps: [], truncated: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('0');
  });

  test('⛔ 잘린 궤적은 «부분»이다 — 전부로 굳히지 않는다', () => {
    const r = freezeTrajectoryAsSkill({ name: 'x-skill', steps: [step()], truncated: true });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('잘렸다');
  });

  test('⛔ 실패만 있는 궤적은 「할 일」이 아니다', () => {
    const r = freezeTrajectoryAsSkill({ name: 'x-skill', truncated: false,
      steps: [step({ ok: false, failureReason: 'refused' }), step({ ok: false })] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('성공한 걸음');
  });

  test('⛔ 주인이 없거나 여럿이면 굳히지 않는다 — 경계가 페르소나에 붙는다', () => {
    expect(freezeTrajectoryAsSkill({ name: 'x-skill', truncated: false, steps: [step({ personaId: null })] }).ok).toBe(false);
    const many = freezeTrajectoryAsSkill({ name: 'x-skill', truncated: false,
      steps: [step(), step({ personaId: 'investor' })] });
    expect(many.ok).toBe(false);
    expect(!many.ok && many.error).toContain('여럿');
  });

  test('⛔ 못 쓰는 이름은 «조용히 고치지 않고» 거절한다', () => {
    expect(isUsableSkillName('Ok-Name')).toBe(false);
    expect(isUsableSkillName('a')).toBe(false);
    expect(isUsableSkillName('hn-open')).toBe(true);
    expect(freezeTrajectoryAsSkill({ name: 'Bad Name', truncated: false, steps: [step()] }).ok).toBe(false);
  });
});

describe('freezeTrajectoryAsSkill — 🚧 경계를 «같이» 박는다', () => {
  test('누른 곳과 «착지한 곳»을 둘 다 모은다 — 302 로 나간 것이 여기서 드러난다', () => {
    const r = freezeTrajectoryAsSkill({ name: 'hn-open', truncated: false,
      steps: [step({ landedUrl: 'https://elsewhere.test/a' })] });
    expect(r.ok).toBe(true);
    expect(r.ok && r.hosts).toEqual(['elsewhere.test', 'news.ycombinator.com']);
    expect(r.ok && r.md).toContain('elsewhere.test');
  });

  test('⚠️ 경계가 «선언 안 됨»과 «경계 밖»을 다른 말로 낸다', () => {
    const none = freezeTrajectoryAsSkill({ name: 'hn-open', truncated: false, steps: [step()] });
    expect(none.ok && none.warnings.join(' ')).toContain('선언돼 있지 않다');

    const outside = freezeTrajectoryAsSkill({ name: 'hn-open', truncated: false,
      steps: [step({ landedUrl: 'https://elsewhere.test/a' })],
      declaredActionHosts: ['news.ycombinator.com'] });
    expect(outside.ok && outside.warnings.join(' ')).toContain('경계 «밖»');
    expect(outside.ok && outside.warnings.join(' ')).toContain('elsewhere.test');
  });

  test('선언된 경계 안이면 «밖» 경고가 없다 — 점 접두도 먹는다', () => {
    const r = freezeTrajectoryAsSkill({ name: 'hn-open', truncated: false, steps: [step()],
      declaredActionHosts: ['.news.ycombinator.com'] });
    expect(r.ok && r.warnings.join(' ')).not.toContain('경계 «밖»');
  });

  test('실패한 걸음은 «빼고» 뺐다고 말한다 — 조용히 줄이지 않는다', () => {
    const r = freezeTrajectoryAsSkill({ name: 'hn-open', truncated: false,
      steps: [step(), step({ ok: false })] });
    expect(r.ok && r.steps).toBe(1);
    expect(r.ok && r.warnings.join(' ')).toContain('안 담았다');
  });
});

describe('freezeTrajectoryAsSkill — 굳힌 스킬의 «모양»', () => {
  test('⛔ 모델이 스스로 못 부른다 ⊕ 출처를 밝힌다', () => {
    const r = freezeTrajectoryAsSkill({ name: 'hn-open', truncated: false, steps: [step()] });
    expect(r.ok && r.md).toContain('disable-model-invocation: true');
    expect(r.ok && r.md).toContain('출처');
    expect(r.ok && r.md).toContain('newsbot');
  });

  test('걸음마다 «실제로 칠 명령»이 들어간다 — 페르소나를 반드시 달고', () => {
    const r = freezeTrajectoryAsSkill({ name: 'hn-open', truncated: false, steps: [step()] });
    expect(r.ok && r.md).toContain('harness browser-act');
    expect(r.ok && r.md).toContain('--persona newsbot');
  });

  test('hostOf 는 www 를 같은 집으로 본다 · 못 읽으면 null', () => {
    expect(hostOf('https://www.iana.org/x')).toBe('iana.org');
    expect(hostOf('not-a-url')).toBeNull();
  });
});
