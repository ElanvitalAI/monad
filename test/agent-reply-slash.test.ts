// H6 P5 · /reply slash parser + error paths.

import { describe, test, expect } from 'bun:test';
import { executeAgentReplySlash } from '../src/skills/tools/agent-reply-slash.js';

describe('/reply help + routing', () => {
  test('no args · help', async () => {
    const r = await executeAgentReplySlash({ name: 'reply', args: [] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.join('\n')).toMatch(/\/reply/);
  });

  test('help subcommand · renders usage lines', async () => {
    const r = await executeAgentReplySlash({ name: 'reply', args: ['help'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.some((l) => l.includes('--from'))).toBe(true);
  });

  test('mis-routed slash · returns null', async () => {
    const r = await executeAgentReplySlash({ name: 'other', args: [] });
    expect(r).toBeNull();
  });
});

describe('/reply arg parser', () => {
  test('missing target · usage error', async () => {
    const r = await executeAgentReplySlash({ name: 'reply', args: ['--from', 's1'] });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/target session id required/);
  });

  test('missing message · usage error', async () => {
    const r = await executeAgentReplySlash({ name: 'reply', args: ['target-id'] });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/message required/);
  });

  test('--from requires a value', async () => {
    const r = await executeAgentReplySlash({ name: 'reply', args: ['--from'] });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/--from/);
  });

  test('--channels requires a value', async () => {
    const r = await executeAgentReplySlash({ name: 'reply', args: ['--channels'] });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/--channels/);
  });

  test('--idle-ms with non-numeric · error', async () => {
    const r = await executeAgentReplySlash({
      name: 'reply',
      args: ['--idle-ms', 'abc', 'target', 'hi'],
    });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/--idle-ms/);
  });
});

describe('/reply to missing target', () => {
  test('non-existent target surfaces clear error (dispatch-level)', async () => {
    const r = await executeAgentReplySlash({
      name: 'reply',
      args: ['does-not-exist', 'hello', 'there'],
    });
    // The default lookup (findLiveSessionById) returns undefined → dispatch returns isError=true
    expect(r?.ok).toBe(false);
    expect(r?.logLines.join('\n')).toMatch(/not found/);
  });
});

describe('/reply flag combinations parse correctly', () => {
  test('--from + --channels + target + message · ordering preserved', async () => {
    // We can't test end-to-end dispatch without live sessions, but the
    // parser should not reject the arg shape before reaching dispatch.
    // An unknown-target error from dispatch is the expected outcome.
    const r = await executeAgentReplySlash({
      name: 'reply',
      args: ['--from', 's1', '--channels', 'r,m', 'target-x', 'hello', 'world'],
    });
    // Parser accepted flags; dispatch returned not-found (expected in a
    // test harness with no live session registry).
    expect(r?.logLines.join('\n')).toMatch(/not found/);
  });
});
