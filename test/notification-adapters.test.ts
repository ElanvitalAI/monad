import { describe, expect, test } from 'bun:test';

import {
  attentionToNotification,
  blockToNotification,
  exitToNotification,
  oscToNotification,
  statusToNotification,
} from '../src/notifications/adapters.js';
import type { AgentStatusRecord } from '../src/agent-status/store.js';
import type { Block } from '../src/block/store.js';
import type { OscNotifyEvent } from '../src/preview/terminal.js';

describe('notification adapters', () => {
  test('NT2 — status → status kind, err → error kind', () => {
    const working: AgentStatusRecord = { status: 'working', updatedAt: 1, lastEvent: 'message_start' };
    expect(statusToNotification('term:1', working).kind).toBe('status');
    expect(statusToNotification('term:1', working).title).toBe('working · message_start');

    const errored: AgentStatusRecord = { status: 'err', updatedAt: 1, lastEvent: 'error' };
    expect(statusToNotification('term:1', errored).kind).toBe('error');
  });

  test('NT2 — status without lastEvent drops the separator', () => {
    const rec: AgentStatusRecord = { status: 'idle', updatedAt: 1 };
    expect(statusToNotification('term:1', rec).title).toBe('idle');
    expect(statusToNotification('term:1', rec).meta).toBeUndefined();
  });

  test('NT2 — block preview truncates long first lines', () => {
    const block: Block = {
      id: 'blk:1',
      sessionId: 'term:1',
      kind: 'claude-code',
      startedAt: 1,
      endedAt: 2,
      text: 'x'.repeat(100) + '\nsecond line',
    };
    const n = blockToNotification(block);
    expect(n.kind).toBe('block');
    expect(n.title).toBe('block blk:1');
    expect((n.body ?? '').length).toBeLessThanOrEqual(80);
    expect(n.body!.endsWith('...')).toBe(true);
    expect((n.meta as { kind: string }).kind).toBe('claude-code');
  });

  test('NT2 — block with empty text omits the body', () => {
    const block: Block = {
      id: 'blk:2',
      sessionId: 'term:1',
      kind: 'codex',
      startedAt: 1,
      endedAt: 2,
      text: '',
    };
    const n = blockToNotification(block);
    expect(n.body).toBeUndefined();
  });

  test('NT2 — exit formats code vs killed', () => {
    expect(exitToNotification('term:1', 0).title).toBe('exited (code 0)');
    expect(exitToNotification('term:1', 137).title).toBe('exited (code 137)');
    expect(exitToNotification('term:1', null).title).toBe('killed');
  });

  test('NT2 — attention stamps level in title + meta', () => {
    const n = attentionToNotification('term:1', 2);
    expect(n.kind).toBe('hitl');
    expect(n.title).toBe('attention level 2');
    expect((n.meta as { level: number }).level).toBe(2);
  });

  test('NT-E1 — osc preserves title + body + code meta', () => {
    const ev: OscNotifyEvent = { code: 777, title: 'Build done', body: 'passed 142 tests', raw: 'raw' };
    const n = oscToNotification('term:1', ev);
    expect(n.kind).toBe('osc');
    expect(n.title).toBe('Build done');
    expect(n.body).toBe('passed 142 tests');
    expect((n.meta as { code: number }).code).toBe(777);
  });

  test('NT-E1 — osc falls back to osc:<code> when title empty', () => {
    const ev: OscNotifyEvent = { code: 9, title: '', body: '', raw: '' };
    const n = oscToNotification('term:1', ev);
    expect(n.title).toBe('osc:9');
    expect(n.body).toBeUndefined();
  });
});
