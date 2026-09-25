// M3-3 (Phase 3) — voice-nl-switch CLI tests.

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  _resetSessionTierOverridesForTesting,
  getSessionTierOverride,
  type LlmRunner,
} from '../../src/model-tier/index.js';
import { runVoiceNlSwitchCommand } from '../../src/cli/voice-nl-switch.js';
import { buildUserConfig } from '../../src/user-config.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tmpCfg(body: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'nl-switch-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(body));
  const cfg = buildUserConfig(path);
  return { cfg, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

beforeEach(() => {
  _resetSessionTierOverridesForTesting();
});

describe('M3-3 · runVoiceNlSwitchCommand · validation', () => {
  test('empty text → exit 2 with usage hint', async () => {
    const r = await runVoiceNlSwitchCommand({ text: '   ' });
    expect(r.exitCode).toBe(2);
    expect(r.output[0]).toContain('Usage:');
  });

  test('--apply without --session → exit 2', async () => {
    const r = await runVoiceNlSwitchCommand({ text: 'hi', apply: true });
    expect(r.exitCode).toBe(2);
    expect(r.output[0]).toContain('--apply requires --session');
  });

  test('no model + no runner → exit 2', async () => {
    const r = await runVoiceNlSwitchCommand({ text: '의료 용어' });
    expect(r.exitCode).toBe(2);
    expect(r.output[0]).toContain('--model');
  });
});

describe('M3-3 · runVoiceNlSwitchCommand · detect-only', () => {
  test('apply-preset detection · plan describes the switch · no override installed', async () => {
    const { cfg, cleanup } = tmpCfg({});
    try {
      const runner: LlmRunner = async () =>
        '{"intent":"apply-preset","preset":"medical_dictation","tierDelta":null,"rationale":"med"}';
      const r = await runVoiceNlSwitchCommand({
        text: '이번 회의는 의료 용어 많아',
        runner,
        cfg,
      });
      expect(r.exitCode).toBe(0);
      expect(r.applied).toBe(false);
      expect(r.detection.preset).toBe('medical_dictation');
      expect(r.plan.apply.stt).toBe('loaded');
      expect(r.output.some((l) => l.includes('Medical / legal dictation'))).toBe(true);
      expect(r.output.some((l) => l.includes('잠깐 전환'))).toBe(true);
    } finally { cleanup(); }
  });

  test('intent=none · confirmMessage echoes no-change', async () => {
    const { cfg, cleanup } = tmpCfg({});
    try {
      const runner: LlmRunner = async () =>
        '{"intent":"none","preset":null,"tierDelta":null,"rationale":""}';
      const r = await runVoiceNlSwitchCommand({ text: '오늘 점심', runner, cfg });
      expect(r.exitCode).toBe(0);
      expect(r.plan.isNoop).toBe(true);
      expect(r.output.some((l) => l.includes('No tier change'))).toBe(true);
    } finally { cleanup(); }
  });
});

describe('M3-3 · runVoiceNlSwitchCommand · --apply', () => {
  test('installs session override + reports success', async () => {
    const { cfg, cleanup } = tmpCfg({});
    try {
      const runner: LlmRunner = async () =>
        '{"intent":"apply-preset","preset":"medical_dictation","tierDelta":null,"rationale":"med"}';
      const r = await runVoiceNlSwitchCommand({
        text: '의료 용어 많아',
        runner,
        cfg,
        apply: true,
        sessionId: 'sess-cli',
      });
      expect(r.applied).toBe(true);
      const ov = getSessionTierOverride('sess-cli');
      expect(ov?.stt).toBe('loaded');
      expect(ov?.llm).toBe('best');
      expect(ov?.tts).toBe('best');
      expect(r.output.some((l) => l.includes('✓ Override installed'))).toBe(true);
    } finally { cleanup(); }
  });

  test('noop plan does NOT install override · says so', async () => {
    const { cfg, cleanup } = tmpCfg({});
    try {
      const runner: LlmRunner = async () =>
        '{"intent":"none","preset":null,"tierDelta":null,"rationale":""}';
      const r = await runVoiceNlSwitchCommand({
        text: '점심',
        runner,
        cfg,
        apply: true,
        sessionId: 'sess-noop',
      });
      expect(r.applied).toBe(false);
      expect(getSessionTierOverride('sess-noop')).toBeUndefined();
      expect(r.output.some((l) => l.includes('no-op'))).toBe(true);
    } finally { cleanup(); }
  });
});
