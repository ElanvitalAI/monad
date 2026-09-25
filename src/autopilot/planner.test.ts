// src/autopilot/planner.test.ts
//
// Bun test scaffold for the heuristic planner.

import { describe, test, expect } from 'bun:test';
import { parseHeuristicPlan, heuristicPlanConfig } from './planner.js';

describe('parseHeuristicPlan — numbered list', () => {
  test('1. / 2. / 3. markers', () => {
    const plan = parseHeuristicPlan(
      'Build the thing.\n1. read docs\n2. write code\n3. test it',
    );
    expect(plan).not.toBeNull();
    expect(plan?.steps.map((s) => s.text)).toEqual([
      'read docs',
      'write code',
      'test it',
    ]);
    expect(plan?.steps.map((s) => s.id)).toEqual(['step1', 'step2', 'step3']);
  });

  test('1) / 2) markers', () => {
    const plan = parseHeuristicPlan('1) a\n2) b');
    expect(plan?.steps.map((s) => s.text)).toEqual(['a', 'b']);
  });
});

describe('parseHeuristicPlan — bullet list', () => {
  test('dash markers', () => {
    const plan = parseHeuristicPlan('- one\n- two\n- three');
    expect(plan?.steps.map((s) => s.text)).toEqual(['one', 'two', 'three']);
  });

  test('asterisk markers', () => {
    const plan = parseHeuristicPlan('* a\n* b');
    expect(plan?.steps.map((s) => s.text)).toEqual(['a', 'b']);
  });

  test('unicode bullet', () => {
    const plan = parseHeuristicPlan('  • alpha\n  • beta');
    expect(plan?.steps.map((s) => s.text)).toEqual(['alpha', 'beta']);
  });
});

describe('parseHeuristicPlan — continuations', () => {
  test('non-marker line attaches to previous step', () => {
    const plan = parseHeuristicPlan(
      '1. open the file\n   and read the header\n2. close it',
    );
    expect(plan?.steps[0].text).toBe('open the file and read the header');
    expect(plan?.steps[1].text).toBe('close it');
  });

  test('blank lines are ignored', () => {
    const plan = parseHeuristicPlan('1. a\n\n2. b\n');
    expect(plan?.steps).toHaveLength(2);
  });
});

describe('parseHeuristicPlan — edge cases', () => {
  test('no markers → null', () => {
    expect(parseHeuristicPlan('do the thing please')).toBeNull();
  });

  test('empty string → null', () => {
    expect(parseHeuristicPlan('')).toBeNull();
  });

  test('preamble before first marker is dropped', () => {
    const plan = parseHeuristicPlan('Goal: refactor.\nSteps:\n1. read\n2. write');
    expect(plan?.steps).toHaveLength(2);
    // Preamble does NOT become a continuation of step 1.
    expect(plan?.steps[0].text).toBe('read');
  });

  test('maxSteps cap', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `${i + 1}. step ${i + 1}`).join('\n');
    const plan = parseHeuristicPlan(lines, { maxSteps: 5 });
    expect(plan?.steps).toHaveLength(5);
  });

  test('custom ref', () => {
    const plan = parseHeuristicPlan('1. x', { ref: 'custom-id' });
    expect(plan?.ref).toBe('custom-id');
  });
});

describe('heuristicPlanConfig', () => {
  test('returns { plan } when markers detected', () => {
    const cfg = heuristicPlanConfig('1. a\n2. b');
    expect(cfg.plan?.steps).toHaveLength(2);
  });

  test('returns {} when no markers', () => {
    const cfg = heuristicPlanConfig('plain mission text');
    expect(cfg).toEqual({});
  });
});
