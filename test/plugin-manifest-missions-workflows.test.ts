// ── PX-4 P2: manifest parser for missions + workflows ──
//
// Covers the validation rules that the plugin-host relies on before
// wiring contributions into registries (P5). Path-escape / whitelist /
// duplicate-id enforcement matters most: the runtime resolves goalPath
// and sandboxPath against the plugin directory, so a traversal attack
// at manifest time would otherwise escape the sandbox.

import { describe, expect, test } from 'bun:test';
import { parsePluginManifest } from '../src/plugins/core/manifest';

function baseManifest(contributes: Record<string, unknown>) {
  return parsePluginManifest({
    id: 'demo',
    name: 'Demo',
    version: '0.1.0',
    main: './plugin.ts',
    activationEvents: ['onStartup'],
    capabilities: [],
    contributes,
  });
}

describe('PX-4 P2 — parseMissions', () => {
  test('accepts valid mission with required fields', () => {
    const manifest = baseManifest({
      missions: [{
        id: 'count-to-5',
        name: 'Count To Five',
        goalPath: './missions/count-to-5/mission.md',
        sandboxPath: './missions/count-to-5/sandbox.md',
        evaluator: {
          command: './missions/count-to-5/evaluator.sh',
          format: 'json',
          timeoutMs: 5_000,
        },
        keepPolicy: 'pass_only',
        maxIterations: 6,
      }],
    });
    const m = manifest.contributes.missions?.[0]!;
    expect(m.id).toBe('count-to-5');
    expect(m.maxIterations).toBe(6);
    expect(m.evaluator.timeoutMs).toBe(5_000);
  });

  test('clamps maxIterations to MISSION_DEFAULTS.maxIterationsMax (1000)', () => {
    const manifest = baseManifest({
      missions: [{
        id: 'runaway',
        name: 'Runaway',
        goalPath: './a.md',
        sandboxPath: './b.md',
        evaluator: { command: './e.sh', format: 'json' },
        keepPolicy: 'never',
        maxIterations: 99_999,
      }],
    });
    expect(manifest.contributes.missions?.[0]!.maxIterations).toBe(1000);
  });

  test('applies MISSION_DEFAULTS.evaluatorTimeoutMs when omitted', () => {
    const manifest = baseManifest({
      missions: [{
        id: 'x',
        name: 'X',
        goalPath: './a.md',
        sandboxPath: './b.md',
        evaluator: { command: './e.sh', format: 'json' },
        keepPolicy: 'pass_only',
        maxIterations: 1,
      }],
    });
    expect(manifest.contributes.missions?.[0]!.evaluator.timeoutMs).toBe(300_000);
  });

  test('rejects invalid id (uppercase / starts with digit)', () => {
    expect(() => baseManifest({
      missions: [{
        id: 'Mission-1', name: 'n', goalPath: './a.md', sandboxPath: './b.md',
        evaluator: { command: './e.sh', format: 'json' },
        keepPolicy: 'pass_only', maxIterations: 1,
      }],
    })).toThrow(/\.id must match/);
  });

  test('rejects duplicate mission ids within one manifest', () => {
    expect(() => baseManifest({
      missions: [
        { id: 'dup', name: 'A', goalPath: './a.md', sandboxPath: './b.md',
          evaluator: { command: './e.sh', format: 'json' },
          keepPolicy: 'pass_only', maxIterations: 1 },
        { id: 'dup', name: 'B', goalPath: './a.md', sandboxPath: './b.md',
          evaluator: { command: './e.sh', format: 'json' },
          keepPolicy: 'pass_only', maxIterations: 1 },
      ],
    })).toThrow(/duplicated/);
  });

  test('rejects goalPath containing .. traversal', () => {
    expect(() => baseManifest({
      missions: [{
        id: 'bad', name: 'n', goalPath: './../../etc/passwd', sandboxPath: './b.md',
        evaluator: { command: './e.sh', format: 'json' },
        keepPolicy: 'pass_only', maxIterations: 1,
      }],
    })).toThrow(/\.\./);
  });

  test('rejects absolute path', () => {
    expect(() => baseManifest({
      missions: [{
        id: 'bad', name: 'n', goalPath: '/etc/passwd', sandboxPath: './b.md',
        evaluator: { command: './e.sh', format: 'json' },
        keepPolicy: 'pass_only', maxIterations: 1,
      }],
    })).toThrow(/relative/);
  });

  test('rejects evaluator.format !== "json"', () => {
    expect(() => baseManifest({
      missions: [{
        id: 'x', name: 'n', goalPath: './a.md', sandboxPath: './b.md',
        evaluator: { command: './e.sh', format: 'exit-code' },
        keepPolicy: 'pass_only', maxIterations: 1,
      }],
    })).toThrow(/format must be 'json'/);
  });

  test('rejects unknown keepPolicy', () => {
    expect(() => baseManifest({
      missions: [{
        id: 'x', name: 'n', goalPath: './a.md', sandboxPath: './b.md',
        evaluator: { command: './e.sh', format: 'json' },
        keepPolicy: 'any_time', maxIterations: 1,
      }],
    })).toThrow(/keepPolicy must be one of/);
  });
});

describe('PX-4 P2 — parseWorkflows', () => {
  test('accepts minimal valid workflow', () => {
    const manifest = baseManifest({
      workflows: [{
        id: 'greet',
        name: 'Greet',
        steps: [
          { kind: 'tool', id: 'Bash', args: { cmd: 'echo hi' } },
        ],
      }],
    });
    const wf = manifest.contributes.workflows?.[0]!;
    expect(wf.id).toBe('greet');
    expect(wf.steps.length).toBe(1);
    expect(wf.steps[0]!.kind).toBe('tool');
  });

  test('rejects workflow with zero steps', () => {
    expect(() => baseManifest({
      workflows: [{ id: 'empty', name: 'n', steps: [] }],
    })).toThrow(/steps must be a non-empty array/);
  });

  test('rejects unknown step.kind', () => {
    expect(() => baseManifest({
      workflows: [{
        id: 'bad', name: 'n', steps: [{ kind: 'widget', id: 'x' }],
      }],
    })).toThrow(/kind must be one of/);
  });

  test('honours handoff.outputPath + passToNext', () => {
    const manifest = baseManifest({
      workflows: [{
        id: 'chain', name: 'n',
        steps: [
          { kind: 'tool', id: 'Bash', args: { cmd: 'echo a' },
            handoff: { outputPath: 'step-1.md', passToNext: ['context'] } },
          { kind: 'tool', id: 'Bash', args: { cmd: 'echo b' } },
        ],
      }],
    });
    expect(manifest.contributes.workflows?.[0]!.steps[0]!.handoff).toEqual({
      outputPath: 'step-1.md',
      passToNext: ['context'],
    });
  });

  test('rejects handoff.outputPath with path traversal', () => {
    expect(() => baseManifest({
      workflows: [{
        id: 'bad', name: 'n', steps: [
          { kind: 'tool', id: 'Bash',
            handoff: { outputPath: '../../etc/passwd' } },
        ],
      }],
    })).toThrow(/relative filename/);
  });

  test('clamps maxRetries to WORKFLOW_DEFAULTS.maxRetriesCeiling (5)', () => {
    const manifest = baseManifest({
      workflows: [{
        id: 'retry', name: 'n', steps: [
          { kind: 'tool', id: 'Bash', onError: 'retry', maxRetries: 999 },
        ],
      }],
    });
    expect(manifest.contributes.workflows?.[0]!.steps[0]!.maxRetries).toBe(5);
  });

  test('rejects duplicate workflow ids', () => {
    expect(() => baseManifest({
      workflows: [
        { id: 'dup', name: 'A', steps: [{ kind: 'tool', id: 'Bash' }] },
        { id: 'dup', name: 'B', steps: [{ kind: 'tool', id: 'Bash' }] },
      ],
    })).toThrow(/duplicated/);
  });

  test('accepts triggers field (reserved for PX-5 keywords)', () => {
    const manifest = baseManifest({
      workflows: [{
        id: 'routed', name: 'n',
        triggers: ['greet', 'hello'],
        steps: [{ kind: 'tool', id: 'Bash' }],
      }],
    });
    expect(manifest.contributes.workflows?.[0]!.triggers).toEqual(['greet', 'hello']);
  });

  test('missions + workflows coexist on the same manifest', () => {
    const manifest = baseManifest({
      missions: [{
        id: 'm', name: 'M', goalPath: './a.md', sandboxPath: './b.md',
        evaluator: { command: './e.sh', format: 'json' },
        keepPolicy: 'never', maxIterations: 1,
      }],
      workflows: [{ id: 'w', name: 'W', steps: [{ kind: 'tool', id: 'Bash' }] }],
    });
    expect(manifest.contributes.missions?.length).toBe(1);
    expect(manifest.contributes.workflows?.length).toBe(1);
  });
});
