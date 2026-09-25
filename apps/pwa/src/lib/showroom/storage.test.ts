/** CV-3 Showroom · P6 — named save unit tests. */

import { describe, expect, test } from 'bun:test';
import {
  deleteSavedShowroom,
  listSavedShowrooms,
  loadShowroom,
  makeMemoryBackend,
  panelsFromSaved,
  saveShowroom,
} from './storage';
import type { ShowroomPanel } from './types';

function panel(id: string, provider: string, state: ShowroomPanel['state']): ShowroomPanel {
  return { id, kind: 'chat', provider, sessionId: `sess-${id}`, state };
}

describe('Showroom storage · saveShowroom (P6)', () => {
  test('saves named layout with panels (sessionId stripped)', () => {
    const backend = makeMemoryBackend();
    const panels = [
      panel('p1', 'claude', 'live'),
      panel('p2', 'gemini', 'mute'),
    ];
    const res = saveShowroom('my-deliberation', panels, { backend });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.saved.name).toBe('my-deliberation');
    expect(res.saved.panels).toHaveLength(2);
    // sessionId 가 schema 에서 제외 (load 시 fresh handshake)
    expect((res.saved.panels[0] as { sessionId?: string }).sessionId).toBeUndefined();
  });

  test('rejects empty name', () => {
    const backend = makeMemoryBackend();
    const res = saveShowroom('  ', [], { backend });
    expect(res.ok).toBe(false);
  });

  test('overwrites existing slot with same name (silent)', () => {
    const backend = makeMemoryBackend();
    saveShowroom('slot', [panel('p1', 'claude', 'live')], { backend });
    saveShowroom('slot', [panel('p2', 'gemini', 'live')], { backend });
    const loaded = loadShowroom('slot', backend);
    expect(loaded?.panels).toHaveLength(1);
    expect(loaded?.panels[0]?.id).toBe('p2');
  });

  test('layoutMode option forwarded', () => {
    const backend = makeMemoryBackend();
    const res = saveShowroom('slot', [], { backend, layoutMode: 'vertical' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.saved.layoutMode).toBe('vertical');
  });
});

describe('Showroom storage · loadShowroom (P6)', () => {
  test('returns null for unknown slot', () => {
    expect(loadShowroom('nope', makeMemoryBackend())).toBeNull();
  });

  test('round-trip — saved layout 그대로 retrieve', () => {
    const backend = makeMemoryBackend();
    const panels = [panel('p1', 'codex', 'live')];
    saveShowroom('my', panels, { backend });
    const loaded = loadShowroom('my', backend);
    expect(loaded?.name).toBe('my');
    expect(loaded?.panels[0]?.provider).toBe('codex');
  });

  test('whitespace in name 무시', () => {
    const backend = makeMemoryBackend();
    saveShowroom('  spaced  ', [], { backend });
    expect(loadShowroom('spaced', backend)).not.toBeNull();
  });
});

describe('Showroom storage · listSavedShowrooms (P6)', () => {
  test('returns empty array when no slots', () => {
    expect(listSavedShowrooms(makeMemoryBackend())).toEqual([]);
  });

  test('orders by savedAt desc (most recent first)', async () => {
    const backend = makeMemoryBackend();
    saveShowroom('first', [], { backend });
    await new Promise((r) => setTimeout(r, 5));
    saveShowroom('second', [], { backend });
    const list = listSavedShowrooms(backend);
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('second');
    expect(list[1]!.name).toBe('first');
  });
});

describe('Showroom storage · deleteSavedShowroom (P6)', () => {
  test('returns true when slot existed', () => {
    const backend = makeMemoryBackend();
    saveShowroom('s1', [], { backend });
    expect(deleteSavedShowroom('s1', backend)).toBe(true);
    expect(loadShowroom('s1', backend)).toBeNull();
  });

  test('returns false when slot missing', () => {
    expect(deleteSavedShowroom('nope', makeMemoryBackend())).toBe(false);
  });
});

describe('Showroom storage · panelsFromSaved (P6)', () => {
  test('reconstructs ShowroomPanel array · sessionId=null', () => {
    const backend = makeMemoryBackend();
    saveShowroom('my', [panel('p1', 'gemini', 'mute')], { backend });
    const saved = loadShowroom('my', backend);
    expect(saved).not.toBeNull();
    const restored = panelsFromSaved(saved!);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.sessionId).toBeNull();
    expect(restored[0]!.provider).toBe('gemini');
    expect(restored[0]!.state).toBe('mute');
  });
});

describe('Showroom storage · P5 agent panel · save/load round-trip', () => {
  test('agentBrand 보존 (kind=agent)', () => {
    const backend = makeMemoryBackend();
    const agentPanel: ShowroomPanel = {
      id: 'a1',
      kind: 'agent',
      provider: 'codex',
      agentBrand: 'codex',
      sessionId: 'sess-a1',
      state: 'live',
    };
    saveShowroom('agent-layout', [agentPanel], { backend });
    const loaded = loadShowroom('agent-layout', backend);
    expect(loaded).not.toBeNull();
    expect(loaded!.panels[0]!.kind).toBe('agent');
    expect(loaded!.panels[0]!.agentBrand).toBe('codex');
    expect(loaded!.panels[0]!.provider).toBe('codex');
  });

  test('chat panel save · agentBrand 미존재 (undefined 으로 round-trip)', () => {
    const backend = makeMemoryBackend();
    const chatPanel: ShowroomPanel = {
      id: 'c1',
      kind: 'chat',
      provider: 'claude',
      sessionId: 'sess-c1',
      state: 'live',
    };
    saveShowroom('chat-layout', [chatPanel], { backend });
    const loaded = loadShowroom('chat-layout', backend);
    expect(loaded).not.toBeNull();
    expect(loaded!.panels[0]!.kind).toBe('chat');
    expect(loaded!.panels[0]!.agentBrand).toBeUndefined();
  });

  test('panelsFromSaved · agent panel reconstruction', () => {
    const backend = makeMemoryBackend();
    const agent: ShowroomPanel = {
      id: 'a1',
      kind: 'agent',
      provider: 'gemini',
      agentBrand: 'gemini',
      sessionId: 'sess-a1',
      state: 'mute',
    };
    saveShowroom('mix', [agent], { backend });
    const saved = loadShowroom('mix', backend);
    const restored = panelsFromSaved(saved!);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.kind).toBe('agent');
    expect(restored[0]!.agentBrand).toBe('gemini');
    expect(restored[0]!.provider).toBe('gemini');
    expect(restored[0]!.sessionId).toBeNull(); // fresh handshake
    expect(restored[0]!.state).toBe('mute');
  });

  test('mixed save (chat + agent) — independently 보존', () => {
    const backend = makeMemoryBackend();
    const chat: ShowroomPanel = {
      id: 'c1',
      kind: 'chat',
      provider: 'claude',
      sessionId: 'sess-c1',
      state: 'live',
    };
    const agent: ShowroomPanel = {
      id: 'a1',
      kind: 'agent',
      provider: 'codex',
      agentBrand: 'codex',
      sessionId: 'sess-a1',
      state: 'freeze',
    };
    saveShowroom('mix2', [chat, agent], { backend });
    const restored = panelsFromSaved(loadShowroom('mix2', backend)!);
    expect(restored).toHaveLength(2);
    expect(restored[0]!.kind).toBe('chat');
    expect(restored[0]!.agentBrand).toBeUndefined();
    expect(restored[1]!.kind).toBe('agent');
    expect(restored[1]!.agentBrand).toBe('codex');
  });

  test('legacy entry (P5 이전 · kind=chat · agentBrand 없음) → migration 자동', () => {
    // Legacy localStorage entry — manually craft the JSON shape.
    const backend = makeMemoryBackend();
    backend.setItem(
      'monad.showroom.layouts',
      JSON.stringify({
        legacy: {
          name: 'legacy',
          savedAt: Date.now(),
          panels: [
            { id: 'p1', kind: 'chat', provider: 'claude', state: 'live' },
          ],
        },
      }),
    );
    const restored = panelsFromSaved(loadShowroom('legacy', backend)!);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.kind).toBe('chat');
    expect(restored[0]!.agentBrand).toBeUndefined();
    expect(restored[0]!.provider).toBe('claude');
  });
});

describe('Showroom storage · makeMemoryBackend (P6 · test seam)', () => {
  test('SSR / Node 환경 default backend 도 noop 으로 silent fail', () => {
    // typeof window === 'undefined' branch · noop backend
    // listSavedShowrooms() 가 throw 안 함
    expect(() => listSavedShowrooms()).not.toThrow();
  });
});

// §6.5 integration — multi-named-showroom roundtrip with §6.1 + §6.4
// fields preserved across save/load.
describe('storage · §6.5 multi-showroom roundtrip', () => {
  test('save + load preserves personaId + roleHint per panel', () => {
    const backend = makeMemoryBackend();
    const panels: ShowroomPanel[] = [
      {
        id: 'p1',
        kind: 'chat',
        provider: 'claude',
        sessionId: 'sess-p1',
        state: 'live',
        personaId: 'skeptic-claude',
        roleHint: 'review',
      },
      {
        id: 'p2',
        kind: 'agent',
        provider: 'codex',
        agentBrand: 'codex',
        sessionId: 'sess-p2',
        state: 'live',
        personaId: 'codex-strict',
        roleHint: 'exec',
      },
    ];
    const saveRes = saveShowroom('multi-test', panels, { backend });
    expect(saveRes.ok).toBe(true);

    const loaded = loadShowroom('multi-test', backend);
    expect(loaded).not.toBeNull();
    expect(loaded!.panels).toHaveLength(2);
    expect(loaded!.panels[0]?.personaId).toBe('skeptic-claude');
    expect(loaded!.panels[0]?.roleHint).toBe('review');
    expect(loaded!.panels[1]?.personaId).toBe('codex-strict');
    expect(loaded!.panels[1]?.roleHint).toBe('exec');
    expect(loaded!.panels[1]?.agentBrand).toBe('codex');

    const restored = panelsFromSaved(loaded!);
    expect(restored[0]?.personaId).toBe('skeptic-claude');
    expect(restored[0]?.roleHint).toBe('review');
    expect(restored[1]?.personaId).toBe('codex-strict');
    expect(restored[1]?.roleHint).toBe('exec');
  });

  test('multiple distinct named showrooms coexist', () => {
    const backend = makeMemoryBackend();
    saveShowroom('project-A', [
      { id: 'a1', kind: 'chat', provider: 'claude', sessionId: null, state: 'live', personaId: 'alpha' },
    ], { backend });
    saveShowroom('project-B', [
      { id: 'b1', kind: 'chat', provider: 'codex', sessionId: null, state: 'live', personaId: 'beta' },
    ], { backend });
    saveShowroom('side-experiment', [
      { id: 'c1', kind: 'chat', provider: 'gemini', sessionId: null, state: 'live' },
    ], { backend });

    const list = listSavedShowrooms(backend);
    expect(list).toHaveLength(3);
    const names = list.map((l) => l.name).sort();
    expect(names).toEqual(['project-A', 'project-B', 'side-experiment']);
  });

  test('panel without personaId/roleHint doesn\'t carry the field', () => {
    const backend = makeMemoryBackend();
    const panels: ShowroomPanel[] = [
      { id: 'p1', kind: 'chat', provider: 'claude', sessionId: null, state: 'live' },
    ];
    saveShowroom('plain', panels, { backend });
    const loaded = loadShowroom('plain', backend);
    expect(loaded!.panels[0]?.personaId).toBeUndefined();
    expect(loaded!.panels[0]?.roleHint).toBeUndefined();
  });
});
