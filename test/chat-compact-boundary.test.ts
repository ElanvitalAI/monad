import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import { renderCompactBoundary } from '../src/chat/compact-boundary.js';

describe('renderCompactBoundary', () => {
  test('renders manual compact hint with history affordance', () => {
    const line = stripAnsi(renderCompactBoundary('manual'));
    expect(line).toContain('Conversation compacted');
    expect(line).toContain('manual /compact');
    expect(line).toContain('Ctrl+O for history');
  });

  test('renders partial compact detail', () => {
    const line = stripAnsi(renderCompactBoundary('partial', 'last 2'));
    expect(line).toContain('partial /compact');
    expect(line).toContain('kept last 2');
  });

  test('renders auto-compact detail', () => {
    const line = stripAnsi(renderCompactBoundary('auto', 'threshold-exceeded 87.0%'));
    expect(line).toContain('auto-compact');
    expect(line).toContain('threshold-exceeded 87.0%');
  });
});
