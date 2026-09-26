import { describe, expect, test } from 'bun:test';
import { format, parse, type PrCommentMeta } from './pr-comment-meta.js';

describe('PR comment metadata', () => {
  test('format → parse round-trip encodes spaces, newlines, and closing angle brackets without early comment closure', () => {
    const meta: PrCommentMeta = {
      role: 'reviewer', round: 2, run: 'run one\nline>', model: 'model > one',
      mf: '3', replyTo: 'round 1', answered: '2', unanswered: '1',
    };
    const header = format(meta);
    expect(header).toContain('run=run%20one%0Aline%3E');
    expect(header).toContain('model=model%20%3E%20one');
    expect((header.match(/-->/g) ?? []).length).toBe(1);
    expect(parse(`${header}\nHuman-readable body`)).toEqual(meta);
  });

  test('ignores unknown keys for forward compatibility while retaining all v1 fields', () => {
    expect(parse('<!-- elanous-pr-comment v1 role=author future=value run=run-1 mf=2 replyTo=1 answered=2 unanswered=0 -->'))
      .toEqual({ role: 'author', run: 'run-1', mf: '2', replyTo: '1', answered: '2', unanswered: '0' });
  });

  test('rejects an unknown role and duplicate keys', () => {
    expect(parse('<!-- elanous-pr-comment v1 role=robot -->')).toBeNull();
    expect(parse('<!-- elanous-pr-comment v1 role=author run=one run=two -->')).toBeNull();
  });

  test('drops only malformed or negative round values', () => {
    expect(parse('<!-- elanous-pr-comment v1 role=judge round=two run=run-1 -->')).toEqual({ role: 'judge', run: 'run-1' });
    expect(parse('<!-- elanous-pr-comment v1 role=judge round=-1 run=run-1 -->')).toEqual({ role: 'judge', run: 'run-1' });
  });

  test('returns null, without throwing, for ordinary human comments without a header', () => {
    expect(() => parse('평범한 사람이 손으로 쓴 코멘트')).not.toThrow();
    expect(parse('평범한 사람이 손으로 쓴 코멘트')).toBeNull();
  });

  test('rejects a header not on the first line, missing role or close, and an unknown version', () => {
    expect(parse('intro\n<!-- elanous-pr-comment v1 role=author -->')).toBeNull();
    expect(parse('<!-- elanous-pr-comment v1 run=run-1 -->')).toBeNull();
    expect(parse('<!-- elanous-pr-comment v1 role=author')).toBeNull();
    expect(parse('<!-- elanous-pr-comment v2 role=author -->')).toBeNull();
  });
});
