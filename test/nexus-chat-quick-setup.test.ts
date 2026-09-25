// NEXUS · chat backend Quick Setup card (N-1 cleanup PR g.2) — unit tests.
//
// Pin the snapshot shape (3 providers · OAuth + env-var paths) and
// the line renderer (current wire highlighted · ✓/◯ glyphs · footer).

import { describe, expect, test } from 'bun:test';

import {
  buildQuickSetupSnapshot,
  renderQuickSetupLines,
} from '../src/nexus/chat/quick-setup.js';

const noTokens = (): null => null;

describe('buildQuickSetupSnapshot · entries', () => {
  test('always emits 3 entries in priority order', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    expect(snap.entries.map((e) => e.provider)).toEqual(['codex', 'claude-code', 'gemini']);
  });

  test('codex entry has both OAuth + OPENAI_API_KEY rows', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    const codex = snap.entries.find((e) => e.provider === 'codex')!;
    const tags = codex.paths.map((p) => p.tag).sort();
    expect(tags).toEqual(['OAuth', 'OPENAI_API_KEY']);
  });

  test('claude-code entry has only ANTHROPIC_API_KEY row (no OAuth in monad-agent)', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    const claude = snap.entries.find((e) => e.provider === 'claude-code')!;
    expect(claude.paths.map((p) => p.tag)).toEqual(['ANTHROPIC_API_KEY']);
  });

  test('gemini entry has GEMINI_API_KEY row (covers GOOGLE_API_KEY alias)', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    const gem = snap.entries.find((e) => e.provider === 'gemini')!;
    expect(gem.paths.map((p) => p.tag)).toEqual(['GEMINI_API_KEY']);
  });
});

describe('buildQuickSetupSnapshot · detection glyph', () => {
  test('codex OAuth present → OAuth path detected=true, others false', () => {
    const snap = buildQuickSetupSnapshot({
      envSource: {},
      tokenLookup: (p) => (p === 'openai-codex' ? { tokens: { accessToken: 'x' } } : null),
    });
    const codex = snap.entries.find((e) => e.provider === 'codex')!;
    expect(codex.paths.find((p) => p.tag === 'OAuth')!.detected).toBe(true);
    expect(codex.paths.find((p) => p.tag === 'OPENAI_API_KEY')!.detected).toBe(false);
    expect(snap.detection.backend).toBe('codex');
  });

  test('OPENAI_API_KEY present → API row detected=true', () => {
    const snap = buildQuickSetupSnapshot({
      envSource: { OPENAI_API_KEY: 'sk-x' },
      tokenLookup: noTokens,
    });
    const codex = snap.entries.find((e) => e.provider === 'codex')!;
    expect(codex.paths.find((p) => p.tag === 'OPENAI_API_KEY')!.detected).toBe(true);
  });

  test('GEMINI_API_KEY OR GOOGLE_API_KEY both flag the gemini row', () => {
    const a = buildQuickSetupSnapshot({
      envSource: { GEMINI_API_KEY: 'AI-z' }, tokenLookup: noTokens,
    });
    const b = buildQuickSetupSnapshot({
      envSource: { GOOGLE_API_KEY: 'AI-z' }, tokenLookup: noTokens,
    });
    expect(a.entries.find((e) => e.provider === 'gemini')!.paths[0]!.detected).toBe(true);
    expect(b.entries.find((e) => e.provider === 'gemini')!.paths[0]!.detected).toBe(true);
  });

  test('clean machine → all rows detected=false, detection backend = none', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    expect(snap.detection.backend).toBe('none');
    for (const e of snap.entries) {
      for (const p of e.paths) expect(p.detected).toBe(false);
    }
  });
});

describe('renderQuickSetupLines · output shape', () => {
  test('header + footer present', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    const lines = renderQuickSetupLines(snap);
    expect(lines.some((l) => l.includes('Quick Setup'))).toBe(true);
    expect(lines.some((l) => l.includes('현재 wired'))).toBe(true);
    expect(lines.some((l) => l.includes('Grok') && l.includes('NEXUS chat'))).toBe(true);
    expect(lines.some((l) => l.includes('[r]'))).toBe(true);
  });

  test('current wire highlighted with ▶ arrow', () => {
    const snap = buildQuickSetupSnapshot({
      envSource: { ANTHROPIC_API_KEY: 'sk-y' }, tokenLookup: noTokens,
    });
    const lines = renderQuickSetupLines(snap);
    const claudeLine = lines.find((l) => l.includes('Anthropic'))!;
    expect(claudeLine.startsWith('  ▶')).toBe(true);
  });

  test('detected row shows ✓, undetected shows ◯', () => {
    const snap = buildQuickSetupSnapshot({
      envSource: { OPENAI_API_KEY: 'sk-x' }, tokenLookup: noTokens,
    });
    const lines = renderQuickSetupLines(snap);
    expect(lines.some((l) => l.includes('✓') && l.includes('OPENAI_API_KEY'))).toBe(true);
    expect(lines.some((l) => l.includes('◯') && l.includes('ANTHROPIC_API_KEY'))).toBe(true);
  });

  test('clean machine renders "(없음)" hint', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    const lines = renderQuickSetupLines(snap);
    expect(lines.some((l) => l.includes('없음'))).toBe(true);
  });
});

describe('renderQuickSetupLines · setup commands', () => {
  test('codex OAuth row hints monad login codex command', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    const lines = renderQuickSetupLines(snap);
    expect(lines.some((l) => l.includes('monad login codex'))).toBe(true);
  });

  test('env-var rows include export hints', () => {
    const snap = buildQuickSetupSnapshot({ envSource: {}, tokenLookup: noTokens });
    const lines = renderQuickSetupLines(snap);
    expect(lines.some((l) => l.includes('OPENAI_API_KEY=sk'))).toBe(true);
    expect(lines.some((l) => l.includes('ANTHROPIC_API_KEY=sk'))).toBe(true);
    expect(lines.some((l) => l.includes('GEMINI_API_KEY=AI'))).toBe(true);
  });
});
