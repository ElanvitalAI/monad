// ── U-0 · ViewMode derivation + context-key projection tests ──
//
// Locks the priority ordering spec from ROADMAP-input-widget-unification
// §2.3 + CAPABILITIES-view-mode.md §priority. Any regression here means
// downstream consumers (CKS viewModeKind, when-clauses, unified dispatcher
// in U-2) see the wrong "which mode is the dashboard in?" answer.

import { describe, test, expect } from 'bun:test';
import {
  deriveViewMode,
  deriveAndDiffViewMode,
  sameViewMode,
  viewModeContextKeys,
  IDLE_VIEW_MODE,
  type ViewMode,
  type ViewModeSignals,
} from '../src/input-core/view-mode.js';

function signals(partial: Partial<ViewModeSignals> = {}): ViewModeSignals {
  return {
    terminalModalId: null,
    modalTopId: null,
    pluginActive: null,
    chordLeader: null,
    streaming: false,
    inputFocused: false,
    ...partial,
  };
}

// ── deriveViewMode · priority matrix ─────────────────────────────────

describe('deriveViewMode · individual arms', () => {
  test('empty signals → idle', () => {
    expect(deriveViewMode(signals())).toEqual({ kind: 'idle' });
  });

  test('inputFocused alone → input', () => {
    expect(deriveViewMode(signals({ inputFocused: true }))).toEqual({ kind: 'input' });
  });

  test('streaming alone → streaming (wins over input)', () => {
    expect(deriveViewMode(signals({ streaming: true, inputFocused: true })))
      .toEqual({ kind: 'streaming' });
  });

  test('chord leader → chord-armed (wins over streaming + input)', () => {
    expect(deriveViewMode(signals({
      streaming: true,
      inputFocused: true,
      chordLeader: 'ctrl-b',
    }))).toEqual({ kind: 'chord-armed', leader: 'ctrl-b' });
  });

  test('plugin active → plugin (wins over chord, streaming, input)', () => {
    expect(deriveViewMode(signals({
      chordLeader: 'x',
      streaming: true,
      inputFocused: true,
      pluginActive: { id: 'example-plugin' },
    }))).toEqual({ kind: 'plugin', pluginId: 'example-plugin' });
  });

  test('plugin with slot preserved', () => {
    expect(deriveViewMode(signals({
      pluginActive: { id: 'example-plugin', slot: 'pane-a' },
    }))).toEqual({ kind: 'plugin', pluginId: 'example-plugin', slot: 'pane-a' });
  });

  test('modal top → modal (wins over plugin + below)', () => {
    expect(deriveViewMode(signals({
      pluginActive: { id: 'p' },
      modalTopId: 'attach-popup',
    }))).toEqual({ kind: 'modal', modalId: 'attach-popup' });
  });

  test('terminal-modal → terminal-modal (wins over modal + below)', () => {
    expect(deriveViewMode(signals({
      modalTopId: 'attach-popup',
      pluginActive: { id: 'p' },
      chordLeader: 'x',
      streaming: true,
      terminalModalId: 'pty-1',
    }))).toEqual({ kind: 'terminal-modal', terminalId: 'pty-1' });
  });
});

// ── deriveViewMode · edge cases from audit §"Edge Cases" ─────────────

describe('deriveViewMode · edge-case priority locks', () => {
  test('streaming + chord armed simultaneously → chord-armed wins (audit §1)', () => {
    const mode = deriveViewMode(signals({ streaming: true, chordLeader: 'ctrl-b' }));
    expect(mode.kind).toBe('chord-armed');
  });

  test('plugin active + streaming → plugin wins (audit §2 · prevents scroll interception inside plugin pane)', () => {
    const mode = deriveViewMode(signals({
      pluginActive: { id: 'sync' },
      streaming: true,
    }));
    expect(mode.kind).toBe('plugin');
  });

  test('modal closed mid-stream (modalTopId=null, streaming=true) → streaming not input (audit §3)', () => {
    const mode = deriveViewMode(signals({ streaming: true }));
    expect(mode.kind).toBe('streaming');
  });

  test('all signals off → idle (baseline)', () => {
    expect(deriveViewMode(signals())).toEqual({ kind: 'idle' });
  });
});

// ── sameViewMode · equality semantics ────────────────────────────────

describe('sameViewMode', () => {
  test('different kinds → false', () => {
    expect(sameViewMode({ kind: 'idle' }, { kind: 'streaming' })).toBe(false);
  });

  test('simple kinds (idle/input/streaming) → kind match → true', () => {
    expect(sameViewMode({ kind: 'streaming' }, { kind: 'streaming' })).toBe(true);
  });

  test('modal with same id → true', () => {
    expect(sameViewMode(
      { kind: 'modal', modalId: 'x' },
      { kind: 'modal', modalId: 'x' },
    )).toBe(true);
  });

  test('modal with different id → false', () => {
    expect(sameViewMode(
      { kind: 'modal', modalId: 'x' },
      { kind: 'modal', modalId: 'y' },
    )).toBe(false);
  });

  test('plugin differing in slot → false', () => {
    expect(sameViewMode(
      { kind: 'plugin', pluginId: 'p', slot: 'a' },
      { kind: 'plugin', pluginId: 'p', slot: 'b' },
    )).toBe(false);
  });

  test('plugin same id + no slot on either side → true', () => {
    expect(sameViewMode(
      { kind: 'plugin', pluginId: 'p' },
      { kind: 'plugin', pluginId: 'p' },
    )).toBe(true);
  });

  test('chord-armed same leader → true', () => {
    expect(sameViewMode(
      { kind: 'chord-armed', leader: 'ctrl-b' },
      { kind: 'chord-armed', leader: 'ctrl-b' },
    )).toBe(true);
  });

  test('terminal-modal same id → true', () => {
    expect(sameViewMode(
      { kind: 'terminal-modal', terminalId: 't' },
      { kind: 'terminal-modal', terminalId: 't' },
    )).toBe(true);
  });
});

// ── viewModeContextKeys · projection ─────────────────────────────────

describe('viewModeContextKeys', () => {
  test('exactly one isX key is true', () => {
    const keys = viewModeContextKeys({ kind: 'streaming' });
    const trues = Object.entries(keys).filter(([, v]) => v === true).map(([k]) => k);
    expect(trues).toEqual(['viewMode.isStreaming']);
  });

  test('all seven keys present for every kind', () => {
    const kinds: ViewMode[] = [
      { kind: 'idle' },
      { kind: 'input' },
      { kind: 'streaming' },
      { kind: 'chord-armed', leader: 'x' },
      { kind: 'plugin', pluginId: 'p' },
      { kind: 'modal', modalId: 'm' },
      { kind: 'terminal-modal', terminalId: 't' },
    ];
    const expectedKeys = [
      'viewMode.isIdle',
      'viewMode.isInput',
      'viewMode.isStreaming',
      'viewMode.isChordArmed',
      'viewMode.isPlugin',
      'viewMode.isModal',
      'viewMode.isTerminalModal',
    ];
    for (const mode of kinds) {
      const keys = viewModeContextKeys(mode);
      for (const expected of expectedKeys) {
        expect(keys[expected]).toBeDefined();
      }
    }
  });

  test('idle → isIdle true, others false', () => {
    const keys = viewModeContextKeys({ kind: 'idle' });
    expect(keys['viewMode.isIdle']).toBe(true);
    expect(keys['viewMode.isStreaming']).toBe(false);
    expect(keys['viewMode.isModal']).toBe(false);
  });

  test('terminal-modal → isTerminalModal true', () => {
    const keys = viewModeContextKeys({ kind: 'terminal-modal', terminalId: 't' });
    expect(keys['viewMode.isTerminalModal']).toBe(true);
  });
});

// ── deriveAndDiffViewMode ────────────────────────────────────────────

describe('deriveAndDiffViewMode', () => {
  test('changed=false when next equals prev', () => {
    const { next, changed } = deriveAndDiffViewMode(
      signals({ streaming: true }),
      { kind: 'streaming' },
    );
    expect(next.kind).toBe('streaming');
    expect(changed).toBe(false);
  });

  test('changed=true when priority flips (plugin arrives)', () => {
    const { next, changed } = deriveAndDiffViewMode(
      signals({ streaming: true, pluginActive: { id: 'sync' } }),
      { kind: 'streaming' },
    );
    expect(next.kind).toBe('plugin');
    expect(changed).toBe(true);
  });

  test('changed=true when discriminator changes (modal id differs)', () => {
    const { next, changed } = deriveAndDiffViewMode(
      signals({ modalTopId: 'new-modal' }),
      { kind: 'modal', modalId: 'old-modal' },
    );
    expect(next).toEqual({ kind: 'modal', modalId: 'new-modal' });
    expect(changed).toBe(true);
  });
});

// ── IDLE_VIEW_MODE sentinel ──────────────────────────────────────────

describe('IDLE_VIEW_MODE', () => {
  test('equals {kind: "idle"}', () => {
    expect(IDLE_VIEW_MODE).toEqual({ kind: 'idle' });
  });

  test('frozen · cannot mutate kind', () => {
    expect(() => {
      (IDLE_VIEW_MODE as unknown as { kind: string }).kind = 'streaming';
    }).toThrow();
  });
});
