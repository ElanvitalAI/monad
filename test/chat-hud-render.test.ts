import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import { renderTokenGauge, renderVariantBadge, resolveGaugeTone } from '../src/chat/hud-render.js';

describe('renderVariantBadge', () => {
  test('renders builtin variant badge for active provider', () => {
    const badge = stripAnsi(renderVariantBadge({
      providerInfo: {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        auth: 'apikey',
        authDetail: 'API key',
      },
      systemPrompt: {
        taskVariant: 'default',
      },
      width: 120,
    }));
    expect(badge).toContain('↯ anthropic');
    expect(badge).toContain('claude');
  });

  test('renders override badge with filename', () => {
    const badge = stripAnsi(renderVariantBadge({
      providerInfo: {
        provider: 'openai-codex',
        model: 'codex-mini-latest',
        auth: 'oauth',
        authDetail: 'OAuth',
      },
      systemPrompt: {
        overridePath: '/tmp/custom-prompt.md',
        taskVariant: 'research',
      },
      width: 120,
    }));
    expect(badge).toContain('override');
    expect(badge).toContain('custom-prompt.md');
    expect(badge).toContain('research');
  });
});

describe('renderTokenGauge', () => {
  test('resolveGaugeTone switches at warn and danger thresholds', () => {
    expect(resolveGaugeTone(0.5, { gaugeWarnRatio: 0.7, gaugeDangerRatio: 0.85 })).toBe('normal');
    expect(resolveGaugeTone(0.7, { gaugeWarnRatio: 0.7, gaugeDangerRatio: 0.85 })).toBe('warn');
    expect(resolveGaugeTone(0.9, { gaugeWarnRatio: 0.7, gaugeDangerRatio: 0.85 })).toBe('danger');
  });

  test('renders compact ctx gauge label', () => {
    const gauge = stripAnsi(renderTokenGauge(85, 100, {
      gaugeWarnRatio: 0.7,
      gaugeDangerRatio: 0.85,
    }));
    expect(gauge).toContain('ctx');
    expect(gauge).toContain('85%');
  });
});
