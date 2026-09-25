import { describe, expect, test } from 'bun:test';
import { parseRepoUrl } from './sync-repo-runtime.js';

describe('parseRepoUrl', () => {
  test('preserves canonical HTTPS URLs and owner/repo shorthand', () => {
    expect(parseRepoUrl('https://github.com/a/b')).toMatchObject({
      host: 'github.com',
      owner: 'a',
      repo: 'b',
      canonicalUrl: 'https://github.com/a/b',
    });
    expect(parseRepoUrl('owner/repo')).toMatchObject({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      canonicalUrl: 'https://github.com/owner/repo',
    });
  });

  test.each(['javascript://github.com/a/b', 'file://github.com/a/b'])('rejects %s for its scheme', (raw) => {
    expect(() => parseRepoUrl(raw)).toThrow(/scheme/i);
  });

  test('preserves the host rejection for non-allowlisted HTTP URLs', () => {
    expect(() => parseRepoUrl('http://evil.com/a/b')).toThrow(
      'SyncRepo: refusing non-allowlisted host: evil.com',
    );
  });
});
