// FU.B2 (2026-05-09 night) — live-announcer pure-helper coverage.
//
// React lifecycle covered by dogfood (use-live-camera convention);
// the formatter table is the load-bearing piece for SR consistency.

import { describe, expect, test } from 'bun:test';
import {
  announcements,
  useLiveAnnouncer,
} from './use-live-announcer';

describe('useLiveAnnouncer module surface', () => {
  test('exports', () => {
    expect(typeof useLiveAnnouncer).toBe('function');
    expect(typeof announcements).toBe('object');
  });
});

describe('announcements formatters', () => {
  test('layoutSaved with name', () => {
    expect(announcements.layoutSaved('morning')).toBe('Layout "morning" saved');
  });
  test('layoutSaved without name', () => {
    expect(announcements.layoutSaved('')).toBe('Layout saved');
  });
  test('layoutLoaded / layoutDeleted parallel shape', () => {
    expect(announcements.layoutLoaded('debug-X')).toBe('Layout "debug-X" loaded');
    expect(announcements.layoutDeleted('pair-A')).toBe('Layout "pair-A" deleted');
    expect(announcements.layoutLoaded('')).toBe('Layout loaded');
  });
  test('judgeToggled', () => {
    expect(announcements.judgeToggled('local-llm')).toBe('Role judge: LLM');
    expect(announcements.judgeToggled('keyword')).toBe('Role judge: keyword');
  });
  test('voiceToggled', () => {
    expect(announcements.voiceToggled(true)).toBe('Voice mode on · listening');
    expect(announcements.voiceToggled(false)).toBe('Voice mode off');
  });
  test('voicePhase', () => {
    expect(announcements.voicePhase('listening')).toBe('Voice listening');
    expect(announcements.voicePhase('done')).toBe('Voice done');
  });
  test('ttsMuted', () => {
    expect(announcements.ttsMuted(true)).toBe('TTS muted');
    expect(announcements.ttsMuted(false)).toBe('TTS unmuted');
  });
  test('modelChanged', () => {
    expect(announcements.modelChanged('claude-opus-4-5')).toBe('Model: claude-opus-4-5');
    expect(announcements.modelChanged('')).toBe('Model: daemon default');
  });
  test('panelAdded with label', () => {
    expect(announcements.panelAdded('chat', 'Claude')).toBe('Added chat panel: Claude');
    expect(announcements.panelAdded('agent', 'gemini-cli')).toBe('Added agent panel: gemini-cli');
  });
  test('panelAdded without label', () => {
    expect(announcements.panelAdded('chat')).toBe('Added chat panel');
  });
  test('panelRemoved', () => {
    expect(announcements.panelRemoved('Claude')).toBe('Removed panel: Claude');
    expect(announcements.panelRemoved()).toBe('Panel removed');
  });
  test('shortcutFired passthrough', () => {
    expect(announcements.shortcutFired('Focused broadcast input')).toBe('Focused broadcast input');
  });
});

describe('announcements terseness — SR queue manageability', () => {
  test('every formatter output is < 60 chars (short SR phrase)', () => {
    const samples: string[] = [
      announcements.layoutSaved('long-layout-name-with-many-chars'),
      announcements.layoutLoaded('some-name'),
      announcements.judgeToggled('local-llm'),
      announcements.voiceToggled(true),
      announcements.voicePhase('listening'),
      announcements.ttsMuted(true),
      announcements.modelChanged('claude-opus-4-5'),
      announcements.panelAdded('chat', 'Claude Sonnet 4.5'),
    ];
    for (const phrase of samples) {
      expect(phrase.length).toBeLessThan(60);
    }
  });
});
