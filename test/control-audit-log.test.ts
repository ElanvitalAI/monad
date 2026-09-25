import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  recordControlAudit,
  setControlAuditRootForTesting,
  setControlAuditSinkForTesting,
  type ControlAuditEvent,
} from '../src/control-audit-log.js';
import {
  dispatchControlPromptAppend,
  dispatchControlPromptClear,
  dispatchControlToolToggle,
} from '../src/skills/tools/control.js';
import { _resetPromptHintsForTesting } from '../src/prompt/hint-store.js';

describe('control-audit-log', () => {
  let captured: ControlAuditEvent[] = [];

  beforeEach(() => {
    captured = [];
    _resetPromptHintsForTesting();
    setControlAuditSinkForTesting(ev => { captured.push(ev); });
  });

  afterEach(() => {
    setControlAuditSinkForTesting(null);
    setControlAuditRootForTesting(null);
  });

  test('recordControlAudit routes to the test sink', () => {
    recordControlAudit({
      ts: new Date().toISOString(),
      action: 'test_action',
      subject: 'window:1',
      ok: true,
      detail: { foo: 'bar' },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.action).toBe('test_action');
  });

  test('ControlPromptAppend emits a prompt_append audit', async () => {
    await dispatchControlPromptAppend({ text: 'be terse', scope: 'turn' });
    expect(captured.map(e => e.action)).toContain('prompt_append');
    const ev = captured.find(e => e.action === 'prompt_append')!;
    expect(ev.ok).toBe(true);
    expect((ev.detail as any).length).toBe('be terse'.length);
  });

  test('ControlPromptClear emits a prompt_clear audit', async () => {
    await dispatchControlPromptAppend({ text: 'x', scope: 'session' });
    await dispatchControlPromptClear({ scope: 'session' });
    const actions = captured.map(e => e.action);
    expect(actions).toContain('prompt_append');
    expect(actions).toContain('prompt_clear');
  });

  test('ControlToolToggle emits an audit via publishControlEvent', async () => {
    await dispatchControlToolToggle({ toolId: 'bash', enabled: false });
    await dispatchControlToolToggle({ toolId: 'bash', enabled: true }); // restore
    const toggles = captured.filter(e => (e.detail as any)?.action === 'toggle');
    expect(toggles.length).toBeGreaterThanOrEqual(2);
    expect(toggles[0]!.subject).toBe('tool:bash');
  });
});
