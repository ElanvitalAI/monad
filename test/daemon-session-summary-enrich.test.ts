// PR #2.5 — DaemonSessionHistory: lastMsgPreview + origin field
// enrichment for the PWA multitab workspace picker.
//
// Covers: extractLastMsgPreview pure helper · register opts.origin ·
// setOrigin · summary() field shape · multimodal / empty / long
// message edge cases.

import { describe, expect, test } from 'bun:test';
import {
  DaemonSessionHistory,
  extractLastMsgPreview,
  isDaemonSessionOrigin,
} from '../src/boot/daemon-runtime.js';
import type { LLMMessage } from '../src/llm.js';

describe('isDaemonSessionOrigin', () => {
  test('canonical four pass', () => {
    expect(isDaemonSessionOrigin('cli')).toBe(true);
    expect(isDaemonSessionOrigin('pwa')).toBe(true);
    expect(isDaemonSessionOrigin('tg')).toBe(true);
    expect(isDaemonSessionOrigin('dc')).toBe(true);
  });
  test('rejects everything else', () => {
    expect(isDaemonSessionOrigin('cli ')).toBe(false);
    expect(isDaemonSessionOrigin('PWA')).toBe(false);
    expect(isDaemonSessionOrigin('')).toBe(false);
    expect(isDaemonSessionOrigin(undefined)).toBe(false);
    expect(isDaemonSessionOrigin(null)).toBe(false);
    expect(isDaemonSessionOrigin(42)).toBe(false);
    expect(isDaemonSessionOrigin({ origin: 'cli' })).toBe(false);
  });
});

describe('extractLastMsgPreview', () => {
  test('빈 list → undefined', () => {
    expect(extractLastMsgPreview([])).toBeUndefined();
  });

  test('user 단일 텍스트 메시지', () => {
    const m: LLMMessage = { role: 'user', content: 'hello world' };
    expect(extractLastMsgPreview([m])).toBe('hello world');
  });

  test('60자 초과 시 잘림', () => {
    const long = 'a'.repeat(120);
    const m: LLMMessage = { role: 'user', content: long };
    const out = extractLastMsgPreview([m]);
    expect(out).toBeDefined();
    expect(out!.length).toBe(60);
    expect(out!.endsWith('…')).toBe(true);
  });

  test('newline / 다중 공백 collapse', () => {
    const m: LLMMessage = { role: 'user', content: 'first\n\nsecond\t\tthird' };
    expect(extractLastMsgPreview([m])).toBe('first second third');
  });

  test('마지막 텍스트 메시지를 우선 (assistant)', () => {
    const u: LLMMessage = { role: 'user', content: 'q' };
    const a: LLMMessage = { role: 'assistant', content: 'A' };
    expect(extractLastMsgPreview([u, a])).toBe('A');
  });

  test('tool / system 무시', () => {
    const u: LLMMessage = { role: 'user', content: 'recent user' };
    const sys = { role: 'system', content: 'should be skipped' } as LLMMessage;
    const tool = { role: 'tool', content: 'tool result' } as unknown as LLMMessage;
    expect(extractLastMsgPreview([u, sys, tool])).toBe('recent user');
  });

  test('multimodal ContentBlock array → text 만 추출', () => {
    const m: LLMMessage = {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64' } },
        { type: 'text', text: 'caption' },
      ] as never,
    };
    expect(extractLastMsgPreview([m])).toBe('caption');
  });

  test('image-only multimodal → 이전 텍스트 메시지로 fallback', () => {
    const u1: LLMMessage = { role: 'user', content: 'old text turn' };
    const u2: LLMMessage = {
      role: 'user',
      content: [{ type: 'image', source: {} }] as never,
    };
    expect(extractLastMsgPreview([u1, u2])).toBe('old text turn');
  });

  test('완전히 빈 content 모두 → undefined', () => {
    const m1: LLMMessage = { role: 'user', content: '' };
    const m2: LLMMessage = { role: 'assistant', content: '   ' };
    expect(extractLastMsgPreview([m1, m2])).toBeUndefined();
  });
});

describe('DaemonSessionHistory · register origin', () => {
  test('register with origin opt → getOrigin 으로 회수', () => {
    const h = new DaemonSessionHistory();
    h.register('s1', [], { origin: 'pwa' });
    expect(h.getOrigin('s1')).toBe('pwa');
  });

  test('origin 미지정 register → undefined', () => {
    const h = new DaemonSessionHistory();
    h.register('s1');
    expect(h.getOrigin('s1')).toBeUndefined();
  });

  test('setOrigin 으로 사후 set', () => {
    const h = new DaemonSessionHistory();
    h.register('s1');
    h.setOrigin('s1', 'cli');
    expect(h.getOrigin('s1')).toBe('cli');
  });

  test('setOrigin 미존재 sessionId → no-op', () => {
    const h = new DaemonSessionHistory();
    h.setOrigin('ghost', 'cli');
    expect(h.getOrigin('ghost')).toBeUndefined();
  });

  test('setOrigin 잘못된 origin → no-op', () => {
    const h = new DaemonSessionHistory();
    h.register('s1');
    h.setOrigin('s1', 'bogus' as never);
    expect(h.getOrigin('s1')).toBeUndefined();
  });

  test('forget 시 origin 도 같이 정리', () => {
    const h = new DaemonSessionHistory();
    h.register('s1', [], { origin: 'pwa' });
    h.forget('s1');
    expect(h.getOrigin('s1')).toBeUndefined();
  });
});

describe('DaemonSessionHistory · summary 새 필드', () => {
  test('msg 없는 session → preview 없음, origin 있음', () => {
    const h = new DaemonSessionHistory();
    h.register('s1', [], { origin: 'pwa' });
    const s = h.summary().find((x) => x.id === 's1');
    expect(s).toBeDefined();
    expect(s!.lastMsgPreview).toBeUndefined();
    expect(s!.origin).toBe('pwa');
  });

  test('msg 있는 session → preview 채워짐', () => {
    const h = new DaemonSessionHistory();
    h.register('s1');
    h.append('s1', [{ role: 'user', content: 'preview text' }]);
    const s = h.summary().find((x) => x.id === 's1');
    expect(s!.lastMsgPreview).toBe('preview text');
  });

  test('legacy session (origin 없음) → origin 필드 자체가 빠짐', () => {
    const h = new DaemonSessionHistory();
    h.register('s1');
    h.append('s1', [{ role: 'user', content: 'q' }]);
    const s = h.summary().find((x) => x.id === 's1');
    expect('origin' in s!).toBe(false);
  });

  test('summary 정렬 lastTurnAt desc 보존', async () => {
    const h = new DaemonSessionHistory();
    h.register('a');
    h.append('a', [{ role: 'user', content: 'first' }]);
    await new Promise((r) => setTimeout(r, 5));
    h.register('b', [], { origin: 'pwa' });
    h.append('b', [{ role: 'user', content: 'second' }]);
    const s = h.summary();
    expect(s[0].id).toBe('b');
    expect(s[1].id).toBe('a');
  });
});
