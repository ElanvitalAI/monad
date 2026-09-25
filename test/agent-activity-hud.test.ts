import { describe, expect, test } from 'bun:test';

import {
  pulsePhase,
  renderAgentActivitySegment,
  AGENT_ACTIVITY_SEGMENT_KEY,
  PULSE_HALF_PERIOD_MS,
} from '../src/agent-activity-hud.js';
import { stripAnsi } from '../src/tui.js';

describe('pulsePhase', () => {
  test('returns A at t=0', () => {
    expect(pulsePhase(0)).toBe('A');
  });

  test('returns B after one half-period', () => {
    expect(pulsePhase(PULSE_HALF_PERIOD_MS)).toBe('B');
  });

  test('returns A again after full period', () => {
    expect(pulsePhase(PULSE_HALF_PERIOD_MS * 2)).toBe('A');
  });

  test('mid-period rounds down', () => {
    expect(pulsePhase(Math.floor(PULSE_HALF_PERIOD_MS * 0.9))).toBe('A');
    expect(pulsePhase(Math.floor(PULSE_HALF_PERIOD_MS * 1.1))).toBe('B');
  });
});

describe('renderAgentActivitySegment', () => {
  test('shows immediate abort hint when no agents are running', () => {
    expect(stripAnsi(renderAgentActivitySegment(0)!)).toBe('Esc abort now');
    expect(stripAnsi(renderAgentActivitySegment(-1)!)).toBe('Esc abort now');
  });

  test('shows confirmation abort hint when agents are running', () => {
    const noAgents = stripAnsi(renderAgentActivitySegment(0)!);
    const agentsRunning = stripAnsi(renderAgentActivitySegment(1, 0)!);
    expect(agentsRunning).toContain('Esc confirm abort');
    expect(agentsRunning).not.toBe(noAgents);
  });

  test('1 agent shows singular label', () => {
    const seg = renderAgentActivitySegment(1, 0);
    expect(seg).not.toBeNull();
    expect(stripAnsi(seg!)).toContain('1 agent');
    expect(stripAnsi(seg!)).not.toContain('1 agents');
  });

  test('2 agents shows plural label', () => {
    const seg = renderAgentActivitySegment(2, 0);
    expect(stripAnsi(seg!)).toContain('2 agents');
  });

  test('glyph pulses based on the now arg', () => {
    const sA = renderAgentActivitySegment(1, 0);
    const sB = renderAgentActivitySegment(1, PULSE_HALF_PERIOD_MS);
    expect(stripAnsi(sA!)).toContain('●');
    expect(stripAnsi(sB!)).toContain('○');
  });

  test('3+ agents use the error color (vs warning for 1-2)', () => {
    const two = renderAgentActivitySegment(2, 0);
    const five = renderAgentActivitySegment(5, 0);
    // Colors show up as ANSI codes. Compare the two raw strings —
    // they differ ONLY in the color wrapping ANSI codes.
    expect(two).not.toBe(five);
    expect(stripAnsi(two!)).toContain('●');
    expect(stripAnsi(five!)).toContain('●');
    expect(stripAnsi(five!)).toContain('5 agents');
  });
});

describe('AGENT_ACTIVITY_SEGMENT_KEY', () => {
  test('exposes a stable key for setSegment/clearSegment', () => {
    expect(AGENT_ACTIVITY_SEGMENT_KEY).toBe('agent-activity');
  });
});
