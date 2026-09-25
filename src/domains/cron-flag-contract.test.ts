import { describe, expect, it } from 'bun:test';
import { unknownCronFlag } from './cron-flag-contract.js';

describe('unknownCronFlag', () => {
  const contract = { boolean: ['--tick'], valued: ['--root'] } as const;

  it('accepts known boolean flags', () => {
    expect(unknownCronFlag(['--tick'], contract)).toBeUndefined();
  });

  it('consumes the next token for valued flags even when it starts with --', () => {
    expect(unknownCronFlag(['--root', '--path-shaped-value'], contract)).toBeUndefined();
  });

  it('allows positional arguments', () => {
    expect(unknownCronFlag(['positional', '/some/path'], contract)).toBeUndefined();
  });

  it('returns the first unknown -- token', () => {
    expect(unknownCronFlag(['--tick', '--unknown', '--later'], contract)).toBe('--unknown');
  });
});
