import { describe, expect, test } from 'bun:test';
import { agentBatchScratchTitle, renderAgentBatchScratch } from '../src/display/index.js';
import type { AgentBatchDisplayInfo } from '../src/display/index.js';
import { stripAnsi } from '../src/tui.js';

const base: AgentBatchDisplayInfo = {
  phase: 'tick',
  batchElapsedMs: 1200,
  total: 3,
  done: 1,
  remaining: 2,
  runningDescriptions: ['scan files', 'summarize notes'],
};

describe('agent batch display adapter', () => {
  test('builds a stable scratch title from skill name and progress', () => {
    expect(agentBatchScratchTitle('research', base)).toBe('Agents · research · 1/3');
    expect(agentBatchScratchTitle('research', { ...base, phase: 'end' }))
      .toBe('Agents · research · complete');
  });

  test('renders running descriptions as scratch lines', () => {
    const plain = renderAgentBatchScratch(base).map(stripAnsi).join('\n');
    expect(plain).toContain('Agents 1/3');
    expect(plain).toContain('running');
    expect(plain).toContain('scan files');
    expect(plain).toContain('summarize notes');
  });

  test('renders completed agent and all-complete state', () => {
    const plain = renderAgentBatchScratch({
      ...base,
      phase: 'end',
      done: 3,
      remaining: 0,
      runningDescriptions: [],
      completedDescription: 'last agent',
    }).map(stripAnsi).join('\n');
    expect(plain).toContain('last agent');
    expect(plain).toContain('all agents complete');
  });
});
