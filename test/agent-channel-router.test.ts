// H5 Phase 2 · Channel router tests.

import { describe, test, expect } from 'bun:test';
import {
  ChannelRouter,
  codexChannelHook,
  claudeChannelHook,
  geminiChannelHook,
  registerDefaultPatterns,
} from '../src/agent/channel-router.js';

describe('ChannelRouter · default fallback', () => {
  test('unmatched chunk → raw at 0.0 confidence', () => {
    const r = new ChannelRouter();
    const m = r.classify('random noise', { adapterId: 'x' });
    expect(m.channel).toBe('raw');
    expect(m.confidence).toBe(0.0);
    expect(m.matchedBy).toBe('default');
  });
});

describe('ChannelRouter · patterns', () => {
  test('priority order wins · registerDefaultPatterns covers common cases', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    expect(r.classify('Reasoning: thinking about X', { adapterId: 'x' }).channel).toBe('reasoning');
    expect(r.classify('Tool: running ls', { adapterId: 'x' }).channel).toBe('tool-call');
    expect(r.classify('Plan: step 1', { adapterId: 'x' }).channel).toBe('plan');
    expect(r.classify('just some message', { adapterId: 'x' }).channel).toBe('message');
  });

  test('custom pattern at high priority wins over default', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    r.registerPattern({
      channel: 'tool-call',
      regex: /\bspecial\b/,
      priority: 10,
      label: 'custom-special',
    });
    expect(r.classify('this is special stuff', { adapterId: 'x' }).matchedBy).toBe('custom-special');
  });

  test('unregister disposer removes pattern', () => {
    const r = new ChannelRouter();
    const off = r.registerPattern({
      channel: 'reasoning',
      regex: /^UNIQUE_FIXTURE/,
      priority: 5,
      label: 'test',
    });
    expect(r.classify('UNIQUE_FIXTURE yes', { adapterId: 'x' }).channel).toBe('reasoning');
    off();
    expect(r.classify('UNIQUE_FIXTURE yes', { adapterId: 'x' }).channel).toBe('raw');
  });
});

describe('ChannelRouter · adapter hooks', () => {
  test('adapter hook wins over pattern', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    r.registerAdapterHook('codex', () => ({
      channel: 'reasoning',
      confidence: 0.99,
      matchedBy: 'adapter-override',
    }));
    // Would match pattern 'tool-call' via "Tool:" prefix · but hook fires first
    const m = r.classify('Tool: exec', { adapterId: 'codex' });
    expect(m.matchedBy).toBe('adapter-override');
  });

  test('adapter hook returning null falls through to patterns', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    r.registerAdapterHook('codex', () => null);
    const m = r.classify('Tool: exec', { adapterId: 'codex' });
    expect(m.channel).toBe('tool-call');
  });

  test('throwing hook degrades to pattern (no crash)', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    r.registerAdapterHook('codex', () => {
      throw new Error('boom');
    });
    expect(r.classify('Reasoning: x', { adapterId: 'codex' }).channel).toBe('reasoning');
  });

  test('hook only applies to its adapterId', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    r.registerAdapterHook('codex', () => ({
      channel: 'reasoning',
      confidence: 1.0,
      matchedBy: 'codex-only',
    }));
    expect(r.classify('anything', { adapterId: 'other' }).matchedBy).not.toBe('codex-only');
  });
});

describe('codexChannelHook', () => {
  test('JSON-line with kind=reasoning', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('codex-pty', codexChannelHook());
    const m = r.classify('{"kind":"reasoning","text":"hmm"}', { adapterId: 'codex-pty' });
    expect(m.channel).toBe('reasoning');
    expect(m.matchedBy).toBe('codex-json-reasoning');
  });

  test('JSON-line with kind=command_execution maps to tool-call', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('codex-pty', codexChannelHook());
    const m = r.classify('{"kind":"command_execution","cmd":"ls"}', { adapterId: 'codex-pty' });
    expect(m.channel).toBe('tool-call');
  });

  test('bracket-prefix [reasoning]', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('codex-pty', codexChannelHook());
    const m = r.classify('[reasoning] thinking...', { adapterId: 'codex-pty' });
    expect(m.channel).toBe('reasoning');
    expect(m.matchedBy).toBe('codex-bracket-reasoning');
  });

  test('invalid JSON returns null from hook · default patterns take over', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    r.registerAdapterHook('codex-pty', codexChannelHook());
    const m = r.classify('{not json', { adapterId: 'codex-pty' });
    // Not codex-classified (invalid JSON) · falls back to the built-in
    // non-empty pattern which treats any non-whitespace as 'message'.
    expect(m.matchedBy).not.toMatch(/^codex-/);
    expect(m.channel).toBe('message');
  });

  test('invalid JSON with no default patterns falls through to raw', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('codex-pty', codexChannelHook());
    const m = r.classify('{not json', { adapterId: 'codex-pty' });
    expect(m.channel).toBe('raw');
  });
});

describe('claudeChannelHook', () => {
  test('JSON-stream tool_use maps to tool-call', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('claude-pty', claudeChannelHook());
    const m = r.classify('{"type":"tool_use","id":"x"}', { adapterId: 'claude-pty' });
    expect(m.channel).toBe('tool-call');
    expect(m.matchedBy).toBe('claude-json-tool');
  });

  test('JSON-stream thinking maps to reasoning', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('claude-pty', claudeChannelHook());
    const m = r.classify('{"type":"thinking","content":"hmm"}', { adapterId: 'claude-pty' });
    expect(m.channel).toBe('reasoning');
    expect(m.matchedBy).toBe('claude-json-thinking');
  });

  test('JSON-stream assistant envelope maps to message', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('claude-pty', claudeChannelHook());
    const m = r.classify('{"type":"assistant","message":{"role":"assistant"}}', {
      adapterId: 'claude-pty',
    });
    expect(m.channel).toBe('message');
  });

  test('bullet tool marker (● Read(...))', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('claude-pty', claudeChannelHook());
    const m = r.classify('● Read(/tmp/foo.ts)', { adapterId: 'claude-pty' });
    expect(m.channel).toBe('tool-call');
    expect(m.matchedBy).toBe('claude-bullet-tool');
  });

  test('continuation marker (⎿)', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('claude-pty', claudeChannelHook());
    const m = r.classify('⎿  result content', { adapterId: 'claude-pty' });
    expect(m.channel).toBe('tool-call');
    expect(m.matchedBy).toBe('claude-cont-tool');
  });

  test('plain text returns null · default patterns take over', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    r.registerAdapterHook('claude-pty', claudeChannelHook());
    const m = r.classify('just a response from the model', { adapterId: 'claude-pty' });
    expect(m.channel).toBe('message');
    expect(m.matchedBy).not.toMatch(/^claude-/);
  });
});

describe('geminiChannelHook', () => {
  test('JSON-stream tool_call maps to tool-call', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('gemini-pty', geminiChannelHook());
    const m = r.classify('{"type":"tool_call","name":"bash"}', { adapterId: 'gemini-pty' });
    expect(m.channel).toBe('tool-call');
    expect(m.matchedBy).toBe('gemini-json-tool');
  });

  test('JSON-stream thought maps to reasoning', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('gemini-pty', geminiChannelHook());
    const m = r.classify('{"type":"thought","content":"..."}', { adapterId: 'gemini-pty' });
    expect(m.channel).toBe('reasoning');
  });

  test('JSON-stream role=model maps to message', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('gemini-pty', geminiChannelHook());
    const m = r.classify('{"role":"model","text":"hi"}', { adapterId: 'gemini-pty' });
    expect(m.channel).toBe('message');
  });

  test('plain-text prefix · "Running: ls -la"', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('gemini-pty', geminiChannelHook());
    const m = r.classify('Running: ls -la', { adapterId: 'gemini-pty' });
    expect(m.channel).toBe('tool-call');
    expect(m.matchedBy).toBe('gemini-prefix-tool');
  });

  test('plain-text prefix · "Thinking..."', () => {
    const r = new ChannelRouter();
    r.registerAdapterHook('gemini-pty', geminiChannelHook());
    const m = r.classify('Thinking. Let me look at the file', { adapterId: 'gemini-pty' });
    expect(m.channel).toBe('reasoning');
    expect(m.matchedBy).toBe('gemini-prefix-thinking');
  });

  test('unmatched falls through · default patterns take over', () => {
    const r = new ChannelRouter();
    registerDefaultPatterns(r);
    r.registerAdapterHook('gemini-pty', geminiChannelHook());
    const m = r.classify('plain response', { adapterId: 'gemini-pty' });
    expect(m.channel).toBe('message');
    expect(m.matchedBy).not.toMatch(/^gemini-/);
  });
});
