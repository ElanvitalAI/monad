import { beforeAll, describe, expect, test } from 'bun:test';

import { collectSignals } from '../src/tool-hints/signals.js';
import { evaluateGate, resetGateCache } from '../src/tool-hints/gate.ts';
import { nativeToolCatalog } from '../src/native-tool-catalog.js';
import { buildSkillToolDisciplinePrompt } from '../src/skills/tool-discipline-prompt.js';
import { ensureProbed } from '../src/tool-hints/probe.js';

// Prime custom probes (node-pty availability) so terminal_modal_*
// tools are visible in the gate. probeOk is sync-fail-closed on cold
// cache; ensureProbed warms the WeakMap before the assertions run.
beforeAll(async () => {
  for (const entry of nativeToolCatalog) {
    if (entry.probe) {
      try { await ensureProbed(entry.probe); } catch { /* skip */ }
    }
  }
});

describe('signals — terminal session facts', () => {
  test('defaults when terminal context missing', () => {
    const s = collectSignals();
    expect(s.hasActivePtyModal).toBe(false);
    expect(s.backgroundedPtyCount).toBe(0);
    expect(s.foregroundSessionKind).toBeUndefined();
    expect(s.hasSessionAttention).toBe(false);
  });

  test('terminal facts flow through', () => {
    const s = collectSignals({
      terminal: {
        hasActiveModal: true,
        backgroundedCount: 2,
        foregroundKind: 'coding-agent',
        hasAttention: true,
      },
    });
    expect(s.hasActivePtyModal).toBe(true);
    expect(s.backgroundedPtyCount).toBe(2);
    expect(s.foregroundSessionKind).toBe('coding-agent');
    expect(s.hasSessionAttention).toBe(true);
  });

  test('fingerprint changes when terminal facts change', () => {
    const base = collectSignals();
    const withModal = collectSignals({
      terminal: { hasActiveModal: true, backgroundedCount: 0, hasAttention: false },
    });
    expect(withModal.fingerprint).not.toBe(base.fingerprint);
  });
});

describe('gate — terminal-session boosts', () => {
  test('hasActivePtyModal boosts observe + list', () => {
    resetGateCache();
    const signals = collectSignals({
      terminal: { hasActiveModal: true, backgroundedCount: 0, hasAttention: false },
    });
    const decision = evaluateGate(nativeToolCatalog, [], signals);
    expect(decision.boost['terminal_modal_list']).toBeGreaterThanOrEqual(1);
    expect(decision.boost['terminal_modal_observe']).toBeGreaterThanOrEqual(1);
  });

  test('hasSessionAttention adds extra observe boost', () => {
    resetGateCache();
    const noAttn = collectSignals({
      terminal: { hasActiveModal: true, backgroundedCount: 0, hasAttention: false },
    });
    const withAttn = collectSignals({
      terminal: { hasActiveModal: true, backgroundedCount: 0, hasAttention: true },
    });
    const a = evaluateGate(nativeToolCatalog, [], noAttn);
    const b = evaluateGate(nativeToolCatalog, [], withAttn);
    expect((b.boost['terminal_modal_observe'] ?? 0)).toBeGreaterThan((a.boost['terminal_modal_observe'] ?? 0));
  });

  test('backgroundedPtyCount boosts focus', () => {
    resetGateCache();
    const signals = collectSignals({
      terminal: { hasActiveModal: true, backgroundedCount: 3, hasAttention: false },
    });
    const decision = evaluateGate(nativeToolCatalog, [], signals);
    expect(decision.boost['terminal_modal_focus']).toBeGreaterThanOrEqual(1);
  });
});

describe('discipline prompt — ACTIVE TERMINAL SESSIONS block', () => {
  test('omitted when no sessions', () => {
    const p = buildSkillToolDisciplinePrompt({});
    expect(p).not.toContain('ACTIVE TERMINAL SESSIONS');
  });

  test('renders line per session with state + brand + attention', () => {
    const p = buildSkillToolDisciplinePrompt({
      terminalSessions: [
        { id: 'term-session:ab12cd', title: 'claude-code', state: 'foreground', kind: 'coding-agent', agentBrand: 'claude-code', attentionLevel: 0 },
        { id: 'term-session:ef34gh', title: 'yazi', state: 'background', kind: 'shell', attentionLevel: 2, lastNotification: 'Permission' },
      ],
    });
    expect(p).toContain('ACTIVE TERMINAL SESSIONS');
    expect(p).toContain('claude-code');
    expect(p).toContain('fg');
    expect(p).toContain('yazi');
    expect(p).toContain('bg');
    expect(p).toContain('attn:2');
    expect(p).toContain('Permission');
  });

  test('skips exited sessions', () => {
    const p = buildSkillToolDisciplinePrompt({
      terminalSessions: [
        { id: 'old', title: 'old', state: 'exited', attentionLevel: 0 },
      ],
    });
    expect(p).not.toContain('ACTIVE TERMINAL SESSIONS');
  });

  test('caps display at 6 + overflow note', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `id:${i}`,
      title: `t${i}`,
      state: 'background' as const,
      kind: 'shell' as const,
      attentionLevel: 0,
    }));
    const p = buildSkillToolDisciplinePrompt({ terminalSessions: many });
    expect(p).toContain('+2 more');
  });
});
