// AXON P6.1 — TaskSurface `acx-session` variant tests.
//
// Covers the schema additions in src/task-orchestrator/types.ts +
// dispatcher.ts DEFAULT_CONCURRENCY_CAPS + registerSurfaceAdapters
// wiring. The stub adapter itself (returns NOT_IMPLEMENTED) is
// tested here minimally; the full adapter lands in P6.2.

import { describe, expect, test } from 'bun:test';
import {
  ACX_AGENT_BRANDS,
  isAcxAgentBrand,
  isTaskSurface,
  isTaskSurfaceKind,
  surfaceGlyph,
  TASK_SURFACE_KINDS,
  type AcxAgentBrand,
  type Task,
  type TaskSurface,
} from '../../src/task-orchestrator/types.js';
import { DEFAULT_CONCURRENCY_CAPS } from '../../src/task-orchestrator/dispatcher.js';
import {
  registerSurfaceAdapters,
  createAcxSessionAdapter,
} from '../../src/task-orchestrator/surfaces/index.js';
import { SurfaceRegistry } from '../../src/task-orchestrator/surface-registry.js';
import { createTask } from '../../src/task-orchestrator/types.js';

describe('AXON P6.1 — AcxAgentBrand', () => {
  test('exports all 4 canonical brands', () => {
    expect(ACX_AGENT_BRANDS).toEqual(['claude-code', 'codex', 'gemini-cli', 'elanous-self']);
  });

  test('isAcxAgentBrand accepts known brands + rejects unknown', () => {
    for (const b of ACX_AGENT_BRANDS) expect(isAcxAgentBrand(b)).toBe(true);
    expect(isAcxAgentBrand('claude')).toBe(false);         // raw backend id, not brand
    expect(isAcxAgentBrand('gpt')).toBe(false);
    expect(isAcxAgentBrand(42)).toBe(false);
    expect(isAcxAgentBrand(null)).toBe(false);
  });
});

describe('AXON P6.1 — TASK_SURFACE_KINDS + guards', () => {
  test('adds acx-session as the 8th kind', () => {
    expect(TASK_SURFACE_KINDS[7]).toBe('acx-session');
    expect(TASK_SURFACE_KINDS).toContain('acx-session');
  });

  test('isTaskSurfaceKind accepts acx-session', () => {
    expect(isTaskSurfaceKind('acx-session')).toBe(true);
  });

  test('isTaskSurface accepts a well-formed acx-session surface', () => {
    const surf: TaskSurface = {
      kind: 'acx-session',
      sessionId: 'acp-cli:claude:sess-42',
      agentBrand: 'claude-code',
      prompt: 'what is the answer?',
    };
    expect(isTaskSurface(surf)).toBe(true);
  });

  test('isTaskSurface accepts every agentBrand', () => {
    for (const brand of ACX_AGENT_BRANDS) {
      expect(isTaskSurface({
        kind: 'acx-session',
        sessionId: 's',
        agentBrand: brand,
        prompt: 'x',
      })).toBe(true);
    }
  });

  test('isTaskSurface rejects invalid agentBrand', () => {
    expect(isTaskSurface({
      kind: 'acx-session',
      sessionId: 's',
      agentBrand: 'claude', // raw backend id, not brand
      prompt: 'x',
    })).toBe(false);
  });

  test('isTaskSurface rejects empty sessionId / prompt', () => {
    expect(isTaskSurface({
      kind: 'acx-session',
      sessionId: '',
      agentBrand: 'claude-code',
      prompt: 'x',
    })).toBe(false);
    expect(isTaskSurface({
      kind: 'acx-session',
      sessionId: 's',
      agentBrand: 'claude-code',
      prompt: '',
    })).toBe(false);
  });

  test('isTaskSurface rejects missing required fields', () => {
    expect(isTaskSurface({ kind: 'acx-session' })).toBe(false);
    expect(isTaskSurface({ kind: 'acx-session', sessionId: 's' })).toBe(false);
    expect(isTaskSurface({ kind: 'acx-session', sessionId: 's', agentBrand: 'claude-code' })).toBe(false);
  });
});

describe('AXON P6.1 — surfaceGlyph', () => {
  test('returns a unique non-empty glyph for acx-session', () => {
    const g = surfaceGlyph('acx-session');
    expect(g).toBeTruthy();
    expect(g.length).toBeGreaterThan(0);
    // Ensure it's distinct from every other surface's glyph.
    const others = TASK_SURFACE_KINDS
      .filter(k => k !== 'acx-session')
      .map(k => surfaceGlyph(k));
    expect(others).not.toContain(g);
  });
});

describe('AXON P6.1 — concurrency cap', () => {
  test('DEFAULT_CONCURRENCY_CAPS has an entry for acx-session', () => {
    expect(DEFAULT_CONCURRENCY_CAPS['acx-session']).toBeDefined();
    expect(typeof DEFAULT_CONCURRENCY_CAPS['acx-session']).toBe('number');
    expect(DEFAULT_CONCURRENCY_CAPS['acx-session']).toBeGreaterThan(0);
  });

  test('every TaskSurfaceKind has a cap (exhaustiveness)', () => {
    for (const k of TASK_SURFACE_KINDS) {
      expect(DEFAULT_CONCURRENCY_CAPS[k]).toBeDefined();
    }
  });
});

describe('AXON P6.1 — registerSurfaceAdapters acxSession wire', () => {
  test('registers acx-session when an acxSession callable is supplied', () => {
    const registry = new SurfaceRegistry();
    const registered = registerSurfaceAdapters(registry, {
      acxSession: async () => ({ address: 'x', done: Promise.resolve({ status: 'completed', output: '', durationMs: 0 }) }),
    });
    expect(registered).toContain('acx-session');
    expect(registry.has('acx-session')).toBe(true);
  });

  test('does NOT register acx-session when the callable is omitted', () => {
    const registry = new SurfaceRegistry();
    const registered = registerSurfaceAdapters(registry, {});
    expect(registered).not.toContain('acx-session');
    expect(registry.has('acx-session')).toBe(false);
  });
});

describe('AXON P6.1 — adapter factory smoke (full behaviour lives in acx-session-adapter.test.ts)', () => {
  test('factory returns a callable adapter that forwards to the callable', async () => {
    let callableHit = false;
    const adapter = createAcxSessionAdapter({
      callable: async () => {
        callableHit = true;
        return {
          address: 'x',
          done: Promise.resolve({ status: 'completed' as const, output: 'ok', durationMs: 1 }),
        };
      },
    });
    const task: Task = createTask({
      title: 'Ask Claude',
      description: 'd',
      surface: {
        kind: 'acx-session',
        sessionId: 'acp-cli:claude:sess-42',
        agentBrand: 'claude-code',
        prompt: 'hello',
      },
    });
    const res = await adapter(task, {});
    expect(res.executionId).toBeTruthy();
    const exec = await res.promise;
    expect(callableHit).toBe(true);
    expect(exec.status).toBe('completed');
  });
});

// Type-level check: TaskSurface exhaustiveness. If P6.1 missed a
// variant, the switch below would not compile.
function _exhaustiveTypeCheck(brand: AcxAgentBrand): string {
  switch (brand) {
    case 'claude-code': return '◆';
    case 'codex':       return '◇';
    case 'gemini-cli':  return '◈';
    case 'elanous-self':  return '●';
  }
}
// Reference so the unused check isn't dead-code elimination:
test('AXON P6.1 — AcxAgentBrand exhaustiveness compile-time', () => {
  expect(_exhaustiveTypeCheck('claude-code')).toBeTruthy();
  expect(_exhaustiveTypeCheck('codex')).toBeTruthy();
  expect(_exhaustiveTypeCheck('gemini-cli')).toBeTruthy();
  expect(_exhaustiveTypeCheck('elanous-self')).toBeTruthy();
});
