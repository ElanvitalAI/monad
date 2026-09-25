import { describe, expect, it } from 'bun:test';
import { branchGoalId, branchLineageSlug, findSiblingPrs } from './pr-lineage.js';

describe('branchLineageSlug', () => {
  it('keeps the legacy path-slug string after stripping the trailing hash', () => {
    expect(branchLineageSlug('self-impl/src-cli-pr-cli-ts-test-cli-pr-cli-test-t-c8cbedac'))
      .toBe('src-cli-pr-cli-ts-test-cli-pr-cli-test-t');
  });

  it('returns null for a non-self-impl branch', () => {
    expect(branchLineageSlug('feat/land')).toBeNull();
  });
});

describe('branchGoalId', () => {
  it('reads the value immediately after goalid-, not the trailing hash', () => {
    expect(branchGoalId('self-impl/200-goalid-c969c242a28942b0-rootintent-s-73733e18'))
      .toBe('c969c242a28942b0');
    expect(branchGoalId('self-impl/200-goalid-c969c242a28942b0-rootintent-s-73733e18'))
      .not.toBe('73733e18');
  });

  it('does not reconstruct a goal id from a legacy path-slug branch', () => {
    expect(branchGoalId('self-impl/src-cli-pr-cli-ts-test-cli-pr-cli-test-t-c8cbedac')).toBeNull();
  });

  it('does not treat a mygoalid-foo substring as a formal -goalid-<id>- segment', () => {
    expect(branchGoalId('self-impl/src-cli-mygoalid-foo-c8cbedac')).toBeNull();
    expect(branchGoalId('self-impl/x-mygoalid-abc-rootintent-s-73733e18')).toBeNull();
    expect(branchLineageSlug('self-impl/src-cli-mygoalid-foo-c8cbedac'))
      .toBe('src-cli-mygoalid-foo');
  });

  it('returns null when the self-impl prefix is absent', () => {
    expect(branchGoalId('200-goalid-c969c242a28942b0-rootintent-s-73733e18')).toBeNull();
  });
});

describe('findSiblingPrs', () => {
  it('keeps same-slug open PRs and drops a different slug', () => {
    expect(findSiblingPrs('self-impl/x-1111aaaa', [
      { number: 101, headRefName: 'self-impl/x-2222bbbb' },
      { number: 102, headRefName: 'self-impl/y-3333cccc' },
    ])).toEqual([{ number: 101, headRefName: 'self-impl/x-2222bbbb' }]);
  });

  it('excludes the current branch from siblings', () => {
    expect(findSiblingPrs('self-impl/x-1111aaaa', [
      { number: 101, headRefName: 'self-impl/x-1111aaaa' },
      { number: 102, headRefName: 'self-impl/x-2222bbbb' },
    ])).toEqual([{ number: 102, headRefName: 'self-impl/x-2222bbbb' }]);
  });

  it('returns an empty list when the current branch has no lineage slug', () => {
    expect(findSiblingPrs('feat/land', [
      { number: 101, headRefName: 'self-impl/x-2222bbbb' },
    ])).toEqual([]);
  });
});
