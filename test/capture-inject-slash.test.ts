// H6 P7 · /inject slash command tests.

import { describe, test, expect, beforeEach } from 'bun:test';
import { executeCaptureInjectSlash } from '../src/skills/tools/capture-inject-slash.js';

// The slash invokes dispatchInjectCaptureToContext → defaultDeps() →
// findLiveSessionById + defaultCaptureSourceRegistry. To keep these
// tests deterministic without booting the dashboard we rely on
// validation paths (arg parsing · help · invalid inputs) that return
// BEFORE dispatch, plus one smoke test that expects a missing-target
// error (since no live session is registered at test time).

describe('executeCaptureInjectSlash · routing + arg validation', () => {
  beforeEach(() => {
    // Test isolation · no setup needed (no live sessions by default).
  });

  test('rejects non-inject slash name', async () => {
    const r = await executeCaptureInjectSlash({ name: 'reply', args: [] });
    expect(r).toBeNull();
  });

  test('help without args', async () => {
    const r = await executeCaptureInjectSlash({ name: 'inject', args: [] });
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    expect(r!.logLines.join('\n')).toContain('/inject — inject a capture-source');
    expect(r!.logLines.join('\n')).toContain('--as user-message');
  });

  test('explicit help flag', async () => {
    const r = await executeCaptureInjectSlash({ name: 'inject', args: ['help'] });
    expect(r!.ok).toBe(true);
    expect(r!.logLines.some((l) => l.includes('attached-block'))).toBe(true);
  });

  test('missing sourceId arg → error with guidance', async () => {
    const r = await executeCaptureInjectSlash({
      name: 'inject',
      args: ['--as', 'system-note'],
    });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('sourceId required');
  });

  test('missing targetId arg → error', async () => {
    const r = await executeCaptureInjectSlash({
      name: 'inject',
      args: ['vw-pane:1/p1'],
    });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('targetId required');
  });

  test('invalid --as mode → error with valid list', async () => {
    const r = await executeCaptureInjectSlash({
      name: 'inject',
      args: ['--as', 'bogus', 'src', 'tgt'],
    });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('invalid --as');
  });

  test('--as without value → error', async () => {
    const r = await executeCaptureInjectSlash({
      name: 'inject',
      args: ['--as'],
    });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('--as requires');
  });

  test('--at with invalid number → error', async () => {
    const r = await executeCaptureInjectSlash({
      name: 'inject',
      args: ['--at', 'not-a-number', 'src', 'tgt'],
    });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('--at expects');
  });

  test('--from without value → error', async () => {
    const r = await executeCaptureInjectSlash({
      name: 'inject',
      args: ['--from'],
    });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('--from requires');
  });

  test('extra positional after targetId → error', async () => {
    const r = await executeCaptureInjectSlash({
      name: 'inject',
      args: ['src', 'tgt', 'extra', 'junk'],
    });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('unexpected extra');
  });

  test('valid args reach dispatcher · surfaces source-missing for fake id', async () => {
    // defaultDeps() → defaultCaptureSourceRegistry() is empty in test env ·
    // snapshot throws UnknownCaptureSourceError → InjectError(source-missing).
    const r = await executeCaptureInjectSlash({
      name: 'inject',
      args: ['bogus:none', 'ghost-target'],
    });
    expect(r!.ok).toBe(false);
    // The dispatcher short-circuits on target-missing BEFORE snapshot
    // when the session registry is empty · either error is acceptable
    // (target-missing fires first because lookupSession runs pre-snapshot).
    const output = r!.logLines.join(' ');
    expect(
      output.includes('target session') || output.includes('snapshot failed'),
    ).toBe(true);
  });
});
