// DaemonSessionHistory → on-disk SessionStore write-through 검증(R3).
import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonSessionHistory } from '../../boot/daemon-runtime.js';
import { HARNESS_SPACE_ENV } from '../../harness/harness-space.js';
import { SessionStore } from '../../session/session-store.js';
import { wireDaemonHistoryToStore, isAcpChatSession, makeSessionStoreReadThrough } from './session-history-mirror.js';

const roots: string[] = [];
function tmp(): string { const r = mkdtempSync(join(tmpdir(), 'shm-')); roots.push(r); return r; }
let priorHarness: string | undefined;
beforeEach(() => {
  priorHarness = process.env[HARNESS_SPACE_ENV];
  delete process.env[HARNESS_SPACE_ENV];
});
afterEach(() => {
  for (const r of roots.splice(0)) try { rmSync(r, { recursive: true, force: true }); } catch { /* noop */ }
  if (priorHarness === undefined) delete process.env[HARNESS_SPACE_ENV];
  else process.env[HARNESS_SPACE_ENV] = priorHarness;
});

describe('wireDaemonHistoryToStore', () => {
  it('ACP 세션(elanous-session-*) append → on-disk 미러(목록·복원)', () => {
    const store = new SessionStore(tmp());
    const hist = new DaemonSessionHistory();
    const off = wireDaemonHistoryToStore(hist, store);
    try {
      hist.append('elanous-session-1', [
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '반가워요' },
      ]);
      const loaded = store.load('elanous-session-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.messages.length).toBe(2);
      expect(loaded!.meta).toMatchObject({ source: 'pwa', origin: 'pwa' });
      expect(store.load('elanous-session-1')!.meta).toMatchObject({ source: 'pwa', origin: 'pwa' });
      expect(store.list().some((m) => m.id === 'elanous-session-1')).toBe(true);
    } finally { off(); }
  });

  it('GN — setOrigin(native) 태깅 시 S1 origin=native 전파(iOS 네이티브·pwa 오라벨 수복)', () => {
    const store = new SessionStore(tmp());
    const hist = new DaemonSessionHistory();
    const off = wireDaemonHistoryToStore(hist, store);
    try {
      // 네이티브 앱: onPromptReceived 가 _meta.origin.surface='native' 로 tagOrigin(append 前·
      // 세션 미존재). setOrigin 은 byId 가드로 no-op 이라 tagOrigin 사용.
      hist.tagOrigin('elanous-session-ios', 'native');
      hist.append('elanous-session-ios', [{ role: 'user', content: 'hi' }]);
      const loaded = store.load('elanous-session-ios');
      expect(loaded!.meta).toMatchObject({ source: 'native', origin: 'native' });
      expect(store.load('elanous-session-ios')!.meta).toMatchObject({ source: 'native', origin: 'native' });
    } finally { off(); }
  });

  it('무태그 또는 source에 대응하지 않는 origin은 특정 표면 source를 선언하지 않는다', () => {
    const store = new SessionStore(tmp());
    const hist = new DaemonSessionHistory();
    const off = wireDaemonHistoryToStore(hist, store);
    try {
      hist.append('unclassified-session', [{ role: 'user', content: 'untagged' }]);
      hist.tagOrigin('discord-session', 'dc');
      hist.append('discord-session', [{ role: 'user', content: 'tagged' }]);
      const unclassified = store.load('unclassified-session')!.meta;
      expect(unclassified).toMatchObject({ source: 'cli', sourceSource: 'default' });
      expect(unclassified).not.toHaveProperty('origin');
      expect(store.load('discord-session')!.meta).toMatchObject({
        source: 'cli', sourceSource: 'default', origin: 'dc',
      });
    } finally { off(); }
  });

  it('tool_use 블록을 저장하면 라이브 SSE 문면으로 도구 이름이 남는다', () => {
    const store = new SessionStore(tmp());
    const hist = new DaemonSessionHistory();
    const off = wireDaemonHistoryToStore(hist, store);
    try {
      hist.append('elanous-session-tool', [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'finance_quote', input: { symbol: '005930' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '319500' }] },
      ]);
      const loaded = store.load('elanous-session-tool');
      expect(loaded).not.toBeNull();
      expect(loaded!.messages).toHaveLength(2);
      expect(typeof loaded!.messages[0]!.content).toBe('string');
      expect(loaded!.messages[0]!.content).toBe('🔧 finance_quote');
      expect(loaded!.messages[1]!.content).toBe('[tool_result]');
      expect(loaded!.messages[0]!.toolName).toBe('finance_quote');
      expect(loaded!.messages[0]!.toolArgs).toEqual({ symbol: '005930' });
      expect(loaded!.messages[1]!.toolName).toBe('finance_quote');
      expect(loaded!.messages[1]!.toolArgs).toEqual({ symbol: '005930' });
      expect(loaded!.messages[1]!.toolResult).toBe('319500');
      expect(Object.prototype.hasOwnProperty.call(loaded!.messages[0]!, 'toolName')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(loaded!.messages[1]!, 'toolName')).toBe(true);

      hist.append('elanous-session-unnamed-tool', [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call-2', name: '', input: {} }] },
      ]);
      const unnamed = store.load('elanous-session-unnamed-tool');
      expect(unnamed!.messages).toHaveLength(1);
      expect(unnamed!.messages[0]!.content).toBe('[tool_use]');
      expect(unnamed!.messages[0]!.toolName).toBeUndefined();
      expect(unnamed!.messages[0]!.toolArgs).toEqual({});
    } finally { off(); }
  });

  it('onAppend 구조 블록에서 실제 도구 이름을 필드에 싣고 문자열 표식은 도구로 오인하지 않는다', () => {
    const store = new SessionStore(tmp());
    const hist = new DaemonSessionHistory();
    const off = wireDaemonHistoryToStore(hist, store);
    try {
      hist.append('elanous-session-ask', [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call-ask', name: 'AskUserQuestion', input: { prompt: '어느 쪽?' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-ask', content: '왼쪽' }] },
      ]);
      const toolTurn = store.load('elanous-session-ask')!.messages;
      expect(toolTurn[0]!.toolName).toBe('AskUserQuestion');
      expect(toolTurn[0]!.toolArgs).toEqual({ prompt: '어느 쪽?' });
      expect(toolTurn[1]!.toolName).toBe('AskUserQuestion');
      expect(toolTurn[1]!.toolResult).toBe('왼쪽');
      expect(toolTurn[0]!.content).toBe('🔧 AskUserQuestion');
      expect(toolTurn[1]!.content).toBe('[tool_result]');

      hist.append('elanous-session-lookalike', [
        { role: 'user', content: '[tool_result]' },
        { role: 'assistant', content: '🔧 AskUserQuestion' },
      ]);
      const lookalike = store.load('elanous-session-lookalike')!.messages;
      expect(lookalike).toHaveLength(2);
      expect(lookalike[0]!.content).toBe('[tool_result]');
      expect(lookalike[1]!.content).toBe('🔧 AskUserQuestion');
      expect(Object.prototype.hasOwnProperty.call(lookalike[0]!, 'toolName')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(lookalike[0]!, 'toolArgs')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(lookalike[0]!, 'toolResult')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(lookalike[1]!, 'toolName')).toBe(false);

      hist.append('elanous-session-plain', [
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '반가워요' },
      ]);
      const plain = store.load('elanous-session-plain')!.messages;
      expect(plain.map((m) => ({ role: m.role, content: m.content }))).toEqual([
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '반가워요' },
      ]);
      expect(Object.prototype.hasOwnProperty.call(plain[0]!, 'toolName')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(plain[1]!, 'toolName')).toBe(false);
    } finally { off(); }
  });

  it('추가 턴도 같은 on-disk 세션에 누적', () => {
    const store = new SessionStore(tmp());
    const hist = new DaemonSessionHistory();
    const off = wireDaemonHistoryToStore(hist, store);
    try {
      hist.append('elanous-session-2', [{ role: 'user', content: '1' }]);
      hist.append('elanous-session-2', [{ role: 'assistant', content: '2' }]);
      expect(store.load('elanous-session-2')!.messages.length).toBe(2);
    } finally { off(); }
  });

  it('R5 — uuid 세션도 미러(PWA가 텔레그램 세션 이어갈 때 persist)', () => {
    const store = new SessionStore(tmp());
    const hist = new DaemonSessionHistory();
    const off = wireDaemonHistoryToStore(hist, store);
    try {
      hist.append('550e8400-e29b-41d4-a716-446655440000', [{ role: 'user', content: 'x' }]);
      expect(store.list().length).toBe(1);
    } finally { off(); }
  });

  it('isAcpChatSession — elanous-session/http- 만 true(origin 라벨용)', () => {
    expect(isAcpChatSession('elanous-session-1')).toBe(true);
    expect(isAcpChatSession('http-123-abc')).toBe(true);
    expect(isAcpChatSession('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });
});

describe('makeSessionStoreReadThrough + DaemonSessionHistory (완전 무결 공유)', () => {
  it('read-through — 메모리에 없는 on-disk 세션을 get()이 로드', () => {
    const store = new SessionStore(tmp());
    // on-disk 에 세션 준비(텔레그램 상당).
    const s = store.create({ source: 'telegram', title: 'tg' });
    store.appendById(s.id, { role: 'user', content: '삼성 시세?', ts: 'x' });
    store.appendById(s.id, { role: 'assistant', content: '319,500원', ts: 'x' });

    // read-through 를 단 DaemonSessionHistory 는 메모리에 없어도 로드.
    const hist = new DaemonSessionHistory({ readThrough: makeSessionStoreReadThrough(store) });
    const ctx = hist.get(s.id);
    expect(ctx.length).toBe(2);
    expect(ctx[0]!.content).toBe('삼성 시세?');
    expect(hist.has(s.id)).toBe(true);
  });

  it('read-through 후 append — 같은 on-disk 세션에 이어짐(완전 무결)', () => {
    const store = new SessionStore(tmp());
    const s = store.create({ source: 'telegram', title: 'tg' });
    store.appendById(s.id, { role: 'user', content: 'a', ts: 'x' });

    const hist = new DaemonSessionHistory({ readThrough: makeSessionStoreReadThrough(store) });
    const off = wireDaemonHistoryToStore(hist, store);
    try {
      hist.get(s.id);                                        // read-through(1건 로드)
      hist.append(s.id, [{ role: 'assistant', content: 'b' }]); // 이어서 append → 미러
      expect(hist.get(s.id).length).toBe(2);
      expect(store.load(s.id)!.messages.length).toBe(2);     // on-disk 에도 이어짐
    } finally { off(); }
  });
});
