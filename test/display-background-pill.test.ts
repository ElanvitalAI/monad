import { describe, expect, test } from 'bun:test';
import {
  renderBackgroundPill,
  totalRunning,
  type BackgroundPillCounts,
} from '../src/display/background-pill.js';

const ZERO: BackgroundPillCounts = { shell: 0, agent: 0, workflow: 0 };

describe('renderBackgroundPill', () => {
  test('all-zero counts → null (caller skips block)', () => {
    expect(renderBackgroundPill(ZERO)).toBeNull();
    expect(totalRunning(ZERO)).toBe(0);
  });

  test('single source — singular form', () => {
    const agent = renderBackgroundPill({ ...ZERO, agent: 1 });
    const shell = renderBackgroundPill({ ...ZERO, shell: 1 });
    const workflow = renderBackgroundPill({ ...ZERO, workflow: 1 });

    expect(agent).toMatch(/◇ 1 agent(?: · |$)/);
    expect(shell).toMatch(/◇ 1 shell(?: · |$)/);
    expect(workflow).toMatch(/◇ 1 workflow(?: · |$)/);
    expect(agent).not.toContain('1 agents');
    expect(shell).not.toContain('1 shells');
    expect(workflow).not.toContain('1 workflows');
  });

  test('single source — plural form', () => {
    expect(renderBackgroundPill({ ...ZERO, agent: 3 })).toContain('3 agents');
    expect(renderBackgroundPill({ ...ZERO, shell: 2 })).toContain('2 shells');
    expect(renderBackgroundPill({ ...ZERO, workflow: 2 })).toContain('2 workflows');
  });

  test('multi source — joined with ·', () => {
    const r = renderBackgroundPill({ shell: 1, agent: 2, workflow: 1 });
    expect(r).not.toBeNull();
    expect(r!).toContain('2 agents');
    expect(r!).toContain('1 shell');
    expect(r!).toContain('1 workflow');
    expect(r!).toContain(' · ');
    // Order: agent → shell → workflow
    const agentIdx = r!.indexOf('agent');
    const shellIdx = r!.indexOf('shell');
    const workflowIdx = r!.indexOf('workflow');
    expect(agentIdx).toBeLessThan(shellIdx);
    expect(shellIdx).toBeLessThan(workflowIdx);
  });

  test('returns a string with the leading ◇ glyph', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 });
    expect(typeof r).toBe('string');
    expect(r).toStartWith('◇ ');
  });

  test('attention=true adds CTA suffix', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 }, { attention: true });
    expect(r!).toContain('↓ to view');
  });

  test('attention=false (default) — no CTA suffix', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 });
    expect(r!).not.toContain('↓');
  });

  test('color hooks invoked: muted for body, accent for attention', () => {
    const calls: string[] = [];
    const tag = (label: string) => (s: string): string => {
      calls.push(`${label}:${s}`);
      return `[${label}]${s}`;
    };
    renderBackgroundPill({ ...ZERO, agent: 2 }, {
      attention: true,
      colors: { muted: tag('mu'), accent: tag('ac') },
    });
    // Lead glyph + CTA use accent.
    expect(calls.some((c) => c === 'ac:◇')).toBe(true);
    expect(calls.some((c) => c.startsWith('ac:↓'))).toBe(true);
    // Body uses muted.
    expect(calls.some((c) => c.includes('mu:2 agents'))).toBe(true);
  });

  test('color hooks: muted for lead glyph when attention=false', () => {
    const calls: string[] = [];
    const tag = (label: string) => (s: string): string => {
      calls.push(`${label}:${s}`);
      return s;
    };
    renderBackgroundPill({ ...ZERO, agent: 1 }, {
      colors: { muted: tag('mu'), accent: tag('ac') },
    });
    expect(calls.some((c) => c === 'mu:◇')).toBe(true);
    expect(calls.some((c) => c.startsWith('ac:'))).toBe(false);
  });

  test('all-active counts produce three ·-separated segments', () => {
    const r = renderBackgroundPill({ shell: 5, agent: 3, workflow: 2 });
    expect(r).not.toBeNull();
    const segments = r!.slice(2).split(' · ');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toBe('3 agents');
    expect(segments[1]).toBe('5 shells');
    expect(segments[2]).toBe('2 workflows');
  });

  test('zero-segment sources are omitted', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 2 });
    expect(r!).not.toContain('shell');
    expect(r!).not.toContain('workflow');
  });
});

describe('totalRunning', () => {
  test('sums all three source counts', () => {
    expect(totalRunning({ shell: 1, agent: 2, workflow: 3 })).toBe(6);
    expect(totalRunning(ZERO)).toBe(0);
  });
});

describe('Wave P4c — typed attention CTA', () => {
  test('attention object with hasError → "↓ errors" suffix', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 }, {
      attention: { hasError: true },
    });
    expect(r).toContain('↓ errors');
    expect(r).not.toContain('↓ to view');
  });

  test('attention object with needsInput only → "↓ needs input"', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 }, {
      attention: { needsInput: true },
    });
    expect(r).toContain('↓ needs input');
  });

  test('attention object with planReady only → "↓ plan ready"', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 }, {
      attention: { planReady: true },
    });
    expect(r).toContain('↓ plan ready');
  });

  test('priority — error wins over needsInput + planReady', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 }, {
      attention: { hasError: true, needsInput: true, planReady: true },
    });
    expect(r).toContain('↓ errors');
  });

  test('priority — needsInput wins over planReady', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 }, {
      attention: { needsInput: true, planReady: true },
    });
    expect(r).toContain('↓ needs input');
  });

  test('attention object with all-false → no CTA', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 }, {
      attention: { hasError: false, needsInput: false, planReady: false },
    });
    expect(r).not.toContain('↓');
  });

  test('legacy attention=true keeps "↓ to view" hint', () => {
    const r = renderBackgroundPill({ ...ZERO, agent: 1 }, { attention: true });
    expect(r).toContain('↓ to view');
  });

  test('per-trigger color hooks invoked when matching attention fires', () => {
    const calls: string[] = [];
    const tag = (label: string) => (s: string): string => {
      calls.push(`${label}:${s}`);
      return s;
    };
    renderBackgroundPill({ ...ZERO, agent: 1 }, {
      attention: { hasError: true },
      colors: {
        muted: tag('mu'),
        accent: tag('ac'),
        hasError: tag('er'),
      },
    });
    expect(calls.some((c) => c === 'er:◇')).toBe(true);
    expect(calls.some((c) => c.startsWith('er:↓'))).toBe(true);
    expect(calls.some((c) => c.startsWith('ac:'))).toBe(false);
  });

  test('falls back to accent when per-trigger color slot is missing', () => {
    const calls: string[] = [];
    const tag = (label: string) => (s: string): string => {
      calls.push(`${label}:${s}`);
      return s;
    };
    renderBackgroundPill({ ...ZERO, agent: 1 }, {
      attention: { needsInput: true },
      colors: { muted: tag('mu'), accent: tag('ac') },
    });
    expect(calls.some((c) => c === 'ac:◇')).toBe(true);
    expect(calls.some((c) => c.startsWith('ac:↓'))).toBe(true);
  });
});
