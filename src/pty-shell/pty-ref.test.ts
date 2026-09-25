import { describe, it, expect } from 'bun:test';
import { resolvePtyRef, canTransitionAccessMode, type PtyRefItem } from './pty-ref.js';

const items: PtyRefItem[] = [
  { id: 'codex_a3f2b1c4', kind: 'codex', nickname: 'deck' },
  { id: 'mission_9d8e7f6a', kind: 'mission', nickname: 'anti-drift' },
  { id: 'shell_11223344', kind: 'shell' },
  { id: 'codex_ffee0011', kind: 'codex', nickname: 'review' },
];

describe('resolvePtyRef — id·닉네임 alias → 하나의 PTY', () => {
  it('exact id', () => {
    const r = resolvePtyRef('codex_a3f2b1c4', items);
    expect(r.match?.id).toBe('codex_a3f2b1c4');
    expect(r.reason).toBe('exact-id');
  });

  it('닉네임 정확 매치(휴먼 리더블·나중 접근)', () => {
    const r = resolvePtyRef('deck', items);
    expect(r.match?.id).toBe('codex_a3f2b1c4');
    expect(r.reason).toBe('nickname-exact');
  });

  it('밑줄·붙임표 ID의 hex 접두로 접근', () => {
    const r = resolvePtyRef('9d8e', items);
    expect(r.match?.id).toBe('mission_9d8e7f6a');
    expect(r.reason).toBe('id-prefix');

    const hyphenItems: PtyRefItem[] = [{ id: 'shell-11223344', kind: 'shell' }];
    expect(resolvePtyRef('1122', hyphenItems).match?.id).toBe('shell-11223344');
  });

  it('kind 유일하면 kind 로 접근', () => {
    const r = resolvePtyRef('shell', items);
    expect(r.match?.id).toBe('shell_11223344');
    expect(r.reason).toBe('kind');
  });

  it('kind 복수면 ambiguous + 후보 반환', () => {
    const r = resolvePtyRef('codex', items);
    expect(r.match).toBeNull();
    expect(r.reason).toBe('ambiguous');
    expect(r.candidates.length).toBe(2);
  });

  it('닉네임 부분 매치', () => {
    const r = resolvePtyRef('drift', items);
    expect(r.match?.id).toBe('mission_9d8e7f6a');
    expect(r.reason).toBe('nickname-substr');
  });

  it('없으면 none', () => {
    expect(resolvePtyRef('nope', items).reason).toBe('none');
    expect(resolvePtyRef('  ', items).reason).toBe('none');
  });
});

describe('canTransitionAccessMode — 전환불가/전환허용 정책', () => {
  it('open 이면 어떤 전환도 허용', () => {
    expect(canTransitionAccessMode('read', 'write', 'open')).toBe(true);
    expect(canTransitionAccessMode('auto', 'write', 'open')).toBe(true);
  });

  it('locked 면 다른 모드로 전환 거부(write 불가)', () => {
    expect(canTransitionAccessMode('read', 'write', 'locked')).toBe(false);
    expect(canTransitionAccessMode('auto', 'write', 'locked')).toBe(false); // 보호된 자율·무간섭
  });

  it('locked 여도 같은 모드 재설정은 허용', () => {
    expect(canTransitionAccessMode('read', 'read', 'locked')).toBe(true);
  });
});
